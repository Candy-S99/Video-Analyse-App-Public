import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { InvalidConfigError, JobManager } from '../src/backend/services/jobManager.ts';
import { youtubeService } from '../src/backend/services/youtubeService.ts';
import { geminiService } from '../src/backend/services/geminiService.ts';

function createTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-job-test-'));
}

const fixtureJobId = '00000000-0000-4000-8000-000000000001';

function createJob(jobId, status = 'COMPLETED') {
  return {
    schema_version: '1.0',
    job_id: jobId,
    correlation_id: jobId,
    status,
    phase: 'FINALIZING',
    progress: {
      segments_completed: 2,
      segments_total: 2,
      candidates_completed: 1,
      candidates_total: 1,
      screenshots_completed: 2,
      screenshots_failed: 0,
      fine_search_frames_examined: 3,
    },
    external_storage: { status: 'NOT_CONFIGURED' },
    source: { type: 'youtube', url: 'https://www.youtube.com/watch?v=test' },
    video: { title: 'Testvideo' },
    analysis: {
      model: 'gemini-3.8-flash',
      processing_mode: 'static_segments',
      segment_duration_seconds: 30,
      segments_total: 2,
      segments_successful: 0,
      segments_failed: 0,
    },
    inventory: [],
    screenshot_candidates: [{
      candidate_id: 'scene-001',
      timestamp_seconds: 23,
      timestamp_display: '00:23',
      start_seconds: 22,
      end_seconds: 24,
      visual_description: 'Diagramm mit hervorgehobener Datenverbindung',
      category: 'diagram',
      information_score: 92,
      visual_only: true,
      screenshot_recommended: true,
      duplicate_group: 'scene-001',
      source_segment: 1,
      status: 'COMPLETED',
      screenshots: [
        {
          screenshot_id: 'scene-001-primary',
          role: 'PRIMARY',
          status: 'COMPLETED',
          retention_status: 'ACTIVE',
          extraction_timestamp_seconds: 23,
          timestamp_offset_seconds: 0,
          filename: 'scene-001-primary.png',
          relative_path: '06-screenshots/scene-001-primary.png',
          api_url: `/api/v1/video-analysis/jobs/${jobId}/screenshots/scene-001-primary`,
          mime_type: 'image/png',
          width: 1920,
          height: 1080,
          file_size_bytes: 123456,
          extracted_at: '2026-09-13T20:00:00.000Z',
        },
        {
          screenshot_id: 'scene-001-variant-01',
          role: 'VARIANT',
          status: 'COMPLETED',
          retention_status: 'ACTIVE',
          extraction_timestamp_seconds: 23.5,
          timestamp_offset_seconds: 0.5,
          filename: 'scene-001-variant-01.png',
          relative_path: '06-screenshots/scene-001-variant-01.png',
          api_url: `/api/v1/video-analysis/jobs/${jobId}/screenshots/scene-001-variant-01`,
          mime_type: 'image/png',
          width: 1920,
          height: 1080,
          file_size_bytes: 120000,
          extracted_at: '2026-09-13T20:00:01.000Z',
        },
      ],
      fine_search_frames: [
        {
          frame_id: 'scene-001-frame-04',
          requested_timestamp_seconds: 22.5,
          actual_timestamp_seconds: 22.5,
          extraction_status: 'EXTRACTED',
          evaluation: 'REJECTED',
          reason: 'transition',
        },
        {
          frame_id: 'scene-001-frame-05',
          requested_timestamp_seconds: 23,
          actual_timestamp_seconds: 23,
          extraction_status: 'EXTRACTED',
          evaluation: 'ACCEPTED',
        },
        {
          frame_id: 'scene-001-frame-06',
          requested_timestamp_seconds: 23.5,
          actual_timestamp_seconds: 23.5,
          extraction_status: 'EXTRACTED',
          evaluation: 'REDUNDANT',
          reason: 'duplicate_of_scene-001-frame-05',
        },
      ],
    }],
    warnings: [],
    errors: [],
    created_at: new Date().toISOString(),
  };
}

