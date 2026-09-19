import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GeminiApiKeyRequiredError, GeminiService } from '../src/backend/services/geminiService.ts';
import { SecretStore } from '../src/backend/services/secretStore.ts';

function createSecretStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-gemini-service-'));
  return new SecretStore({ filePath: path.join(directory, 'secrets.json') });
}

test('GeminiService liest für neue Requests den aktuell gespeicherten API-Key', async () => {
  const store = createSecretStore();
  store.setGeminiApiKey('test-first-key');
  const usedKeys = [];
  const service = new GeminiService({
    secretStore: store,
    clientFactory: apiKey => {
      usedKeys.push(apiKey);
      return { models: { generateContent: async () => ({ text: '{"duration_seconds": 7}' }) } };
    },
  });

  await service.getVideoMetadata('https://example.test/video');
  store.setGeminiApiKey('test-second-key');
  await service.getVideoMetadata('https://example.test/video');

  assert.deepEqual(usedKeys, ['test-first-key', 'test-second-key']);
});

test('GeminiService meldet einen fehlenden API-Key typisiert und ohne Secret-Inhalt', async () => {
  const service = new GeminiService({ secretStore: createSecretStore(), clientFactory: () => { throw new Error('factory must not run'); } });

  await assert.rejects(
    () => service.getVideoMetadata('https://example.test/video'),
    error => error instanceof GeminiApiKeyRequiredError && error.code === 'GEMINI_API_KEY_REQUIRED' && !error.message.includes('test-'),
  );
});
