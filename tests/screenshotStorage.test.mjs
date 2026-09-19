import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScreenshotStorage } from '../src/backend/services/screenshotStorage.ts';

function png() { const data = Buffer.alloc(64); Buffer.from([137,80,78,71,13,10,26,10]).copy(data); data.write('IHDR', 12); data.writeUInt32BE(640, 16); data.writeUInt32BE(480, 20); return data; }
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-storage-')); }

test('speichert PNG intern vor der externen Kopie', async () => {
  const dir = temp(); const external = path.join(dir, 'external'); const storage = new ScreenshotStorage({ dataDir: dir, externalOutputDir: external });
  const result = await storage.store({ jobId: 'job-123', sceneNumber: 1, screenshotId: 'scene-001-primary', role: 'PRIMARY', timestampSeconds: 23, sourcePng: png() });
  assert.equal(result.status, 'COMPLETED'); assert.equal(result.mime_type, 'image/png'); assert.equal(fs.statSync(result.absolutePath).size, result.file_size_bytes); assert.equal(result.external_storage.status, 'COMPLETED');
});

test('behält interne PNG bei externem Schreibfehler', async () => {
  const dir = temp(); const storage = new ScreenshotStorage({ dataDir: dir, externalOutputDir: path.join(dir, 'external'), copyFile: async () => { throw new Error('external disk full'); } });
  const result = await storage.store({ jobId: 'job-123', sceneNumber: 1, screenshotId: 'scene-001-primary', role: 'PRIMARY', timestampSeconds: 23, sourcePng: png() });
  assert.equal(result.external_storage.status, 'FAILED'); assert.equal(fs.existsSync(result.absolutePath), true);
});