test('Fixture bildet den vollständigen Screenshot-Jobvertrag ab', () => {
  const job = createJob(fixtureJobId);

  assert.equal(job.phase, 'FINALIZING');
  assert.deepEqual(job.progress, {
    segments_completed: 2,
    segments_total: 2,
    candidates_completed: 1,
    candidates_total: 1,
    screenshots_completed: 2,
    screenshots_failed: 0,
    fine_search_frames_examined: 3,
  });
  assert.deepEqual(job.external_storage, { status: 'NOT_CONFIGURED' });

  assert.equal(job.screenshot_candidates.length, 1);
  const [candidate] = job.screenshot_candidates;
  assert.deepEqual(candidate.screenshots, [
    {
      screenshot_id: 'scene-001-primary',
      role: 'PRIMARY',
      status: 'COMPLETED',
      retention_status: 'ACTIVE',
      extraction_timestamp_seconds: 23,
      timestamp_offset_seconds: 0,
      filename: 'scene-001-primary.png',
      relative_path: '06-screenshots/scene-001-primary.png',
      api_url: `/api/v1/video-analysis/jobs/${fixtureJobId}/screenshots/scene-001-primary`,
      mime_type: 'image/png',
      width: 1920,
      height: 1080,
      file_size_bytes: 123456,
      extracted_at: '2026-09-13T20:00:00.000Z',
    },
    {
      screenshot_id: 'scene-001-variant-01',
      role: 'VARIANT',
      status: 'COMPLETED',
      retention_status: 'ACTIVE',
      extraction_timestamp_seconds: 23.5,
      timestamp_offset_seconds: 0.5,
      filename: 'scene-001-variant-01.png',
      relative_path: '06-screenshots/scene-001-variant-01.png',
      api_url: `/api/v1/video-analysis/jobs/${fixtureJobId}/screenshots/scene-001-variant-01`,
      mime_type: 'image/png',
      width: 1920,
      height: 1080,
      file_size_bytes: 120000,
      extracted_at: '2026-09-13T20:00:01.000Z',
    },
  ]);
  assert.deepEqual(candidate.fine_search_frames, [
    {
      frame_id: 'scene-001-frame-04',
      requested_timestamp_seconds: 22.5,
      actual_timestamp_seconds: 22.5,
      extraction_status: 'EXTRACTED',
      evaluation: 'REJECTED',
      reason: 'transition',
    },
    {
      frame_id: 'scene-001-frame-05',
      requested_timestamp_seconds: 23,
      actual_timestamp_seconds: 23,
      extraction_status: 'EXTRACTED',
      evaluation: 'ACCEPTED',
    },
    {
      frame_id: 'scene-001-frame-06',
      requested_timestamp_seconds: 23.5,
      actual_timestamp_seconds: 23.5,
      extraction_status: 'EXTRACTED',
      evaluation: 'REDUNDANT',
      reason: 'duplicate_of_scene-001-frame-05',
    },
  ]);
});

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out while waiting for test state');
}

test('JobManager exposes cancellation for active jobs', () => {
  const manager = new JobManager({ dataDir: createTempDataDir(), processor: async () => {} });

  assert.equal(typeof manager.cancelJob, 'function');
  assert.equal(typeof manager.clearHistory, 'function');
  assert.equal(typeof manager.clearAllLogs, 'function');
});

test('initialisiert Screenshot-Konfiguration mit den erwarteten Defaults', () => {
  const manager = new JobManager({ dataDir: createTempDataDir(), processor: async () => {} });
  const config = manager.getConfig();

  assert.equal(config.fine_search_window_seconds, 2);
  assert.equal(config.fine_search_interval_seconds, 0.5);
  assert.equal(config.max_screenshots_per_candidate, 4);
  assert.equal(config.fine_search_fallback, 'exact_timestamp');
  assert.equal(config.automatic_cleanup_enabled, true);
});

