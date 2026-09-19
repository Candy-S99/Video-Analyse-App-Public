import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationLifecycle } from '../src/backend/services/applicationLifecycle.ts';

test('ApplicationLifecycle fährt Jobs, Prozesse, Temp-Dateien und Server in Reihenfolge herunter', async () => {
  const events = [];
  const lifecycle = new ApplicationLifecycle({
    jobManager: {
      shutdown: async () => { events.push('jobs'); },
      getActiveJobCount: () => 1,
    },
    processRegistry: {
      terminateAll: async () => { events.push('processes'); },
    },
    cleanupTemporaryFiles: async () => { events.push('temp'); },
    server: {
      close(callback) { events.push('server'); callback(); },
    },
    exit: code => events.push(`exit:${code}`),
  });

  await lifecycle.shutdown();

  assert.deepEqual(events, ['jobs', 'processes', 'temp', 'server', 'exit:0']);
  assert.equal(lifecycle.state, 'STOPPED');
});
test('ApplicationLifecycle behandelt einen zweiten Shutdown-Aufruf idempotent', async () => {
  let calls = 0;
  const lifecycle = new ApplicationLifecycle({
    jobManager: { shutdown: async () => { calls += 1; }, getActiveJobCount: () => 0 },
    processRegistry: { terminateAll: async () => {} },
    cleanupTemporaryFiles: async () => {},
    exit: () => {},
  });

  const first = lifecycle.shutdown();
  const second = lifecycle.shutdown();
  assert.strictEqual(first, second);
  await first;
  assert.equal(calls, 1);
});
