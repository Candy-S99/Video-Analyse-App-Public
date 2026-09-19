import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { JobResult, AppConfig, JobConfigSnapshot, JobPhase, ScreenshotProgress } from '../../shared/types';
import { processVideoJob } from './videoProcessor';
import { JobEventLogger } from './jobEventLogger';
import { OutputArtifactWriter } from './outputArtifactWriter';
import { OutputLayout } from './outputLayout';
import { RetentionService } from './retentionService';
import { SecretStore, secretStore as defaultSecretStore } from './secretStore';
import { safeErrorMessage } from './secretRedactor';
import { ProcessRegistry } from './processRegistry';
import { ConfigStore, PersistedAppConfig } from './configStore';

const DEFAULT_DATA_DIR = path.join(process.cwd(), 'data', 'jobs');
const CURRENT_JOB_SCHEMA_VERSION = '3.0';
const DEFAULT_JOB_CONFIG_SNAPSHOT: JobConfigSnapshot = Object.freeze({
  model: 'gemini-3.8-flash',
  segment_length_seconds: 60,
  extract_transcript: true,
  fine_search_window_seconds: 2,
  fine_search_interval_seconds: 0.5,
  max_screenshots_per_candidate: 4,
  fine_search_fallback: 'exact_timestamp',
  automatic_cleanup_enabled: true,
});

const DEFAULT_SCREENSHOT_PROGRESS: ScreenshotProgress = Object.freeze({
  segments_completed: 0,
  segments_total: 0,
  candidates_completed: 0,
  candidates_total: 0,
  screenshots_completed: 0,
  screenshots_failed: 0,
  fine_search_frames_examined: 0,
});

const JOB_PHASES: JobPhase[] = [
  'ANALYSIS',
  'TRANSCRIPT_EXTRACTION',
  'INVENTORY_CONSOLIDATION',
  'SCREENSHOT_EXTRACTION',
  'FINALIZING',
];
const JOB_STATUSES = ['QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'] as const;
const TERMINAL_JOB_STATUSES = ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'] as const;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPDATEABLE_CONFIG_FIELDS = [
  'model',
  'segment_length_seconds',
  'extract_transcript',
  'fine_search_window_seconds',
  'fine_search_interval_seconds',
  'max_screenshots_per_candidate',
  'fine_search_fallback',
  'automatic_cleanup_enabled',
] as const;

export type JobProcessor = (job: JobResult, jobManager: JobManager) => Promise<void>;

export interface JobManagerOptions {
  dataDir?: string;
  processor?: JobProcessor;
  eventLogger?: JobEventLogger;
  secretStore?: SecretStore;
  processRegistry?: ProcessRegistry;
}