test('bewahrt den Konfigurationssnapshot eines Jobs nach updateConfig', async () => {
  const dataDir = createTempDataDir();
  let observedJob;
  let releaseProcessor;
  let processorFinished;
  const hold = new Promise(resolve => { releaseProcessor = resolve; });
  const finished = new Promise(resolve => { processorFinished = resolve; });
  const manager = new JobManager({
    dataDir,
    processor: async (job, jobManager) => {
      observedJob = job;
      await hold;
      job.status = 'COMPLETED';
      job.completed_at = new Date().toISOString();
      jobManager.saveJob(job);
      processorFinished();
    },
  });

  const created = manager.createJob('https://www.youtube.com/watch?v=snapshot');
  await waitFor(() => observedJob !== undefined);
  const snapshot = { ...created.config_snapshot };

  manager.updateConfig({
    fine_search_window_seconds: 8,
    fine_search_interval_seconds: 1,
    max_screenshots_per_candidate: 2,
    fine_search_fallback: 'skip',
    automatic_cleanup_enabled: false,
  });

  assert.deepEqual(observedJob.config_snapshot, snapshot);
  assert.notDeepEqual(manager.getConfig(), snapshot);

  releaseProcessor();
  await processorFinished;
  assert.deepEqual(JSON.parse(fs.readFileSync(manager.getManifestPath(created.job_id), 'utf8')).config_snapshot, snapshot);
});

test('persistiert im Job-Snapshot keine internen oder externen Pfade', () => {
  const dataDir = createTempDataDir();
  const manager = new JobManager({
    dataDir,
    processor: async (job, jobManager) => {
      job.status = 'COMPLETED';
      job.completed_at = new Date().toISOString();
      jobManager.saveJob(job);
    },
  });
  manager.updateConfig({ external_output_dir: '/mnt/external-output/results' });

  const job = manager.createJob('https://www.youtube.com/watch?v=safe-snapshot');
  const persisted = JSON.parse(fs.readFileSync(manager.getManifestPath(job.job_id), 'utf8'));

  assert.equal('data_dir' in job.config_snapshot, false);
  assert.equal('external_output_dir' in job.config_snapshot, false);
  assert.equal('data_dir' in persisted.config_snapshot, false);
  assert.equal('external_output_dir' in persisted.config_snapshot, false);
  assert.equal(JSON.stringify(persisted).includes(dataDir), false);
  assert.equal(JSON.stringify(persisted).includes('/mnt/external-output'), false);
});

test('normalisiert einen abgeschlossenen Legacy-Job deterministisch und persistiert die Migration', () => {
  const dataDir = createTempDataDir();
  const manager = new JobManager({ dataDir, processor: async () => {} });
  manager.updateConfig({ model: 'gemini-9.9-preview', extract_transcript: false });

  const legacyJob = {
    schema_version: '1.0',
    job_id: fixtureJobId,
    correlation_id: fixtureJobId,
    status: 'COMPLETED',
    source: { type: 'youtube', url: 'https://www.youtube.com/watch?v=legacy' },
    video: { title: 'Legacy' },
    analysis: {
      model: 'gemini-3.8-flash',
      processing_mode: 'static_segments',
      segment_duration_seconds: 60,
      segments_total: 3,
      segments_successful: 2,
      segments_failed: 1,
    },
    inventory: [],
    screenshot_candidates: [],
    warnings: [],
    errors: [],
    created_at: '2026-09-13T12:00:00.000Z',
  };
  fs.writeFileSync(path.join(dataDir, `${fixtureJobId}.json`), JSON.stringify(legacyJob), 'utf8');

  const normalized = manager.getJob(fixtureJobId);
  const persisted = JSON.parse(fs.readFileSync(manager.getManifestPath(fixtureJobId), 'utf8'));

  assert.equal(normalized.phase, 'FINALIZING');
  assert.deepEqual(normalized.progress, {
    segments_completed: 3,
    segments_total: 3,
    candidates_completed: 0,
    candidates_total: 0,
    screenshots_completed: 0,
    screenshots_failed: 0,
    fine_search_frames_examined: 0,
  });
  assert.deepEqual(normalized.external_storage, { status: 'NOT_CONFIGURED' });
  assert.deepEqual(normalized.config_snapshot, {
    model: 'gemini-3.8-flash',
    segment_length_seconds: 60,
    extract_transcript: true,
    fine_search_window_seconds: 2,
    fine_search_interval_seconds: 0.5,
    max_screenshots_per_candidate: 4,
    fine_search_fallback: 'exact_timestamp',
    automatic_cleanup_enabled: true,
  });
  assert.equal(normalized.schema_version, '2.0');
  assert.deepEqual(persisted, normalized);
});

test('initialisiert den Analysefortschritt eines neuen Jobs mit Nullwerten', () => {
  const manager = new JobManager({ dataDir: createTempDataDir(), processor: async () => {} });
  const job = manager.createJob('https://www.youtube.com/watch?v=progress');

  assert.equal(job.progress.segments_completed, 0);
  assert.equal(job.progress.segments_total, 0);
});

