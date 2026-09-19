import test from 'node:test';
import assert from 'node:assert/strict';
import { ProcessRegistry } from '../src/backend/services/processRegistry.ts';

class FakeProcess {
  constructor() {
    this.signals = [];
    this.listeners = new Map();
  }

  on(event, listener) {
    this.listeners.set(event, listener);
    return this;
  }

  kill(signal) {
    this.signals.push(signal);
    if (signal === 'SIGTERM') this.listeners.get('close')?.();
    return true;
  }
}

test('ProcessRegistry registriert, entfernt und beendet ausschließlich bekannte Prozesse', async () => {
  const registry = new ProcessRegistry();
  const child = new FakeProcess();
  const unregister = registry.register(child);

  assert.equal(registry.size, 1);
  unregister();
  assert.equal(registry.size, 0);

  registry.register(child);
  await registry.terminateAll({ graceMs: 10, forceMs: 10 });

  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.equal(registry.size, 0);
});
test('ProcessRegistry erzwingt nach dem Grace-Timeout das Ende eines hängenden Prozesses', async () => {
  const registry = new ProcessRegistry();
  const child = new FakeProcess();
  child.kill = function kill(signal) {
    this.signals.push(signal);
    return true;
  };
  registry.register(child);

  await registry.terminateAll({ graceMs: 1, forceMs: 1 });

  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(registry.size, 0);
});
