import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJobController } from '../src/backend/controllers/jobController.ts';
import { JobManager } from '../src/backend/services/jobManager.ts';
import { SecretStore } from '../src/backend/services/secretStore.ts';

function createTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-controller-test-'));
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createRequest(body = {}, params = {}) {
  return { body, params };
}

function createManager() {
  return new JobManager({ dataDir: createTempDataDir(), processor: async () => {} });
}

function createSecretManager() {
  const dataDir = createTempDataDir();
  const secretStore = new SecretStore({ filePath: path.join(dataDir, 'secrets.json') });
  return { manager: new JobManager({ dataDir, processor: async () => {}, secretStore }), secretStore };
}

test('GET /config liefert nur den API-Key-Status und niemals den Schlüssel', () => {
  const { manager, secretStore } = createSecretManager();
  manager.setGeminiApiKey('test-controller-secret');
  const controller = createJobController(manager);
  const response = createResponseRecorder();

  controller.getConfig(createRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.gemini_api_key_configured, true);
  assert.equal(JSON.stringify(response.body).includes('test-controller-secret'), false);
});

test('API-Key kann über getrennte Controller-Aktionen gespeichert und entfernt werden', () => {
  const { manager, secretStore } = createSecretManager();
  const controller = createJobController(manager);
  const saveResponse = createResponseRecorder();

  controller.updateGeminiApiKey(createRequest({ api_key: 'test-controller-secret' }), saveResponse);
  assert.equal(saveResponse.statusCode, 200);
  assert.deepEqual(saveResponse.body, { gemini_api_key_configured: true });
  assert.equal(secretStore.getGeminiApiKey(), 'test-controller-secret');

  const deleteResponse = createResponseRecorder();
  controller.deleteGeminiApiKey(createRequest(), deleteResponse);
  assert.equal(deleteResponse.statusCode, 200);
  assert.deepEqual(deleteResponse.body, { gemini_api_key_configured: false });
  assert.equal(secretStore.hasGeminiApiKey(), false);
});

test('API-Key-Endpunkt lehnt leere Werte ab und gibt keinen Secret-Inhalt zurück', () => {
  const controller = createJobController(createSecretManager().manager);
  const response = createResponseRecorder();

  controller.updateGeminiApiKey(createRequest({ api_key: '  ' }), response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, 'INVALID_API_KEY');
  assert.equal(JSON.stringify(response.body).includes('test-secret'), false);
});

test('POST /jobs verweigert neue Analysen ohne API-Key verständlich', () => {
  const controller = createJobController(createSecretManager().manager);
  const response = createResponseRecorder();

  controller.createJob(createRequest({ source_url: 'https://www.youtube.com/watch?v=missing-key' }), response);

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body.error, {
    code: 'GEMINI_API_KEY_REQUIRED',
    message: 'Für die Videoanalyse wird ein Gemini API Key benötigt. Bitte hinterlege ihn unter Einstellungen.',
  });
});

test('PUT /config akzeptiert die Screenshot-Konfiguration ohne externen Output', () => {
  const manager = createManager();
  const controller = createJobController(manager);
  const response = createResponseRecorder();

  controller.updateConfig(createRequest({
    fine_search_window_seconds: 8,
    fine_search_interval_seconds: 1,
    max_screenshots_per_candidate: 2,
    fine_search_fallback: 'skip',
    automatic_cleanup_enabled: false,
  }), response);

  assert.equal(response.statusCode, 200);
  assert.equal('external_output_dir' in response.body, false);
  assert.equal(response.body.fine_search_window_seconds, 8);
  assert.equal(response.body.fine_search_interval_seconds, 1);
  assert.equal(response.body.max_screenshots_per_candidate, 2);
  assert.equal(response.body.fine_search_fallback, 'skip');
  assert.equal(response.body.automatic_cleanup_enabled, false);
});

