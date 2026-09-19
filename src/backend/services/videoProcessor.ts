import path from 'path';
import fs from 'fs';
import type { JobManager } from './jobManager';
import { JobResult, InventoryItem, ScreenshotCandidate, FailedSegment, ScreenshotMetadata } from '../../shared/types';
import { youtubeService } from './youtubeService';
import { geminiService } from './geminiService';
import { MediaSourceService } from './mediaSourceService';
import { FrameExtractor } from './frameExtractor';
import { ScreenshotEvaluator } from './screenshotEvaluator';
import { ScreenshotStorage } from './screenshotStorage';
import { safeErrorMessage } from './secretRedactor';
import { ScreenshotPipeline } from './screenshotPipeline';

const TEMP_DIR = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const STAGE1_PROMPT = `Analysiere ausschließlich den visuellen Inhalt dieses Videoabschnitts möglichst vollständig.

Deine Aufgabe ist NICHT, bereits zu entscheiden, welche Inhalte fachlich am wichtigsten sind.
Erstelle zunächst eine visuelle Inventur aller unterschiedlichen informationshaltigen Bildschirmzustände.

Achte insbesondere auf:
- Benutzeroberflächen
- Software-Oberflächen
- Systemdarstellungen
- Diagramme
- Systemarchitekturen
- Workflows
- Prozessdarstellungen
- Tabellen
- Einstellungen
- Konfigurationen
- Code
- Menüs
- Dashboards
- Grafiken
- Folien
- Vorher-/Nachher-Zustände
- Demonstrationen
- fertige Ergebnisse
- visuell dargestellte Abläufe
- Übersichten über Systeme oder Komponenten
- Zustände, die nur kurz eingeblendet werden, aber relevante Informationen enthalten

Ein visueller Zustand muss ausdrücklich auch dann erfasst werden, wenn der Sprecher ihn NICHT erwähnt.
Audio, Sprache oder Transkript dürfen nicht darüber entscheiden, ob ein visueller Zustand aufgenommen wird.
Die visuelle Darstellung selbst ist die maßgebliche Evidenz.

Ignoriere reine Talking-Head-Szenen, wenn neben der sprechenden Person keine zusätzlichen relevanten Informationen sichtbar sind.
Bewerte in dieser Stufe NICHT, ob ein Zustand für das Gesamtvideo wichtig genug ist.
Ziel ist zunächst möglichst hohe visuelle Vollständigkeit.`;

const STAGE2_PROMPT = `Führe sämtliche Ergebnisse der Segmentanalysen zusammen.

Danach:
1. entferne eindeutige visuelle Dubletten;
2. fasse praktisch identische Bildschirmzustände zusammen;
3. entferne bedeutungslose Übergänge;
4. entferne reine Talking-Head-Szenen ohne Informationswert;
5. erhalte visuell unterschiedliche und informationshaltige Zustände;
6. bewerte erst jetzt deren Nutzen für das Verständnis des Videos (information_score 0-100).

Eine visuell wichtige Darstellung darf niemals allein deshalb verworfen werden, weil sie im Transkript nicht erwähnt wird, der Sprecher nicht darüber spricht, sie nur einige Sekunden sichtbar ist oder andere Abschnitte sprachlich ausführlicher behandelt werden.

Der visuelle Inhalt muss unabhängig bewertet werden.
Erstelle eine chronologische Liste geeigneter Screenshot-Kandidaten.
visual_only = true bedeutet: Der Informationswert ergibt sich wesentlich aus dem sichtbaren Bild und nicht nur aus Sprache beziehungsweise Transkript.`;

function waitWithAbort(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) {
    const error = new Error('Video processing request aborted.');
    error.name = 'AbortError';
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
      const error = new Error('Video processing request aborted.');
      error.name = 'AbortError';
      reject(error);
    };
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function buildSegmentRanges(
  totalDuration: number,
  segmentDuration: number,
): Array<{ start: number; end: number }> {
  const effectiveDuration = segmentDuration > 0 ? segmentDuration : 60;
  const totalSegments = Math.max(1, Math.ceil(totalDuration / effectiveDuration));

  return Array.from({ length: totalSegments }, (_, index) => ({
    start: index * effectiveDuration,
    end: Math.min((index + 1) * effectiveDuration, totalDuration),
  }));
}

