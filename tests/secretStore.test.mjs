import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SecretStore } from '../src/backend/services/secretStore.ts';

function createStore(environment = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-secret-store-'));
  return {
    directory,
    store: new SecretStore({
      filePath: path.join(directory, 'secrets.json'),
      environment,
    }),
  };
}

test('übernimmt einen vorhandenen Umgebungs-Key genau einmal in den Store', () => {
  const { directory, store } = createStore({ GEMINI_API_KEY: 'test-migrated-key' });

  assert.equal(store.getGeminiApiKey(), 'test-migrated-key');
  assert.equal(store.hasGeminiApiKey(), true);
  assert.equal(fs.readFileSync(path.join(directory, 'secrets.json'), 'utf8').includes('test-migrated-key'), true);

  const reloaded = new SecretStore({
    filePath: path.join(directory, 'secrets.json'),
    environment: { GEMINI_API_KEY: 'test-old-environment-key' },
  });
  assert.equal(reloaded.getGeminiApiKey(), 'test-migrated-key');
});

test('speichert und ersetzt einen nichtleeren Key atomar', () => {
  const { directory, store } = createStore();

  store.setGeminiApiKey('test-first-key');
  assert.equal(store.getGeminiApiKey(), 'test-first-key');
  store.setGeminiApiKey('test-second-key');
  assert.equal(store.getGeminiApiKey(), 'test-second-key');
  assert.equal(fs.readdirSync(directory).some(name => name.includes('.tmp-')), false);
});

test('Entfernen speichert einen deaktivierten Zustand und reaktiviert keinen alten Umgebungs-Key', () => {
  const { directory, store } = createStore({ GEMINI_API_KEY: 'test-migrated-key' });

  store.deleteGeminiApiKey();
  assert.equal(store.getGeminiApiKey(), undefined);
  assert.equal(store.hasGeminiApiKey(), false);

  const reloaded = new SecretStore({
    filePath: path.join(directory, 'secrets.json'),
    environment: { GEMINI_API_KEY: 'test-old-environment-key' },
  });
  assert.equal(reloaded.getGeminiApiKey(), undefined);
});

test('leere oder nur aus Leerzeichen bestehende Werte werden abgewiesen', () => {
  const { store } = createStore();

  assert.throws(() => store.setGeminiApiKey('   '), /API key must not be empty/);
});