test('akzeptiert nur absolute Pfade innerhalb des Container-Mounts', () => {
  const manager = new JobManager({ dataDir: createTempDataDir(), processor: async () => {} });
  const accepted = manager.updateConfig({ external_output_dir: '/mnt/external-output/screenshots' });

  assert.equal(accepted.external_output_dir, '/mnt/external-output/screenshots');
  for (const rejected of [
    'relative/output',
    '/mnt/external-output/../secrets',
    '/var/lib/host-output',
    'C:\\Users\\Alice\\output',
    '\\\\server\\share\\output',
    '/mnt/external-output/with\u0007bell',
  ]) {
    assert.throws(
      () => manager.updateConfig({ external_output_dir: rejected }),
      InvalidConfigError,
      rejected,
    );
  }
});

test('signalisiert ungültige Konfiguration typisiert statt sie still zu verwerfen', () => {
  const manager = new JobManager({ dataDir: createTempDataDir(), processor: async () => {} });

  assert.throws(
    () => manager.updateConfig({ external_output_dir: '/var/lib/host-output' }),
    (error) => error instanceof InvalidConfigError
      && error.field === 'external_output_dir'
      && error.code === 'INVALID_CONFIGURATION',
  );
});

test('verweigert ungültige Job-IDs vor jedem Dateizugriff', () => {
  const dataDir = createTempDataDir();
  const manager = new JobManager({ dataDir, processor: async () => {} });
  const outsidePath = path.join(dataDir, '..', 'video-analysis-job-escape.json');
  fs.writeFileSync(outsidePath, JSON.stringify(createJob(randomUUID())), 'utf8');

  for (const invalidJobId of ['../video-analysis-job-escape', '..\\video-analysis-job-escape', 'nested/job', 'C:\\temp\\job']) {
    assert.equal(manager.getJob(invalidJobId), null, invalidJobId);
    assert.throws(() => manager.saveJob(createJob(invalidJobId)), invalidJobId);
  }

  assert.equal(fs.readFileSync(outsidePath, 'utf8').length > 0, true);
});

test('normalisiert Legacy-Fortschritt und optionale Pfade defensiv', () => {
  const dataDir = createTempDataDir();
  const jobId = randomUUID();
  const manager = new JobManager({ dataDir, processor: async () => {} });
  const legacyJob = {
    schema_version: '1.0',
    job_id: jobId,
    correlation_id: jobId,
    status: 'UNKNOWN',
    phase: 'UNKNOWN',
    progress: {
      segments_completed: '3',
      segments_total: 2.5,
      candidates_completed: -1,
      candidates_total: 1.5,
      screenshots_completed: 2.5,
      screenshots_failed: null,
      fine_search_frames_examined: '7',
    },
    external_storage: {
      status: 'UNKNOWN',
      relative_path: '../outside',
    },
    output_directory: 'C:\\host-output',
    analysis: {
      model: 'gemini-3.8-flash',
      processing_mode: 'static_segments',
      segment_duration_seconds: 60,
      segments_total: 4.5,
      segments_successful: 2,
      segments_failed: -1,
    },
    inventory: [],
    screenshot_candidates: [],
    warnings: [],
    errors: [],
    created_at: '2026-09-13T12:00:00.000Z',
  };
  fs.writeFileSync(path.join(dataDir, `${jobId}.json`), JSON.stringify(legacyJob), 'utf8');

  const normalized = manager.getJob(jobId);

  assert.equal(normalized.status, 'FAILED');
  assert.equal(normalized.phase, 'FINALIZING');
  assert.deepEqual(normalized.progress, {
    segments_completed: 2,
    segments_total: 0,
    candidates_completed: 0,
    candidates_total: 0,
    screenshots_completed: 0,
    screenshots_failed: 0,
    fine_search_frames_examined: 0,
  });
  assert.equal(normalized.analysis.segments_total, 0);
  assert.equal(normalized.analysis.segments_successful, 2);
  assert.equal(normalized.analysis.segments_failed, 0);
  assert.deepEqual(normalized.external_storage, { status: 'NOT_CONFIGURED' });
  assert.equal('output_directory' in normalized, false);
});