export async function processVideoJob(job: JobResult, jobManager: JobManager) {
  let localVideoPath: string | null = null;
  let geminiFileName: string | null = null;
  const abortSignal = jobManager.getAbortSignal(job.job_id);
  const safeMessage = (error: unknown) => safeErrorMessage(error, [jobManager.getSecretStore().getGeminiApiKey() || '']);
  const createEventContext = (operation: 'YOUTUBE_OEMBED' | 'VIDEO_METADATA' | 'SEGMENT_ANALYSIS' | 'TRANSCRIPT_EXTRACTION' | 'INVENTORY_CONSOLIDATION' | 'SCREENSHOT_EVALUATION', details?: Record<string, number>) => ({
    jobId: job.job_id,
    logger: jobManager.getEventLogger(),
    operation,
    provider: operation === 'YOUTUBE_OEMBED' ? 'youtube' as const : 'gemini' as const,
    model: job.analysis.model,
    details,
  });

  try {
    jobManager.throwIfCancellationRequested(job.job_id);

    // 1. Get info & canonical URL
    console.log(`Job ${job.job_id}: Fetching video info for ${job.source.url}`);
    const videoInfo = await youtubeService.getVideoInfo(job.source.url, abortSignal, createEventContext('YOUTUBE_OEMBED'));
    jobManager.throwIfCancellationRequested(job.job_id);
    job.video.title = videoInfo.title;
    job.video.duration_seconds = videoInfo.duration;
    job.source.youtube_video_id = videoInfo.id;
    job.video.author = videoInfo.author;
    job.video.thumbnail_url = videoInfo.thumbnail_url;
    jobManager.saveJob(job);

    // Gemini API natively understands YouTube URLs directly as fileUri!
    // No download, no binary dependencies, no YouTube bot blocking.
    const fileUri = videoInfo.canonical_url;
    console.log(`Job ${job.job_id}: Using native Gemini YouTube understanding for ${fileUri}`);

    // 2. Use the configured segment duration exactly as selected by the user.
    const segmentDuration = job.analysis.segment_duration_seconds || 60;
    const totalDuration = videoInfo.duration;
    const segmentRanges = buildSegmentRanges(totalDuration, segmentDuration);
    const totalSegments = segmentRanges.length;
    job.analysis.segment_duration_seconds = segmentDuration;
    job.analysis.segments_total = totalSegments;
    job.progress.segments_total = totalSegments;
    jobManager.throwIfCancellationRequested(job.job_id);
    jobManager.saveJob(job);

    const inventory: InventoryItem[] = [];
    const failedSegments: FailedSegment[] = [];
    job.failed_segments = failedSegments;

    console.log(`Job ${job.job_id}: Processing ${totalSegments} segments (duration: ${segmentDuration}s each, total: ${totalDuration}s)...`);

    // Process segments sequentially with pacing to avoid hitting rate limits
    for (let i = 0; i < totalSegments; i++) {
      jobManager.throwIfCancellationRequested(job.job_id);
      const { start, end } = segmentRanges[i];
      
      let success = false;
      let retries = 0;
      const MAX_RETRIES = 2;
      let lastError = '';

      while (!success && retries <= MAX_RETRIES) {
        jobManager.throwIfCancellationRequested(job.job_id);
        try {
          console.log(`Job ${job.job_id}: Analyzing segment ${i+1}/${totalSegments} (${start}s - ${end}s) - Try ${retries + 1}`);
          const segmentInventory = await geminiService.analyzeSegment(
            fileUri,
            start,
            end,
            STAGE1_PROMPT,
            job.analysis.model,
            abortSignal,
            createEventContext('SEGMENT_ANALYSIS', { segment: i + 1, start_seconds: start, end_seconds: end, attempt: retries + 1 }),
          );
          jobManager.throwIfCancellationRequested(job.job_id);
          inventory.push(...segmentInventory);
          success = true;
          job.analysis.segments_successful++;
        } catch (err: any) {
          if (jobManager.isCancellationRequested(job.job_id)) {
            throw err;
          }
          lastError = safeMessage(err);
          console.error(`Job ${job.job_id}: Segment ${i+1} failed: ${lastError}`);
          retries++;
          if (retries <= MAX_RETRIES) {
            jobManager.getEventLogger().append({
              job_id: job.job_id,
              type: 'RETRY_SCHEDULED',
              operation: 'SEGMENT_ANALYSIS',
              provider: 'app',
              details: { segment: i + 1, attempt: retries + 1, wait_ms: 4000 * retries },
            });
            console.log(`Job ${job.job_id}: Waiting before retrying segment ${i+1}...`);
            await waitWithAbort(4000 * retries, abortSignal);
            jobManager.throwIfCancellationRequested(job.job_id);
          }
        }
      }

      if (!success) {
        job.analysis.segments_failed++;
        failedSegments.push({
          segmentNumber: i + 1,
          startSeconds: start,
          endSeconds: end,
          errorCode: 'SEGMENT_ANALYSIS_FAILED',
          errorMessage: lastError,
          retries: MAX_RETRIES
        });
      }

      job.progress.segments_completed = job.analysis.segments_successful + job.analysis.segments_failed;

      // Save partial progress
      jobManager.throwIfCancellationRequested(job.job_id);
      job.inventory = inventory;
      jobManager.saveJob(job);

      // Pacing delay between segments to respect API limits
      if (i < totalSegments - 1) {
        await waitWithAbort(2000, abortSignal);
        jobManager.throwIfCancellationRequested(job.job_id);
      }
    }

    if (job.analysis.segments_failed === totalSegments && totalSegments > 0) {
       throw new Error("All segments failed during Stage 1 analysis.");
    }

    // 4. Extract Transcript (if enabled)
    const jobConfig = job.config_snapshot ?? jobManager.getConfig();
    if (jobConfig.extract_transcript && fileUri) {
      jobManager.throwIfCancellationRequested(job.job_id);
      job.phase = 'TRANSCRIPT_EXTRACTION';
      jobManager.saveJob(job);
      try {
        console.log(`Job ${job.job_id}: Extracting full audio transcript via Gemini...`);
        const transcript = await geminiService.extractTranscript(fileUri, job.analysis.model, abortSignal, createEventContext('TRANSCRIPT_EXTRACTION'));
        jobManager.throwIfCancellationRequested(job.job_id);
        job.transcript = transcript;
        jobManager.saveJob(job);
        console.log(`Job ${job.job_id}: Transcript extraction succeeded (${transcript.segments?.length || 0} segments).`);
      } catch (transcriptError: any) {
        if (jobManager.isCancellationRequested(job.job_id)) {
          throw transcriptError;
        }
        const transcriptErrorMessage = safeMessage(transcriptError);
        console.warn(`Job ${job.job_id}: Transcript extraction failed: ${transcriptErrorMessage}`);
        job.warnings.push(`Transkript-Extraktion nicht möglich: ${transcriptErrorMessage}`);
      }
    }

    // 5. Stage 2: Consolidate
    jobManager.throwIfCancellationRequested(job.job_id);
    job.phase = 'INVENTORY_CONSOLIDATION';
    jobManager.saveJob(job);
    console.log(`Job ${job.job_id}: Consolidating inventory...`);
    const screenshotCandidates: ScreenshotCandidate[] = await geminiService.consolidateInventory(
      inventory,
      STAGE2_PROMPT,
      job.analysis.model,
      abortSignal,
      createEventContext('INVENTORY_CONSOLIDATION'),
    );
    jobManager.throwIfCancellationRequested(job.job_id);

    if (screenshotCandidates.length > 0) {
      job.phase = 'SCREENSHOT_EXTRACTION';
      job.progress.candidates_total = screenshotCandidates.length;
      jobManager.saveJob(job);
      jobManager.getEventLogger().append({ job_id: job.job_id, type: 'SCREENSHOT_PHASE_STARTED', operation: 'SCREENSHOT_EXTRACTION', provider: 'app' });
      const processRegistry = jobManager.getProcessRegistry();
      const media = await new MediaSourceService({ dataDir: jobManager.getConfig().data_dir, processRegistry }).materialize({ jobId: job.job_id, title: job.video.title, sourceUrl: videoInfo.canonical_url, abortSignal });
      const extractor = new FrameExtractor({ processRegistry });
      const evaluator = new ScreenshotEvaluator({ generate: request => geminiService.evaluateScreenshotFrames({ prompt: request.prompt, frames: request.frames as Array<{ frame_id: string; png: Buffer }>, modelOverride: job.analysis.model, abortSignal, eventContext: createEventContext('SCREENSHOT_EVALUATION') }) });
      const storage = new ScreenshotStorage({ dataDir: jobManager.getConfig().data_dir, externalOutputDir: jobManager.getExternalOutputDir(job.job_id) });
      for (let index = 0; index < screenshotCandidates.length; index++) {
        const candidate = screenshotCandidates[index];
        const pipeline = new ScreenshotPipeline({
          extractFrame: async ({ timestampSeconds, frameId }) => { jobManager.throwIfCancellationRequested(job.job_id); const outputPath = path.join(TEMP_DIR, `${job.job_id}-${candidate.candidate_id}-${frameId}.png`); const frame = await extractor.extract({ sourcePath: media.localPath, timestampSeconds, durationSeconds: videoInfo.duration, outputPath, abortSignal }); return { ...frame, png: fs.readFileSync(outputPath) }; },
          evaluate: input => evaluator.evaluate({ candidateId: input.candidate.candidate_id, description: input.candidate.visual_description, category: input.candidate.category, targetTimestampSeconds: input.candidate.timestamp_seconds, frames: input.frames.filter(frame => frame.png) as Array<{ frame_id: string; timestamp_seconds: number; png: Buffer }> }),
          store: async input => storage.store({ jobId: job.job_id, title: job.video.title, sceneNumber: index + 1, screenshotId: `${candidate.candidate_id}-${input.role.toLowerCase()}-${input.existingCount + 1}`, role: input.role, timestampSeconds: input.timestampSeconds, sourcePng: fs.readFileSync(path.join(TEMP_DIR, `${job.job_id}-${candidate.candidate_id}-${input.frameId}.png`)), existingCount: input.existingCount }),
        });
        const temporaryPrefix = `${job.job_id}-${candidate.candidate_id}-`;
        try {
          await pipeline.run(candidate, { durationSeconds: videoInfo.duration, window: jobConfig.fine_search_window_seconds, interval: jobConfig.fine_search_interval_seconds, maxScreenshots: jobConfig.max_screenshots_per_candidate, fallback: jobConfig.fine_search_fallback, throwIfCancelled: () => jobManager.throwIfCancellationRequested(job.job_id) });
          job.screenshot_candidates = screenshotCandidates;
          job.progress.candidates_completed++;
          job.progress.fine_search_frames_examined += candidate.fine_search_frames?.length ?? 0;
          job.progress.screenshots_completed += candidate.screenshots?.length ?? 0;
          if (candidate.status === 'FAILED' || candidate.status === 'PARTIAL') job.progress.screenshots_failed++;
          const externalStatuses = (candidate.screenshots || []).map(screenshot => (screenshot as ScreenshotMetadata & { external_storage?: { status?: string } }).external_storage?.status).filter(Boolean);
          if (externalStatuses.includes('FAILED')) {
            job.external_storage = { status: 'FAILED', warning: 'Mindestens eine externe Screenshot-Kopie ist fehlgeschlagen.' };
            jobManager.getEventLogger().append({ job_id: job.job_id, type: 'EXTERNAL_COPY_FAILED', operation: 'EXTERNAL_COPY', provider: 'app', details: { candidate: index + 1 } });
          } else if (externalStatuses.includes('COMPLETED')) {
            job.external_storage = { status: 'COMPLETED' };
            jobManager.getEventLogger().append({ job_id: job.job_id, type: 'EXTERNAL_COPY_COMPLETED', operation: 'EXTERNAL_COPY', provider: 'app', details: { candidate: index + 1 } });
          }
          jobManager.getEventLogger().append({ job_id: job.job_id, type: 'SCREENSHOT_CANDIDATE_COMPLETED', operation: 'SCREENSHOT_STORAGE', provider: 'app', details: { candidate: index + 1, screenshots: candidate.screenshots?.length ?? 0, status: candidate.status || 'SKIPPED' } });
          jobManager.saveJob(job);
        } finally {
          for (const file of fs.readdirSync(TEMP_DIR).filter(name => name.startsWith(temporaryPrefix))) {
            fs.rmSync(path.join(TEMP_DIR, file), { force: true });
          }
        }
      }
      jobManager.getEventLogger().append({ job_id: job.job_id, type: 'SCREENSHOT_PHASE_COMPLETED', operation: 'SCREENSHOT_EXTRACTION', provider: 'app' });
    }
    
    // Cleanup Gemini file
    if (geminiFileName) {
       await geminiService.deleteVideo(geminiFileName);
    }

    // 6. Finalize Job
    jobManager.throwIfCancellationRequested(job.job_id);
    job.phase = 'FINALIZING';
    job.screenshot_candidates = screenshotCandidates;
    job.status = job.analysis.segments_failed > 0 || job.progress.screenshots_failed > 0 ? 'PARTIAL' : 'COMPLETED';
    job.completed_at = new Date().toISOString();
    jobManager.saveJob(job);
    console.log(`Job ${job.job_id} completed with status ${job.status}`);

  } catch (err: any) {
    if (localVideoPath && fs.existsSync(localVideoPath)) fs.unlinkSync(localVideoPath);
    if (geminiFileName) await geminiService.deleteVideo(geminiFileName);

    throw err;
  }
}
