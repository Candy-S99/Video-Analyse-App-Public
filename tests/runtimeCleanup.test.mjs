import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RuntimeCleanup } from '../src/backend/services/runtimeCleanup.ts';

test('RuntimeCleanup entfernt nur eigene temporäre Laufzeitdateien', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-cleanup-'));
  const tempDir = path.join(root, 'temp');
  const dataDir = path.join(root, 'jobs');
  const outputDir = path.join(dataDir, 'output', 'job-title');
  fs.mkdirSync(outputDir, { recursive: true });
  const appFrame = path.join(tempDir, '09b1222d-1707-4d66-80c5-736138fe9c12-candidate-1.png');
  const foreignFile = path.join(tempDir, 'keep-me.tmp');
  const downloaderTemp = path.join(outputDir, '.video.tmp-123.mp4');
  const manifest = path.join(outputDir, 'manifest.json');
  for (const file of [appFrame, foreignFile, downloaderTemp, manifest]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'data');
  }

  await new RuntimeCleanup({ tempDir, dataDir }).cleanup();

  assert.equal(fs.existsSync(appFrame), false);
  assert.equal(fs.existsSync(downloaderTemp), false);
  assert.equal(fs.existsSync(foreignFile), true);
  assert.equal(fs.existsSync(manifest), true);
});
