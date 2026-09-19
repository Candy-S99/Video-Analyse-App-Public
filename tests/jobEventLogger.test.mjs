import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobEventLogger } from '../src/backend/services/jobEventLogger.ts';

function createTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-events-test-'));
}

test('JobEventLogger stores global JSONL events and returns totals per job', () => {
  const dataDir = createTempDataDir();
  const logger = new JobEventLogger({ dataDir });

  logger.append({
    job_id: 'job-a',
    type: 'API_COMPLETED',
    operation: 'SEGMENT_ANALYSIS',
    provider: 'gemini',
    status: 'SUCCEEDED',
    duration_ms: 420,
    usage: { prompt_tokens: 120, candidate_tokens: 25, total_tokens: 145 },
    cost_estimate: {
      currency: 'USD',
      input_usd: 0.00009,
      output_usd: 0.00009375,
      estimated_usd: 0.00018375,
      pricing_tier: 'standard',
      pricing_version: '2026-09-13',
      price_basis: 'paid_standard_per_1m_tokens',
    },
  });
  logger.append({
    job_id: 'job-a',
    type: 'API_ABORTED',
    operation: 'TRANSCRIPT_EXTRACTION',
    provider: 'gemini',
    status: 'CANCELLED',
  });
  logger.append({
    job_id: 'job-b',
    type: 'API_COMPLETED',
    operation: 'VIDEO_METADATA',
    provider: 'gemini',
    status: 'SUCCEEDED',
    usage: { prompt_tokens: 10, candidate_tokens: 4, total_tokens: 14 },
  });

  const result = logger.getForJob('job-a');

  assert.equal(result.events.length, 2);
  assert.deepEqual(result.usage, {
    prompt_tokens: 120,
    candidate_tokens: 25,
    total_tokens: 145,
    reported_requests: 1,
  });
  assert.deepEqual(result.cost, {
    input_usd: 0.00009,
    output_usd: 0.00009375,
    estimated_usd: 0.00018375,
    priced_requests: 1,
    currency: 'USD',
  });
  assert.equal(fs.readFileSync(path.join(dataDir, 'events.jsonl'), 'utf8').trim().split('\n').length, 3);
});

test('JobEventLogger returns the complete persistent log with aggregate usage', () => {
  const dataDir = createTempDataDir();
  const logger = new JobEventLogger({ dataDir });
  logger.append({ job_id: 'job-a', type: 'JOB_CREATED', status: 'SUCCEEDED' });
  logger.append({
    job_id: 'job-b',
    type: 'API_COMPLETED',
    usage: { prompt_tokens: 10, candidate_tokens: 4, total_tokens: 14 },
    cost_estimate: {
      currency: 'USD',
      input_usd: 0.0000075,
      output_usd: 0.000015,
      estimated_usd: 0.0000225,
      pricing_tier: 'standard',
      pricing_version: '2026-09-13',
      price_basis: 'paid_standard_per_1m_tokens',
    },
  });

  const result = logger.getAll();

  assert.equal(result.events.length, 2);
  assert.deepEqual(result.usage, {
    prompt_tokens: 10,
    candidate_tokens: 4,
    total_tokens: 14,
    reported_requests: 1,
  });
  assert.deepEqual(result.cost, {
    input_usd: 0.0000075,
    output_usd: 0.000015,
    estimated_usd: 0.0000225,
    priced_requests: 1,
    currency: 'USD',
  });
  assert.equal(fs.existsSync(path.join(dataDir, 'events.jsonl')), true);
});

test('JobEventLogger derives a historical estimate for legacy Gemini events without cost data', () => {
  const dataDir = createTempDataDir();
  const logger = new JobEventLogger({ dataDir });
  logger.append({
    job_id: 'legacy-job',
    type: 'API_COMPLETED',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    timestamp: '2026-09-13T12:00:00.000Z',
    usage: { prompt_tokens: 120, candidate_tokens: 25, total_tokens: 145 },
  });

  const result = logger.getForJob('legacy-job');

  assert.equal(result.events[0].cost_estimate?.estimated_usd, 0.00018375);
  assert.equal(result.cost.estimated_usd, 0.00018375);
  assert.equal(result.cost.priced_requests, 1);
});

test('liest Screenshot-Extraktionsereignisse mit unveränderter Operation', () => {
  const dataDir = createTempDataDir();
  const logger = new JobEventLogger({ dataDir });
  const expected = {
    event_id: 'screenshot-event-1',
    job_id: 'job-screenshot',
    timestamp: '2026-09-13T12:00:00.000Z',
    type: 'SCREENSHOT_PHASE_STARTED',
    operation: 'SCREENSHOT_EXTRACTION',
    provider: 'app',
    status: 'SUCCEEDED',
    details: { candidates_total: 2 },
  };

  logger.append(expected);

  assert.deepEqual(logger.getForJob('job-screenshot').events, [expected]);
});

test('ignoriert unbekannte Ereignistypen beim Schreiben und Lesen', () => {
  const dataDir = createTempDataDir();
  const logger = new JobEventLogger({ dataDir });

  assert.equal(logger.append({ job_id: 'job-unknown', type: 'UNKNOWN_EVENT' }), null);
  fs.appendFileSync(path.join(dataDir, 'events.jsonl'), `${JSON.stringify({
    event_id: 'unknown-event-1',
    job_id: 'job-unknown',
    timestamp: '2026-09-13T12:00:00.000Z',
    type: 'UNKNOWN_EVENT',
  })}\n`, 'utf8');

  assert.deepEqual(logger.getForJob('job-unknown').events, []);
  assert.equal(fs.readFileSync(path.join(dataDir, 'events.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('redigiert Secrets auch in verschachtelten Eventdetails und beim erneuten Lesen', () => {
  const dataDir = createTempDataDir();
  const secret = 'test-event-secret';
  const logger = new JobEventLogger({ dataDir, getSecrets: () => [secret] });

  logger.append({
    job_id: 'secret-job',
    type: 'API_FAILED',
    details: { provider_error: `request failed for ${secret}`, nested: [secret] },
  });

  const serialized = fs.readFileSync(path.join(dataDir, 'events.jsonl'), 'utf8');
  assert.equal(serialized.includes(secret), false);
  assert.equal(JSON.stringify(logger.getForJob('secret-job')).includes(secret), false);
});
