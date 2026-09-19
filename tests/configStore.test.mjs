import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigStore } from '../src/backend/services/configStore.ts';

function tempConfigPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-config-'));
  return path.join(directory, '.video-analysis-config.json');
}

const config = {
  model: 'gemini-3.8-flash',
  segment_length_seconds: 45,
  extract_transcript: false,
  fine_search_window_seconds: 4,
  fine_search_interval_seconds: 1,
  max_screenshots_per_candidate: 2,
  fine_search_fallback: 'skip',
  automatic_cleanup_enabled: false,
};

test('persistiert und lädt die normale App-Konfiguration', () => {
  const filePath = tempConfigPath();
  const store = new ConfigStore({ filePath });

  store.save({ ...config });

  assert.deepEqual(store.load(), config);
});

test('persistiert keine Laufzeit- oder Secret-Felder', () => {
  const filePath = tempConfigPath();
  const store = new ConfigStore({ filePath });

  store.save({ ...config, data_dir: '/data/jobs', gemini_api_key_configured: true, api_key: 'secret' });

  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(persisted, config);
});

test('ignoriert unbekannte Felder und beschädigte Dateien sicher', () => {
  const filePath = tempConfigPath();
  fs.writeFileSync(filePath, JSON.stringify({ ...config, external_output_dir: '/mnt/external-output', unknown: true }), 'utf8');

  const store = new ConfigStore({ filePath });
  assert.deepEqual(store.load(), config);

  fs.writeFileSync(filePath, '{not-json', 'utf8');
  assert.equal(store.load(), null);
});