test('verwendet bei der tatsächlichen Verarbeitung den Snapshot vor updateConfig', async () => {
  const dataDir = createTempDataDir();
  let releaseVideoInfo;
  let videoInfoStarted;
  let transcriptCalls = 0;
  const videoInfoReady = new Promise(resolve => { videoInfoStarted = resolve; });
  const releaseVideoInfoPromise = new Promise(resolve => { releaseVideoInfo = resolve; });
  const originalGetVideoInfo = youtubeService.getVideoInfo;
  const originalAnalyzeSegment = geminiService.analyzeSegment;
  const originalConsolidateInventory = geminiService.consolidateInventory;
  const originalExtractTranscript = geminiService.extractTranscript;

  youtubeService.getVideoInfo = async () => {
    videoInfoStarted();
    await releaseVideoInfoPromise;
    return {
      title: 'Lokales Testvideo',
      duration: 1,
      id: 'snapshot-test',
      canonical_url: 'https://www.youtube.com/watch?v=snapshot-test',
    };
  };
  geminiService.analyzeSegment = async () => [];
  geminiService.consolidateInventory = async () => [];
  geminiService.extractTranscript = async () => {
    transcriptCalls += 1;
    return { full_text: 'Lokales Transkript', segments: [] };
  };

  try {
    const manager = new JobManager({ dataDir });
    const created = manager.createJob('https://www.youtube.com/watch?v=snapshot-test');
    await videoInfoReady;

    manager.updateConfig({ extract_transcript: false });
    releaseVideoInfo();
    await waitFor(() => manager.getJob(created.job_id)?.status === 'COMPLETED');

    assert.equal(created.config_snapshot.extract_transcript, true);
    assert.equal(transcriptCalls, 1);
  } finally {
    youtubeService.getVideoInfo = originalGetVideoInfo;
    geminiService.analyzeSegment = originalAnalyzeSegment;
    geminiService.consolidateInventory = originalConsolidateInventory;
    geminiService.extractTranscript = originalExtractTranscript;
  }
});

test('cancelling an active job preserves partial progress and status', async () => {
  const dataDir = createTempDataDir();
  let signalStarted;
  let releaseProcessor;
  let processorFinished;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const hold = new Promise(resolve => { releaseProcessor = resolve; });
  const finished = new Promise(resolve => { processorFinished = resolve; });
  const manager = new JobManager({
    dataDir,
    processor: async (job, jobManager) => {
      job.analysis.segments_successful = 1;
      job.inventory.push({ visual_description: 'Teilfortschritt' });
      jobManager.saveJob(job);
      signalStarted();
      try {
        await hold;
        jobManager.throwIfCancellationRequested(job.job_id);
      } finally {
        processorFinished();
      }
    },
  });

  const created = manager.createJob('https://www.youtube.com/watch?v=test');
  await started;

  const cancelled = manager.cancelJob(created.job_id);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.analysis.segments_successful, 1);
  assert.equal(cancelled.inventory.length, 1);

  releaseProcessor();
  await finished;
  assert.equal(manager.getJob(created.job_id)?.status, 'CANCELLED');
  assert.equal(JSON.parse(fs.readFileSync(manager.getManifestPath(created.job_id), 'utf8')).status, 'CANCELLED');
});

test('cancelling an active job aborts its in-flight request signal', async () => {
  const dataDir = createTempDataDir();
  let signalStarted;
  let releaseProcessor;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const hold = new Promise(resolve => { releaseProcessor = resolve; });
  const manager = new JobManager({
    dataDir,
    processor: async (job, jobManager) => {
      signalStarted(jobManager.getAbortSignal(job.job_id));
      await hold;
    },
  });

  const created = manager.createJob('https://www.youtube.com/watch?v=test');
  const abortSignal = await started;
  assert.equal(abortSignal.aborted, false);

  manager.cancelJob(created.job_id);
  assert.equal(abortSignal.aborted, true);

  releaseProcessor();
});

