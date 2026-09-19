import test from 'node:test';
import assert from 'node:assert/strict';
import { ScreenshotEvaluator } from '../src/backend/services/screenshotEvaluator.ts';

const frames = Array.from({ length: 9 }, (_, index) => ({
  frame_id: `frame-${String(index + 1).padStart(2, '0')}`,
  timestamp_seconds: 21 + index * 0.5,
  png: Buffer.from(`real-png-${index + 1}`),
}));

test('übernimmt höchstens einen PRIMARY und drei Varianten aus echten Frame-IDs', async () => {
  const evaluator = new ScreenshotEvaluator({ generate: async () => JSON.stringify({
    primary_frame_id: 'frame-05',
    variant_frame_ids: ['frame-04', 'frame-06', 'frame-07', 'frame-08', 'frame-06', 'unknown'],
    decisions: [{ frame_id: 'frame-05', accepted: true, reason: 'stabil und lesbar' }],
    fallback_recommended: false,
  }) });
  const result = await evaluator.evaluate({ candidateId: 'scene-001', description: 'Diagramm', category: 'diagram', targetTimestampSeconds: 23, frames });
  assert.equal(result.primary.frame_id, 'frame-05');
  assert.deepEqual(result.variants.map(frame => frame.frame_id), ['frame-04', 'frame-06', 'frame-07']);
});

test('verwendet den exakten zentralen Fallback bei leerer oder ungültiger Auswahl', async () => {
  const evaluator = new ScreenshotEvaluator({ generate: async () => JSON.stringify({ primary_frame_id: null, variant_frame_ids: ['unknown'], decisions: [], fallback_recommended: true }) });
  const result = await evaluator.evaluate({ candidateId: 'scene-001', description: 'Diagramm', category: 'diagram', targetTimestampSeconds: 23, frames });
  assert.equal(result.primary, null);
  assert.equal(result.fallbackTimestampSeconds, 23);
});

test('übermittelt ausschließlich reale PNG-Daten und einen strengen Prompt', async () => {
  let received;
  const evaluator = new ScreenshotEvaluator({ generate: async request => { received = request; return JSON.stringify({ primary_frame_id: 'frame-05', variant_frame_ids: [], decisions: [], fallback_recommended: false }); } });
  await evaluator.evaluate({ candidateId: 'scene-001', description: 'Diagramm', category: 'diagram', targetTimestampSeconds: 23, frames });
  assert.equal(received.frames.length, 9);
  assert.match(received.prompt, /keine Bildgenerierung/i);
  assert.match(received.prompt, /keine Auswahl außerhalb/i);
  assert.equal(received.frames.every(frame => Buffer.isBuffer(frame.png)), true);
});