export class JobCancellationError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} was cancelled.`);
    this.name = 'JobCancellationError';
  }
}

export class ApplicationShuttingDownError extends Error {
  constructor() {
    super('The application is shutting down and does not accept new jobs.');
    this.name = 'ApplicationShuttingDownError';
  }
}

export class InvalidConfigError extends Error {
  public readonly code = 'INVALID_CONFIGURATION' as const;

  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidConfigError';
  }
}

export class InvalidJobIdError extends Error {
  constructor(jobId: unknown) {
    super(`Invalid job ID: ${String(jobId)}`);
    this.name = 'InvalidJobIdError';
  }
}

export class JobManager {
  private readonly dataDir: string;
  private readonly canonicalDataDir: string;
  private readonly processor: JobProcessor;
  private readonly eventLogger: JobEventLogger;
  private readonly outputLayout: OutputLayout;
  private readonly artifactWriter: OutputArtifactWriter;
  private readonly secretStore: SecretStore;
  private readonly processRegistry: ProcessRegistry;
  private readonly configStore: ConfigStore;
  private readonly activeJobs: Map<string, JobResult> = new Map();
  private readonly runningJobs = new Set<string>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly cancellationRequested = new Set<string>();
  private readonly runningPromises = new Map<string, Promise<void>>();
  private readonly historyClearedJobs = new Set<string>();
  private config: AppConfig;
  private shutdownRequested = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: JobManagerOptions = {}) {
    this.dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || DEFAULT_DATA_DIR);
    this.processor = options.processor || processVideoJob;
    this.secretStore = options.secretStore || defaultSecretStore;
    this.processRegistry = options.processRegistry || new ProcessRegistry();
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.canonicalDataDir = fs.realpathSync(this.dataDir);
    this.configStore = new ConfigStore({ filePath: path.join(this.dataDir, '.video-analysis-config.json') });
    this.eventLogger = options.eventLogger || new JobEventLogger({
      dataDir: this.dataDir,
      getSecrets: () => [this.secretStore.getGeminiApiKey() || ''],
    });
    this.outputLayout = new OutputLayout({ dataDir: this.dataDir });
    this.artifactWriter = new OutputArtifactWriter({ dataDir: this.dataDir, layout: this.outputLayout });
    const defaultConfig: AppConfig = {
      model: this.sanitizeModel(process.env.GEMINI_MODEL),
      segment_length_seconds: parseInt(process.env.SEGMENT_LENGTH || '60', 10),
      extract_transcript: process.env.EXTRACT_TRANSCRIPT !== 'false',
      gemini_api_key_configured: this.secretStore.hasGeminiApiKey(),
      data_dir: this.dataDir,
      fine_search_window_seconds: 2,
      fine_search_interval_seconds: 0.5,
      max_screenshots_per_candidate: 4,
      fine_search_fallback: 'exact_timestamp',
      automatic_cleanup_enabled: true,
    };
    this.config = this.applyPersistedConfig(defaultConfig, this.configStore.load());
    new RetentionService(this.dataDir).runStartupCleanup(this.config.automatic_cleanup_enabled);
    this.loadActiveJobs();
  }

  public getConfig(): AppConfig {
    return { ...this.config };
  }

  public getSecretStore(): SecretStore {
    return this.secretStore;
  }

  public setGeminiApiKey(value: string): AppConfig {
    this.secretStore.setGeminiApiKey(value);
    this.config = { ...this.config, gemini_api_key_configured: true };
    return this.getConfig();
  }

  public deleteGeminiApiKey(): AppConfig {
    this.secretStore.deleteGeminiApiKey();
    this.config = { ...this.config, gemini_api_key_configured: false };
    return this.getConfig();
  }

  public hasGeminiApiKey(): boolean {
    return this.secretStore.hasGeminiApiKey();
  }

  public getProcessRegistry(): ProcessRegistry {
    return this.processRegistry;
  }

  public isShuttingDown(): boolean {
    return this.shutdownRequested;
  }

  public getActiveJobCount(): number {
    return new Set([...this.activeJobs.keys(), ...this.runningJobs]).size;
  }

  public shutdown({ timeoutMs = 10000 }: { timeoutMs?: number } = {}): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownRequested = true;
    this.shutdownPromise = this.performShutdown(timeoutMs);
    return this.shutdownPromise;
  }

  private async performShutdown(timeoutMs: number): Promise<void> {
    const activeJobIds = new Set([...this.activeJobs.keys(), ...this.runningJobs]);
    for (const jobId of activeJobIds) {
      const job = this.activeJobs.get(jobId);
      if (job && (job.status === 'QUEUED' || job.status === 'PROCESSING')) {
        this.cancelJob(jobId);
      } else {
        this.cancellationRequested.add(jobId);
        this.abortControllers.get(jobId)?.abort();
      }
    }

    const running = [...this.runningPromises.values()];
    if (running.length === 0) return;
    await Promise.race([
      Promise.allSettled(running).then(() => undefined),
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private safeErrorMessage(error: unknown): string {
    return safeErrorMessage(error, [this.secretStore.getGeminiApiKey() || '']);
  }

  public updateConfig(newConfig: Partial<AppConfig>): AppConfig {
    if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
      throw new InvalidConfigError('configuration', 'configuration must be an object');
    }

    for (const field of Object.keys(newConfig)) {
      if (!(UPDATEABLE_CONFIG_FIELDS as readonly string[]).includes(field)) {
        throw new InvalidConfigError(field, `${field} is not configurable`);
      }
    }

    const nextConfig = { ...this.config };

    if (Object.prototype.hasOwnProperty.call(newConfig, 'model')) {
      if (!this.isValidModel(newConfig.model)) {
        throw new InvalidConfigError('model', 'model must be a valid Gemini model name');
      }
      nextConfig.model = this.sanitizeModel(newConfig.model);
    }
    if (Object.prototype.hasOwnProperty.call(newConfig, 'segment_length_seconds')) {
      if (!this.isPositiveFiniteNumber(newConfig.segment_length_seconds)) {
        throw new InvalidConfigError('segment_length_seconds', 'segment_length_seconds must be a positive finite number');
      }
      nextConfig.segment_length_seconds = newConfig.segment_length_seconds;
    }
    if (Object.prototype.hasOwnProperty.call(newConfig, 'extract_transcript')) {
      if (typeof newConfig.extract_transcript !== 'boolean') {
        throw new InvalidConfigError('extract_transcript', 'extract_transcript must be a boolean');
      }
      nextConfig.extract_transcript = newConfig.extract_transcript;
    }
    if (Object.prototype.hasOwnProperty.call(newConfig, 'fine_search_window_seconds')) {
      if (!this.isPositiveFiniteNumber(newConfig.fine_search_window_seconds)) {
        throw new InvalidConfigError('fine_search_window_seconds', 'fine_search_window_seconds must be a positive finite number');
      }
      nextConfig.fine_search_window_seconds = newConfig.fine_search_window_seconds;
    }
    if (Object.prototype.hasOwnProperty.call(newConfig, 'fine_search_interval_seconds')) {
      if (!this.isPositiveFiniteNumber(newConfig.fine_search_interval_seconds)) {
        throw new InvalidConfigError('fine_search_interval_seconds', 'fine_search_interval_seconds must be a positive finite number');
      }
      nextConfig.fine_search_interval_seconds = newConfig.fine_search_interval_seconds;
    }
    if (nextConfig.fine_search_interval_seconds > nextConfig.fine_search_window_seconds) {
      throw new InvalidConfigError(
        'fine_search_interval_seconds',
        'fine_search_interval_seconds must not exceed fine_search_window_seconds',
      );
    }
    if (Object.prototype.hasOwnProperty.call(newConfig, 'max_screenshots_per_candidate')) {
      if (!Number.isInteger(newConfig.max_screenshots_per_candidate) || newConfig.max_screenshots_per_candidate < 1 || newConfig.max_screenshots_per_candidate > 4) {
        throw new InvalidConfigError('max_screenshots_per_candidate', 'max_screenshots_per_candidate must be an integer between 1 and 4');
      }
      nextConfig.max_screenshots_per_candidate = newConfig.max_screenshots_per_candidate;
    }
    if (Object.prototype.hasOwnProperty.call(newConfig, 'fine_search_fallback')) {
      if (newConfig.fine_search_fallback !== 'exact_timestamp' && newConfig.fine_search_fallback !== 'skip') {
        throw new InvalidConfigError('fine_search_fallback', 'fine_search_fallback must be exact_timestamp or skip');
      }
      nextConfig.fine_search_fallback = newConfig.fine_search_fallback;
    }
    if (Object.prototype.hasOwnProperty.call(newConfig, 'automatic_cleanup_enabled')) {
      if (typeof newConfig.automatic_cleanup_enabled !== 'boolean') {
        throw new InvalidConfigError('automatic_cleanup_enabled', 'automatic_cleanup_enabled must be a boolean');
      }
      nextConfig.automatic_cleanup_enabled = newConfig.automatic_cleanup_enabled;
    }

    this.configStore.save(this.toPersistedConfig(nextConfig));
    this.config = nextConfig;
    return this.getConfig();
  }

  private toPersistedConfig(config: AppConfig): PersistedAppConfig {
    return {
      model: config.model,
      segment_length_seconds: config.segment_length_seconds,
      extract_transcript: config.extract_transcript,
      fine_search_window_seconds: config.fine_search_window_seconds,
      fine_search_interval_seconds: config.fine_search_interval_seconds,
      max_screenshots_per_candidate: config.max_screenshots_per_candidate,
      fine_search_fallback: config.fine_search_fallback,
      automatic_cleanup_enabled: config.automatic_cleanup_enabled,
    };
  }

  private applyPersistedConfig(config: AppConfig, persisted: Partial<PersistedAppConfig> | null): AppConfig {
    if (!persisted) return config;
    const nextConfig = { ...config };

    if (this.isValidModel(persisted.model)) nextConfig.model = this.sanitizeModel(persisted.model);
    if (this.isPositiveFiniteNumber(persisted.segment_length_seconds)) nextConfig.segment_length_seconds = persisted.segment_length_seconds;
    if (typeof persisted.extract_transcript === 'boolean') nextConfig.extract_transcript = persisted.extract_transcript;
    if (this.isPositiveFiniteNumber(persisted.fine_search_window_seconds)) nextConfig.fine_search_window_seconds = persisted.fine_search_window_seconds;
    if (this.isPositiveFiniteNumber(persisted.fine_search_interval_seconds)) nextConfig.fine_search_interval_seconds = persisted.fine_search_interval_seconds;
    if (Number.isInteger(persisted.max_screenshots_per_candidate) && persisted.max_screenshots_per_candidate >= 1 && persisted.max_screenshots_per_candidate <= 4) {
      nextConfig.max_screenshots_per_candidate = persisted.max_screenshots_per_candidate;
    }
    if (persisted.fine_search_fallback === 'skip' || persisted.fine_search_fallback === 'exact_timestamp') {
      nextConfig.fine_search_fallback = persisted.fine_search_fallback;
    }
    if (typeof persisted.automatic_cleanup_enabled === 'boolean') nextConfig.automatic_cleanup_enabled = persisted.automatic_cleanup_enabled;
    if (nextConfig.fine_search_interval_seconds > nextConfig.fine_search_window_seconds) {
      nextConfig.fine_search_window_seconds = config.fine_search_window_seconds;
      nextConfig.fine_search_interval_seconds = config.fine_search_interval_seconds;
    }
    return nextConfig;
  }

  private isPositiveFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  private isValidModel(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim().replace(/^models\//, '');
    return /^gemini-[a-zA-Z0-9.\-]+$/.test(trimmed);
  }

  private createJobConfigSnapshot(): JobConfigSnapshot {
    return {
      model: this.config.model,
      segment_length_seconds: this.config.segment_length_seconds,
      extract_transcript: this.config.extract_transcript,
      fine_search_window_seconds: this.config.fine_search_window_seconds,
      fine_search_interval_seconds: this.config.fine_search_interval_seconds,
      max_screenshots_per_candidate: this.config.max_screenshots_per_candidate,
      fine_search_fallback: this.config.fine_search_fallback,
      automatic_cleanup_enabled: this.config.automatic_cleanup_enabled,
    };
  }

  private normalizeJobConfigSnapshot(snapshot?: Partial<JobConfigSnapshot>): JobConfigSnapshot {
    if (!snapshot || typeof snapshot !== 'object') return { ...DEFAULT_JOB_CONFIG_SNAPSHOT };

    const window = this.isPositiveFiniteNumber(snapshot.fine_search_window_seconds)
      ? snapshot.fine_search_window_seconds
      : DEFAULT_JOB_CONFIG_SNAPSHOT.fine_search_window_seconds;
    const interval = this.isPositiveFiniteNumber(snapshot.fine_search_interval_seconds)
      ? snapshot.fine_search_interval_seconds
      : DEFAULT_JOB_CONFIG_SNAPSHOT.fine_search_interval_seconds;

    return {
      model: typeof snapshot.model === 'string' ? this.sanitizeModel(snapshot.model) : DEFAULT_JOB_CONFIG_SNAPSHOT.model,
      segment_length_seconds: this.isPositiveFiniteNumber(snapshot.segment_length_seconds)
        ? snapshot.segment_length_seconds
        : DEFAULT_JOB_CONFIG_SNAPSHOT.segment_length_seconds,
      extract_transcript: typeof snapshot.extract_transcript === 'boolean'
        ? snapshot.extract_transcript
        : DEFAULT_JOB_CONFIG_SNAPSHOT.extract_transcript,
      fine_search_window_seconds: interval <= window ? window : DEFAULT_JOB_CONFIG_SNAPSHOT.fine_search_window_seconds,
      fine_search_interval_seconds: interval <= window ? interval : DEFAULT_JOB_CONFIG_SNAPSHOT.fine_search_interval_seconds,
      max_screenshots_per_candidate: Number.isInteger(snapshot.max_screenshots_per_candidate)
        && snapshot.max_screenshots_per_candidate >= 1
        && snapshot.max_screenshots_per_candidate <= 4
        ? snapshot.max_screenshots_per_candidate
        : DEFAULT_JOB_CONFIG_SNAPSHOT.max_screenshots_per_candidate,
      fine_search_fallback: snapshot.fine_search_fallback === 'skip' || snapshot.fine_search_fallback === 'exact_timestamp'
        ? snapshot.fine_search_fallback
        : DEFAULT_JOB_CONFIG_SNAPSHOT.fine_search_fallback,
      automatic_cleanup_enabled: typeof snapshot.automatic_cleanup_enabled === 'boolean'
        ? snapshot.automatic_cleanup_enabled
        : DEFAULT_JOB_CONFIG_SNAPSHOT.automatic_cleanup_enabled,
    };
  }

  private normalizeJob(job: JobResult): JobResult {
    const rawJob = (job && typeof job === 'object' ? job : {}) as Partial<JobResult>;
    const rawProgress = rawJob.progress && typeof rawJob.progress === 'object'
      ? rawJob.progress
      : {} as ScreenshotProgress;
    const rawAnalysis: Partial<JobResult['analysis']> = rawJob.analysis && typeof rawJob.analysis === 'object'
      ? rawJob.analysis
      : {};
    const analysis = {
      ...rawAnalysis,
      model: this.isValidModel(rawAnalysis.model) ? this.sanitizeModel(rawAnalysis.model) : DEFAULT_JOB_CONFIG_SNAPSHOT.model,
      processing_mode: typeof rawAnalysis.processing_mode === 'string' ? rawAnalysis.processing_mode : 'static_segments',
      segment_duration_seconds: this.isPositiveFiniteNumber(rawAnalysis.segment_duration_seconds)
        ? rawAnalysis.segment_duration_seconds
        : DEFAULT_JOB_CONFIG_SNAPSHOT.segment_length_seconds,
      segments_total: this.normalizeNonNegativeInteger(rawAnalysis.segments_total),
      segments_successful: this.normalizeNonNegativeInteger(rawAnalysis.segments_successful),
      segments_failed: this.normalizeNonNegativeInteger(rawAnalysis.segments_failed),
    };
    const status = (JOB_STATUSES as readonly string[]).includes(rawJob.status as string)
      ? rawJob.status
      : 'FAILED';
    const terminal = (TERMINAL_JOB_STATUSES as readonly string[]).includes(status as string);
    const progress: ScreenshotProgress = {
      ...DEFAULT_SCREENSHOT_PROGRESS,
      segments_completed: this.normalizeNonNegativeInteger(rawProgress.segments_completed,
        analysis.segments_successful + analysis.segments_failed),
      segments_total: this.normalizeNonNegativeInteger(rawProgress.segments_total, analysis.segments_total),
      candidates_completed: this.normalizeNonNegativeInteger(rawProgress.candidates_completed),
      candidates_total: this.normalizeNonNegativeInteger(rawProgress.candidates_total),
      screenshots_completed: this.normalizeNonNegativeInteger(rawProgress.screenshots_completed),
      screenshots_failed: this.normalizeNonNegativeInteger(rawProgress.screenshots_failed),
      fine_search_frames_examined: this.normalizeNonNegativeInteger(rawProgress.fine_search_frames_examined),
    };
    const normalizedOutputDirectory = this.normalizeSafeRelativePath(rawJob.output_directory);
    const rawJobWithLegacyFields = rawJob as JobResult & { external_storage?: unknown };
    const {
      output_directory: _invalidOutputDirectory,
      external_storage: _legacyExternalStorage,
      ...jobWithoutLegacyFields
    } = rawJobWithLegacyFields;

    return {
      ...jobWithoutLegacyFields,
      ...(normalizedOutputDirectory ? { output_directory: normalizedOutputDirectory } : {}),
      schema_version: CURRENT_JOB_SCHEMA_VERSION,
      job_id: typeof rawJob.job_id === 'string' ? rawJob.job_id : '',
      correlation_id: typeof rawJob.correlation_id === 'string' ? rawJob.correlation_id : (typeof rawJob.job_id === 'string' ? rawJob.job_id : ''),
      status,
      phase: JOB_PHASES.includes(rawJob.phase as JobPhase) ? rawJob.phase as JobPhase : terminal ? 'FINALIZING' : 'ANALYSIS',
      progress,
      config_snapshot: this.normalizeJobConfigSnapshot(rawJob.config_snapshot),
      source: rawJob.source && typeof rawJob.source === 'object' ? rawJob.source : { type: 'unknown', url: '' },
      video: rawJob.video && typeof rawJob.video === 'object' ? rawJob.video : {},
      analysis,
      inventory: Array.isArray(rawJob.inventory) ? rawJob.inventory : [],
      screenshot_candidates: Array.isArray(rawJob.screenshot_candidates) ? rawJob.screenshot_candidates : [],
      warnings: Array.isArray(rawJob.warnings) ? rawJob.warnings.filter((value): value is string => typeof value === 'string') : [],
      errors: Array.isArray(rawJob.errors) ? rawJob.errors.filter((value): value is string => typeof value === 'string') : [],
    } as JobResult;
  }

  private normalizeNonNegativeInteger(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  }

  private normalizeSafeRelativePath(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001F\u007F]/.test(value)) return undefined;
    const candidate = value.trim();
    if (!candidate || candidate.includes('\\') || candidate.includes(':') || candidate.startsWith('/') || candidate.startsWith('//')) {
      return undefined;
    }
    const normalized = path.posix.normalize(candidate);
    if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
      return undefined;
    }
    return normalized;
  }

  private isAcceptedJobId(jobId: unknown): jobId is string {
    return typeof jobId === 'string' && UUID_V4_PATTERN.test(jobId);
  }

  private isContainedWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
  }

  private getLegacyJobPath(jobId: string): string | null {
    if (!this.isAcceptedJobId(jobId)) return null;
    const resolvedPath = path.resolve(this.canonicalDataDir, `${jobId}.json`);
    if (!this.isContainedWithin(this.canonicalDataDir, resolvedPath)) return null;

    let canonicalPath = resolvedPath;
    try {
      canonicalPath = fs.realpathSync(resolvedPath);
    } catch {
      canonicalPath = path.resolve(fs.realpathSync(path.dirname(resolvedPath)), path.basename(resolvedPath));
    }
    return this.isContainedWithin(this.canonicalDataDir, canonicalPath) ? resolvedPath : null;
  }

  public getManifestPath(jobId: string): string {
    if (!this.isAcceptedJobId(jobId)) throw new InvalidJobIdError(jobId);
    return this.outputLayout.manifestPath(jobId);
  }

  public isCancellationRequested(jobId: string): boolean {
    return this.cancellationRequested.has(jobId);
  }

  public getAbortSignal(jobId: string): AbortSignal | undefined {
    return this.abortControllers.get(jobId)?.signal;
  }

  public getEventLogger(): JobEventLogger {
    return this.eventLogger;
  }

  public getJobEvents(jobId: string) {
    if (!this.isAcceptedJobId(jobId)) return this.eventLogger.emptyResponse();
    return this.eventLogger.getForJob(jobId);
  }

  public getAllJobEvents() {
    return this.eventLogger.getAll();
  }

  public throwIfCancellationRequested(jobId: string): void {
    if (this.isCancellationRequested(jobId)) {
      throw new JobCancellationError(jobId);
    }
  }

  public cancelJob(jobId: string): JobResult {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error('Job not found');
    }
    if (job.status !== 'QUEUED' && job.status !== 'PROCESSING') {
      throw new Error('Job is not active');
    }

    this.cancellationRequested.add(jobId);
    this.abortControllers.get(jobId)?.abort();
    job.status = 'CANCELLED';
    job.completed_at = new Date().toISOString();
    this.saveJob(job);
    this.eventLogger.append({ job_id: jobId, type: 'JOB_CANCELLED', provider: 'app', status: 'CANCELLED' });
    return job;
  }

  public clearHistory(): number {
    const jobFiles = fs.readdirSync(this.dataDir)
      .filter(file => file.endsWith('.json'))
      .filter(file => this.isAcceptedJobId(path.basename(file, '.json')));
    const jobIds = new Set(jobFiles
      .map(file => path.basename(file, '.json'))
    );
    const outputRoot = path.join(this.canonicalDataDir, 'output');
    const outputDirectories = fs.existsSync(outputRoot)
      ? fs.readdirSync(outputRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && this.isContainedWithin(outputRoot, path.join(outputRoot, entry.name)))
        .map(entry => ({ entry, directory: path.join(outputRoot, entry.name) }))
      : [];

    for (const { entry } of outputDirectories) {
      const jobId = entry.name.split('--', 1)[0];
      if (this.isAcceptedJobId(jobId)) jobIds.add(jobId);
    }

    for (const [jobId, job] of this.activeJobs) {
      this.cancellationRequested.add(jobId);
      this.abortControllers.get(jobId)?.abort();
      this.historyClearedJobs.add(jobId);
      job.status = 'CANCELLED';
      job.completed_at = new Date().toISOString();
      jobIds.add(jobId);
    }

    for (const jobId of this.runningJobs) {
      this.cancellationRequested.add(jobId);
      this.abortControllers.get(jobId)?.abort();
      this.historyClearedJobs.add(jobId);
      jobIds.add(jobId);
    }

    this.activeJobs.clear();

    for (const file of jobFiles) {
      try {
        fs.unlinkSync(path.join(this.dataDir, file));
      } catch (err) {
        console.error(`Error deleting job history file ${file}: ${this.safeErrorMessage(err)}`);
      }
    }

    for (const { directory } of outputDirectories) {
      try {
        fs.rmSync(directory, { recursive: true, force: true });
      } catch (err) {
        console.error(`Error deleting job output directory ${directory}: ${this.safeErrorMessage(err)}`);
      }
    }

    return jobIds.size;
  }

  /**
   * Löscht ausschließlich Logdateien. Job-Ergebnisdateien bleiben erhalten.
   * Aktive Jobs werden zuerst abgebrochen und ihre später eintreffenden
   * Ereignisse unterdrückt, damit die Löschung nicht sofort wieder beschrieben wird.
   */
  public clearAllLogs(): number {
    const activeJobIds = new Set([...this.activeJobs.keys(), ...this.runningJobs]);
    for (const jobId of activeJobIds) {
      this.eventLogger.suppressJob(jobId);
      this.cancellationRequested.add(jobId);
      this.abortControllers.get(jobId)?.abort();
      const job = this.activeJobs.get(jobId);
      if (job) {
        job.status = 'CANCELLED';
        job.completed_at ||= new Date().toISOString();
        this.saveJob(job);
      }
    }

    let deletedCount = this.eventLogger.clear();
    const additionalLogFiles = fs.readdirSync(this.dataDir)
      .filter(file => /\.(?:jsonl|log)$/i.test(file) && file !== 'events.jsonl');
    for (const file of additionalLogFiles) {
      try {
        fs.unlinkSync(path.join(this.dataDir, file));
        deletedCount += 1;
      } catch (err) {
      console.error(`Error deleting log file ${file}: ${this.safeErrorMessage(err)}`);
      }
    }
    return deletedCount;
  }

  private sanitizeModel(model?: string): string {
    if (!this.isValidModel(model)) return 'gemini-3.8-flash';
    const trimmed = model.trim().replace(/^models\//, '');
    return trimmed;
  }

  private loadActiveJobs() {
    const manifestPaths: string[] = [];
    const outputRoot = path.join(this.canonicalDataDir, 'output');
    try {
      if (fs.existsSync(outputRoot)) {
        for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const manifestPath = path.join(outputRoot, entry.name, 'manifest.json');
          if (!fs.existsSync(manifestPath) || !this.isContainedWithin(this.canonicalDataDir, path.resolve(manifestPath))) continue;
          try {
            if (this.isContainedWithin(this.canonicalDataDir, fs.realpathSync(manifestPath))) manifestPaths.push(manifestPath);
          } catch {
            // Broken symlinks and unreadable entries are ignored during startup.
          }
        }
      }

      // Legacy root manifests remain readable so an upgrade does not hide existing jobs.
      for (const file of fs.readdirSync(this.dataDir)) {
        const jobId = path.basename(file, '.json');
        const legacyPath = file.endsWith('.json') ? this.getLegacyJobPath(jobId) : null;
        if (legacyPath && fs.existsSync(legacyPath)) manifestPaths.push(legacyPath);
      }
    } catch (err) {
      console.error(`Error locating jobs on startup: ${this.safeErrorMessage(err)}`);
    }

    for (const manifestPath of manifestPaths) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as JobResult;
        if (!this.isAcceptedJobId(parsed.job_id)) continue;
        const job: JobResult = this.normalizeJob(parsed);
        if (job.status === 'QUEUED' || job.status === 'PROCESSING') {
          job.status = 'FAILED';
          job.errors.push('Job interrupted by server restart.');
          job.phase = 'FINALIZING';
        }
        this.saveJob(job);
      } catch (err) {
        console.error(`Error loading job manifest ${manifestPath}: ${this.safeErrorMessage(err)}`);
      }
    }
  }

  public createJob(url: string, correlationId?: string): JobResult {
    if (this.shutdownRequested) throw new ApplicationShuttingDownError();
    const jobId = randomUUID();
    const configSnapshot = this.createJobConfigSnapshot();
    const job: JobResult = {
      schema_version: CURRENT_JOB_SCHEMA_VERSION,
      job_id: jobId,
      correlation_id: correlationId || jobId,
      status: 'QUEUED',
      phase: 'ANALYSIS',
      progress: {
        segments_completed: 0,
        segments_total: 0,
        candidates_completed: 0,
        candidates_total: 0,
        screenshots_completed: 0,
        screenshots_failed: 0,
        fine_search_frames_examined: 0,
      },
      config_snapshot: configSnapshot,
      source: {
        type: 'youtube',
        url,
      },
      video: {},
      analysis: {
        model: this.config.model,
        processing_mode: 'static_segments',
        segment_duration_seconds: this.config.segment_length_seconds,
        segments_total: 0,
        segments_successful: 0,
        segments_failed: 0,
      },
      inventory: [],
      screenshot_candidates: [],
      warnings: [],
      errors: [],
      created_at: new Date().toISOString(),
    };

    this.saveJob(job);
    this.eventLogger.append({ job_id: jobId, type: 'JOB_CREATED', provider: 'app' });
    const runningPromise = this.startJob(jobId);
    this.runningPromises.set(jobId, runningPromise);
    const removeRunningPromise = () => {
      if (this.runningPromises.get(jobId) === runningPromise) this.runningPromises.delete(jobId);
    };
    void runningPromise.then(removeRunningPromise, removeRunningPromise);
    return job;
  }

  public getJob(jobId: string): JobResult | null {
    if (!this.isAcceptedJobId(jobId)) return null;
    if (this.historyClearedJobs.has(jobId)) {
      return null;
    }
    if (this.activeJobs.has(jobId)) {
      return this.activeJobs.get(jobId) || null;
    }
    const manifestPath = this.getManifestPath(jobId);
    if (fs.existsSync(manifestPath)) {
      const content = fs.readFileSync(manifestPath, 'utf8');
      const parsed = JSON.parse(content) as JobResult;
      if (parsed.job_id !== jobId) return null;
      const job = this.normalizeJob(parsed);
      this.saveJob(job);
      return job;
    }

    const legacyPath = this.getLegacyJobPath(jobId);
    if (legacyPath && fs.existsSync(legacyPath)) {
      const parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf8')) as JobResult;
      if (parsed.job_id !== jobId) return null;
      const job = this.normalizeJob(parsed);
      this.saveJob(job);
      return job;
    }
    return null;
  }

  public listPersistedJobs(): JobResult[] {
    const jobIds = new Set<string>(this.activeJobs.keys());
    const outputRoot = path.join(this.canonicalDataDir, 'output');
    if (fs.existsSync(outputRoot)) {
      for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const jobId = entry.name.split('--', 1)[0];
        if (this.isAcceptedJobId(jobId)) jobIds.add(jobId);
      }
    }
    for (const file of fs.readdirSync(this.dataDir)) {
      const jobId = path.basename(file, '.json');
      if (file.endsWith('.json') && this.isAcceptedJobId(jobId)) jobIds.add(jobId);
    }
    return [...jobIds]
      .map(jobId => this.getJob(jobId))
      .filter((job): job is JobResult => job !== null)
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  }

  public saveJob(job: JobResult) {
    if (!this.isAcceptedJobId(job?.job_id)) throw new InvalidJobIdError(job?.job_id);
    Object.assign(job, this.normalizeJob(job));
    if (this.historyClearedJobs.has(job.job_id)) {
      this.activeJobs.delete(job.job_id);
      const manifestPath = this.getManifestPath(job.job_id);
      if (fs.existsSync(manifestPath)) {
        fs.unlinkSync(manifestPath);
      }
      return;
    }

    if (job.status === 'QUEUED' || job.status === 'PROCESSING') {
      this.activeJobs.set(job.job_id, job);
    } else {
      this.activeJobs.delete(job.job_id);
    }
    const title = typeof job.video?.title === 'string' ? job.video.title : undefined;
    this.artifactWriter.writeManifest(job.job_id, job, title);
    this.writeOutputArtifacts(job, title);
  }

  private writeOutputArtifacts(job: JobResult, title?: string): void {
    this.artifactWriter.writeSource(job.job_id, {
      source_type: job.source.type,
      source_url: job.source.url,
      youtube_video_id: job.source.youtube_video_id,
    }, title);
    this.artifactWriter.writeInfo(job.job_id, job.video, title);
    this.artifactWriter.writeDescription(job.job_id, job.video.title || '', title);
    this.artifactWriter.writeScenes(job.job_id, job.screenshot_candidates, title);
    if (job.transcript) this.artifactWriter.writeTranscript(job.job_id, job.transcript, title);
  }

  private async startJob(jobId: string) {
    const job = this.getJob(jobId);
    if (!job) return;

    job.status = 'PROCESSING';
    this.saveJob(job);
    this.eventLogger.append({ job_id: jobId, type: 'JOB_STARTED', provider: 'app' });
    this.runningJobs.add(jobId);
    this.abortControllers.set(jobId, new AbortController());

    try {
      await this.processor(job, this);
      if (this.isCancellationRequested(jobId) || (job.status as string) === 'CANCELLED') {
        if (!this.historyClearedJobs.has(jobId)) {
          job.status = 'CANCELLED';
          job.completed_at ||= new Date().toISOString();
          this.saveJob(job);
        }
        return;
      }

      if (!this.historyClearedJobs.has(jobId) && ['COMPLETED', 'PARTIAL'].includes(job.status as string)) {
        this.eventLogger.append({ job_id: jobId, type: 'JOB_COMPLETED', provider: 'app', status: 'SUCCEEDED' });
      }
    } catch (err: any) {
      if (this.isCancellationRequested(jobId) || (job.status as string) === 'CANCELLED' || err instanceof JobCancellationError) {
        if (!this.historyClearedJobs.has(jobId)) {
          job.status = 'CANCELLED';
          job.completed_at ||= new Date().toISOString();
          this.saveJob(job);
        }
        return;
      }

      const errorMessage = this.safeErrorMessage(err);
      console.error(`Job ${jobId} failed completely: ${errorMessage}`);
      job.status = 'FAILED';
      job.phase = 'FINALIZING';
      job.errors.push(errorMessage);
      job.completed_at = new Date().toISOString();
      this.saveJob(job);
      this.eventLogger.append({ job_id: jobId, type: 'JOB_FAILED', provider: 'app', status: 'FAILED' });
    } finally {
      this.runningJobs.delete(jobId);
      this.abortControllers.delete(jobId);
    }
  }
}

export const jobManager = new JobManager();