test('ein verspätet beendeter Processor überschreibt CANCELLED nicht und erzeugt kein JOB_COMPLETED', async () => {
  const dataDir = createTempDataDir();
  let releaseProcessor;
  let markProcessorStarted;
  let markProcessorFinished;
  const processorStarted = new Promise(resolve => {
    markProcessorStarted = resolve;
  });
  const processorHold = new Promise(resolve => {
    releaseProcessor = resolve;
  });
  const processorFinished = new Promise(resolve => {
    markProcessorFinished = resolve;
  });
  const manager = new JobManager({
    dataDir,
    processor: async (job, jobManager) => {
      markProcessorStarted();
      await processorHold;
      try {
        job.status = 'COMPLETED';
        job.completed_at = new Date().toISOString();
        jobManager.saveJob(job);
      } finally {
        markProcessorFinished();
      }
    },
  });

  const created = manager.createJob('https://www.youtube.com/watch?v=cancel-race');
  await processorStarted;

  manager.cancelJob(created.job_id);
  releaseProcessor();
  await processorFinished;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(manager.getJob(created.job_id)?.status, 'CANCELLED');
  assert.equal(manager.getJobEvents(created.job_id).events.some(event => event.type === 'JOB_COMPLETED'), false);
  assert.equal(JSON.parse(fs.readFileSync(manager.getManifestPath(created.job_id), 'utf8')).status, 'CANCELLED');
});

test('completed jobs cannot be cancelled', () => {
  const dataDir = createTempDataDir();
  const manager = new JobManager({ dataDir, processor: async () => {} });
  const job = createJob('00000000-0000-4000-8000-000000000003');
  manager.saveJob(job);

  assert.throws(() => manager.cancelJob(job.job_id), /Job is not active/);
});

test('clearHistory removes persisted jobs and prevents an active processor from recreating them', async () => {
  const dataDir = createTempDataDir();
  let signalStarted;
  let releaseProcessor;
  let processorFinished;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const hold = new Promise(resolve => { releaseProcessor = resolve; });
  const finished = new Promise(resolve => { processorFinished = resolve; });
  const manager = new JobManager({
    dataDir,
    processor: async (job, jobManager) => {
      jobManager.saveJob(job);
      signalStarted();
      try {
        await hold;
        jobManager.throwIfCancellationRequested(job.job_id);
      } finally {
        processorFinished();
      }
    },
  });
  const active = manager.createJob('https://www.youtube.com/watch?v=active');
  await started;
  manager.saveJob(createJob(randomUUID()));
  manager.cancelJob(active.job_id);

  const deletedCount = manager.clearHistory();
  assert.equal(deletedCount, 2);
  assert.equal(fs.readdirSync(dataDir).filter(file => file.endsWith('.json')).length, 0);

  releaseProcessor();
  await finished;
  await waitFor(() => fs.readdirSync(dataDir).filter(file => file.endsWith('.json')).length === 0);
  assert.equal(manager.getJob(active.job_id), null);
});

test('JobManager writes lifecycle events and preserves the global event log with history', async () => {
  const dataDir = createTempDataDir();
  const manager = new JobManager({
    dataDir,
    processor: async (job, jobManager) => {
      job.status = 'COMPLETED';
      job.completed_at = new Date().toISOString();
      jobManager.saveJob(job);
    },
  });

  const job = manager.createJob('https://www.youtube.com/watch?v=events');
  await waitFor(() => manager.getJobEvents(job.job_id).events.some(event => event.type === 'JOB_COMPLETED'));

  const events = manager.getJobEvents(job.job_id).events;
  assert.deepEqual(events.map(event => event.type), ['JOB_CREATED', 'JOB_STARTED', 'JOB_COMPLETED']);
  assert.equal(fs.existsSync(path.join(dataDir, 'events.jsonl')), true);

  manager.clearHistory();
  assert.equal(fs.existsSync(path.join(dataDir, 'events.jsonl')), true);
  assert.equal(manager.getJobEvents(job.job_id).events.some(event => event.type === 'JOB_COMPLETED'), true);
});