test('PUT /config akzeptiert eine Segmentlänge von 15 Sekunden unverändert', () => {
  const manager = createManager();
  const controller = createJobController(manager);
  const response = createResponseRecorder();

  controller.updateConfig(createRequest({ segment_length_seconds: 15 }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.segment_length_seconds, 15);
});

test('PUT /config lehnt den entfernten externen Output mit strukturiertem HTTP 400 ab', () => {
  const manager = createManager();
  const controller = createJobController(manager);
  const response = createResponseRecorder();

  controller.updateConfig(createRequest({ external_output_dir: '/mnt/external-output' }), response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body.error, {
    code: 'INVALID_CONFIGURATION',
    field: 'external_output_dir',
    message: 'external_output_dir is not configurable',
  });
});

test('PUT /config antwortet bei ungültigem Screenshot-Wert mit HTTP 400', () => {
  const manager = createManager();
  const controller = createJobController(manager);
  const response = createResponseRecorder();

  controller.updateConfig(createRequest({ max_screenshots_per_candidate: 0 }), response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, 'INVALID_CONFIGURATION');
  assert.equal(response.body.error.field, 'max_screenshots_per_candidate');
});

test('PUT /config validiert alle bekannten Werte strikt ohne Coercion oder stilles Ignorieren', () => {
  const invalidConfigs = [
    ['model', 'not-a-gemini-model'],
    ['model', 42],
    ['segment_length_seconds', '60'],
    ['extract_transcript', 'false'],
    ['external_output_dir', '/mnt/external-output'],
    ['fine_search_window_seconds', '2'],
    ['fine_search_interval_seconds', false],
    ['max_screenshots_per_candidate', '2'],
    ['fine_search_fallback', 'nearest'],
    ['automatic_cleanup_enabled', 0],
  ];

  for (const [field, value] of invalidConfigs) {
    const controller = createJobController(createManager());
    const response = createResponseRecorder();

    controller.updateConfig(createRequest({ [field]: value }), response);

    assert.equal(response.statusCode, 400, field);
    assert.equal(response.body.error.code, 'INVALID_CONFIGURATION', field);
    assert.equal(response.body.error.field, field, field);
  }
});

test('PUT /config lehnt null, Arrays und primitive JSON-Bodies ab, akzeptiert aber ein leeres Objekt', () => {
  const controller = createJobController(createManager());
  const emptyObjectResponse = createResponseRecorder();

  controller.updateConfig(createRequest({}), emptyObjectResponse);
  assert.equal(emptyObjectResponse.statusCode, 200);

  for (const body of [null, [], 'config', 0, false]) {
    const response = createResponseRecorder();

    controller.updateConfig(createRequest(body), response);

    assert.equal(response.statusCode, 400, `Body ${JSON.stringify(body)}`);
    assert.equal(response.body.error.code, 'INVALID_CONFIGURATION', `Body ${JSON.stringify(body)}`);
    assert.equal(response.body.error.field, 'configuration', `Body ${JSON.stringify(body)}`);
  }
});

test('GET /jobs/:job_id gibt Phase und vollständigen Fortschritt ohne externen Speicher zurück', () => {
  const manager = createManager();
  const controller = createJobController(manager);
  const job = {
    schema_version: '3.0',
    job_id: '00000000-0000-4000-8000-000000000002',
    correlation_id: '00000000-0000-4000-8000-000000000002',
    status: 'PROCESSING',
    phase: 'SCREENSHOT_EXTRACTION',
    progress: {
      segments_completed: 3,
      segments_total: 5,
      candidates_completed: 2,
      candidates_total: 4,
      screenshots_completed: 6,
      screenshots_failed: 1,
      fine_search_frames_examined: 12,
    },
    config_snapshot: {
      model: 'gemini-3.8-flash',
      segment_length_seconds: 60,
      extract_transcript: true,
      fine_search_window_seconds: 2,
      fine_search_interval_seconds: 0.5,
      max_screenshots_per_candidate: 4,
      fine_search_fallback: 'exact_timestamp',
      automatic_cleanup_enabled: true,
    },
    source: { type: 'youtube', url: 'https://www.youtube.com/watch?v=status' },
    video: {},
    analysis: {
      model: 'gemini-3.8-flash',
      processing_mode: 'static_segments',
      segment_duration_seconds: 60,
      segments_total: 5,
      segments_successful: 3,
      segments_failed: 0,
    },
    inventory: [],
    screenshot_candidates: [],
    warnings: [],
    errors: [],
    created_at: '2026-09-13T12:00:00.000Z',
  };
  manager.saveJob(job);
  const response = createResponseRecorder();

  controller.getJobStatus(createRequest({}, { job_id: job.job_id }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.job_id, job.job_id);
  assert.equal(response.body.status, 'PROCESSING');
  assert.equal(response.body.phase, 'SCREENSHOT_EXTRACTION');
  assert.deepEqual(response.body.progress, {
    ...job.progress,
    segments_successful: job.analysis.segments_successful,
    segments_failed: job.analysis.segments_failed,
  });
  assert.equal('external_storage' in response.body, false);
  assert.equal(typeof response.body.updated_at, 'string');
});
