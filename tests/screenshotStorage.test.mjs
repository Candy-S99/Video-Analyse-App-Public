import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScreenshotStorage } from '../src/backend/services/screenshotStorage.ts';

function png() { const data = Buffer.alloc(64); Buffer.from([137,80,78,71,13,10,26,10]).copy(data); data.write('IHDR', 12); data.writeUInt32BE(640, 16); data.writeUInt32BE(480, 20); return data; }
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-storage-')); }

test('speichert PNG ausschließlich im kanonischen Output', async () => {
  const dir = temp(); const storage = new ScreenshotStorage({ dataDir: dir });
  const result = await storage.store({ jobId: 'job-123', sceneNumber: 1, screenshotId: 'scene-001-primary', role: 'PRIMARY', timestampSeconds: 23, sourcePng: png() });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.mime_type, 'image/png');
  assert.equal(fs.statSync(result.absolutePath).size, result.file_size_bytes);
  assert.equal(result.relative_path, 'output/job-123--pending/06-screenshots/scene-001.png');
  assert.equal('external_storage' in result, false);
});