test('clearAllLogs removes only JSONL logs and keeps job results available', async () => {
  const dataDir = createTempDataDir();
  const manager = new JobManager({
    dataDir,
    processor: async (job, jobManager) => {
      job.status = 'COMPLETED';
      job.completed_at = new Date().toISOString();
      jobManager.saveJob(job);
    },
  });

  const job = manager.createJob('https://www.youtube.com/watch?v=log-cleanup');
  await waitFor(() => manager.getJobEvents(job.job_id).events.some(event => event.type === 'JOB_COMPLETED'));

  const deletedCount = manager.clearAllLogs();

  assert.equal(deletedCount, 1);
  assert.equal(fs.existsSync(path.join(dataDir, 'events.jsonl')), false);
  assert.equal(fs.existsSync(manager.getManifestPath(job.job_id)), true);
  assert.equal(manager.getJob(job.job_id)?.status, 'COMPLETED');
  assert.deepEqual(manager.getAllJobEvents(), {
    events: [],
    usage: { prompt_tokens: 0, candidate_tokens: 0, total_tokens: 0, reported_requests: 0 },
    cost: { input_usd: 0, output_usd: 0, estimated_usd: 0, priced_requests: 0, currency: 'USD' },
  });
});

test('führt die aktivierte Screenshot-Bereinigung beim Start aus', () => {
  const dataDir = createTempDataDir();
  const screenshotDir = path.join(dataDir, 'output', 'retention-job', '06-screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const oldPng = path.join(screenshotDir, 'old.png');
  fs.writeFileSync(oldPng, 'png');
  const old = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
  fs.utimesSync(oldPng, old, old);
  new JobManager({ dataDir, processor: async () => {} });
  assert.equal(fs.existsSync(oldPng), false);
});

test('schreibt die menschen- und maschinenlesbaren Standardartefakte eines Jobs', () => {
  const dataDir = createTempDataDir();
  const manager = new JobManager({ dataDir, processor: async () => {} });
  const job = createJob(fixtureJobId);
  manager.saveJob(job);
  const outputDir = path.dirname(manager.getManifestPath(fixtureJobId));
  assert.equal(fs.readFileSync(path.join(outputDir, '00-source', 'source.txt'), 'utf8').includes(job.source.url), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, '01-metadata', 'info.json'), 'utf8')).title, 'Testvideo');
  assert.equal(fs.readFileSync(path.join(outputDir, '05-scenes', 'scenes.csv'), 'utf8').includes('scene-001'), true);
});

test('listet Jobs aus den kanonischen Output-Manifesten', () => {
  const dataDir = createTempDataDir();
  const manager = new JobManager({ dataDir, processor: async () => {} });
  manager.saveJob(createJob(fixtureJobId));
  assert.deepEqual(manager.listPersistedJobs().map(job => job.job_id), [fixtureJobId]);
});

test('bindet den externen Output-Pfad an den Jobstart und nicht an spätere Konfigurationsänderungen', () => {
  const dataDir = createTempDataDir();
  const manager = new JobManager({ dataDir, processor: async () => {} });
  manager.updateConfig({ external_output_dir: '/mnt/external-output/first' });
  const job = manager.createJob('https://www.youtube.com/watch?v=external-snapshot');
  manager.updateConfig({ external_output_dir: '/mnt/external-output/second' });
  assert.equal(manager.getExternalOutputDir(job.job_id), '/mnt/external-output/first');
});

test('shutdown sperrt neue Jobs, bricht aktive Verarbeitung ab und wartet auf den Processor', async () => {
  const dataDir = createTempDataDir();
  let processorStarted;
  let releaseProcessor;
  const started = new Promise(resolve => { processorStarted = resolve; });
  const hold = new Promise(resolve => { releaseProcessor = resolve; });
  const manager = new JobManager({
    dataDir,
    processor: async (job, jobManager) => {
      processorStarted();
      await hold;
      jobManager.throwIfCancellationRequested(job.job_id);
    },
  });

  const job = manager.createJob('https://www.youtube.com/watch?v=shutdown');
  await started;
  const shutdownPromise = manager.shutdown({ timeoutMs: 500 });

  assert.equal(manager.isShuttingDown(), true);
  assert.throws(() => manager.createJob('https://www.youtube.com/watch?v=blocked'), /shutting down/i);
  releaseProcessor();
  await shutdownPromise;

  assert.equal(manager.getJob(job.job_id)?.status, 'CANCELLED');
});

test('shutdown ist idempotent und beendet nicht aktive Jobs erneut', async () => {
  const manager = new JobManager({ dataDir: createTempDataDir(), processor: async () => {} });

  const first = manager.shutdown({ timeoutMs: 10 });
  const second = manager.shutdown({ timeoutMs: 10 });

  assert.strictEqual(first, second);
  await first;
});
