import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JobManager } from '../src/backend/services/jobManager.ts';
import { processVideoJob } from '../src/backend/services/videoProcessor.ts';
import { youtubeService } from '../src/backend/services/youtubeService.ts';
import { geminiService } from '../src/backend/services/geminiService.ts';

function createTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-processor-test-'));
}

test('persistiert die realen Pipeline-Phasen und den Analysefortschritt', async () => {
  const dataDir = createTempDataDir();
  const jobId = randomUUID();
  const manager = new JobManager({ dataDir, processor: async () => {} });
  const job = {
    schema_version: '3.0',
    job_id: jobId,
    correlation_id: jobId,
    status: 'PROCESSING',
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
    config_snapshot: {
      model: 'gemini-3.8-flash',
      segment_length_seconds: 60,
      extract_transcript: true,
      fine_search_window_seconds: 2,
      fine_search_interval_seconds: 0.5,
      max_screenshots_per_candidate: 4,
      fine_search_fallback: 'exact_timestamp',
      automatic_cleanup_enabled: true,
    },
    source: { type: 'youtube', url: 'https://www.youtube.com/watch?v=phases' },
    video: {},
    analysis: {
      model: 'gemini-3.8-flash',
      processing_mode: 'static_segments',
      segment_duration_seconds: 60,
      segments_total: 0,
      segments_successful: 0,
      segments_failed: 0,
    },
    inventory: [],
    screenshot_candidates: [],
    warnings: [],
    errors: [],
    created_at: '2026-09-13T12:00:00.000Z',
  };
  manager.saveJob(job);
  const phases = [];
  const originalSaveJob = manager.saveJob.bind(manager);
  manager.saveJob = (candidate) => {
    phases.push(candidate.phase);
    originalSaveJob(candidate);
  };
  const originals = {
    getVideoInfo: youtubeService.getVideoInfo,
    analyzeSegment: geminiService.analyzeSegment,
    extractTranscript: geminiService.extractTranscript,
    consolidateInventory: geminiService.consolidateInventory,
  };

  youtubeService.getVideoInfo = async () => ({
    title: 'Phasentest',
    duration: 1,
    id: 'phase-test',
    canonical_url: 'https://www.youtube.com/watch?v=phase-test',
  });
  geminiService.analyzeSegment = async () => [];
  geminiService.extractTranscript = async () => ({ full_text: 'Text', segments: [] });
  geminiService.consolidateInventory = async () => [];

  try {
    await processVideoJob(job, manager);
  } finally {
    youtubeService.getVideoInfo = originals.getVideoInfo;
    geminiService.analyzeSegment = originals.analyzeSegment;
    geminiService.extractTranscript = originals.extractTranscript;
    geminiService.consolidateInventory = originals.consolidateInventory;
  }

  assert.deepEqual([...new Set(phases)], [
    'ANALYSIS',
    'TRANSCRIPT_EXTRACTION',
    'INVENTORY_CONSOLIDATION',
    'FINALIZING',
  ]);
  const persisted = JSON.parse(fs.readFileSync(manager.getManifestPath(jobId), 'utf8'));
  assert.equal(persisted.analysis.segments_total, 1);
  assert.equal(persisted.analysis.segments_successful, 1);
  assert.equal(persisted.progress.segments_total, 1);
  assert.equal(persisted.progress.segments_completed, 1);
  assert.equal(persisted.progress.screenshots_completed, 0);
  assert.equal(persisted.progress.screenshots_failed, 0);
  assert.equal(persisted.phase, 'FINALIZING');
});

test('verwendet 30 Sekunden exakt und erzeugt nur ein kürzeres Restsegment', async () => {
  const { buildSegmentRanges } = await import('../src/backend/services/videoProcessor.ts');
  const ranges = buildSegmentRanges(620, 30);

  assert.equal(ranges.length, 21);
  assert.deepEqual(ranges[0], { start: 0, end: 30 });
  assert.deepEqual(ranges[19], { start: 570, end: 600 });
  assert.deepEqual(ranges[20], { start: 600, end: 620 });
});

test('verwendet 60 Sekunden exakt ohne automatische Anhebung', async () => {
  const { buildSegmentRanges } = await import('../src/backend/services/videoProcessor.ts');
  const ranges = buildSegmentRanges(620, 60);

  assert.equal(ranges.length, 11);
  assert.deepEqual(ranges[0], { start: 0, end: 60 });
  assert.deepEqual(ranges[9], { start: 540, end: 600 });
  assert.deepEqual(ranges[10], { start: 600, end: 620 });
});
