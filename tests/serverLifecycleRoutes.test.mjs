import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'production';
process.env.VIDEO_ANALYSIS_NO_AUTOSTART = '1';
const originalDataDir = process.env.DATA_DIR;
const isolatedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-server-test-'));
process.env.DATA_DIR = isolatedDataDir;
const { createApp } = await import('../server.ts');
if (originalDataDir === undefined) delete process.env.DATA_DIR;
else process.env.DATA_DIR = originalDataDir;
process.env.NODE_ENV = 'test';

test('Shutdown-Route erfordert lokalen Origin und Session-Token und startet den Lifecycle', async () => {
  const calls = [];
  const lifecycle = {
    state: 'RUNNING',
    getActiveJobCount: () => 2,
    shutdown: async () => { calls.push('shutdown'); },
  };
  process.env.NODE_ENV = 'production';
  const app = await createApp({ shutdownToken: 'test-token', getLifecycle: () => lifecycle });
  process.env.NODE_ENV = 'test';
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const forbidden = await fetch(`http://127.0.0.1:${port}/api/v1/video-analysis/system/shutdown`, {
    method: 'POST',
    headers: { Origin: `http://127.0.0.1:${port}`, Host: `127.0.0.1:${port}`, 'X-Video-Analysis-Shutdown-Token': 'wrong' },
  });
  assert.equal(forbidden.status, 403);

  const accepted = await fetch(`http://127.0.0.1:${port}/api/v1/video-analysis/system/shutdown`, {
    method: 'POST',
    headers: { Origin: `http://127.0.0.1:${port}`, Host: `127.0.0.1:${port}`, 'X-Video-Analysis-Shutdown-Token': 'test-token' },
  });
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { state: 'SHUTTING_DOWN', active_jobs: 2 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['shutdown']);
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(isolatedDataDir, { recursive: true, force: true });
});
