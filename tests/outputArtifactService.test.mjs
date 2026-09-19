import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { OutputArtifactService, OutputArtifactPathError } from '../src/backend/services/outputArtifactService.ts';

function createTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-output-artifacts-test-'));
}

function createJob() {
  return {
    job_id: 'job-123',
    status: 'COMPLETED',
    video: { title: 'Demo Video' },
  };
}

function createOutputFixture(dataDir) {
  const jobDirectory = path.join(dataDir, 'output', 'job-123--demo-video');
  fs.mkdirSync(path.join(jobDirectory, '06-screenshots'), { recursive: true });
  fs.writeFileSync(path.join(jobDirectory, 'manifest.json'), '{"status":"COMPLETED"}\n');
  fs.mkdirSync(path.join(jobDirectory, '02-transcript'), { recursive: true });
  fs.writeFileSync(path.join(jobDirectory, '02-transcript', 'transcript.txt'), 'Gesprochener Text.\n');
  fs.mkdirSync(path.join(jobDirectory, '05-scenes'), { recursive: true });
  fs.writeFileSync(path.join(jobDirectory, '05-scenes', 'scenes.csv'), 'candidate_id\nscene-001\n');
  fs.writeFileSync(path.join(jobDirectory, '06-screenshots', 'scene-001.png'), Buffer.from([137, 80, 78, 71]));
  return jobDirectory;
}

test('listet alle regulären Job-Artefakte relativ und mit Vorschautypen', () => {
  const dataDir = createTempDataDir();
  createOutputFixture(dataDir);
  const service = new OutputArtifactService({ dataDir });

  const listing = service.list(createJob());

  assert.equal(listing.job_id, 'job-123');
  assert.equal(listing.output_directory, 'output/job-123--demo-video');
  assert.deepEqual(listing.artifacts.map(artifact => artifact.relative_path), [
    '02-transcript/transcript.txt',
    '05-scenes/scenes.csv',
    '06-screenshots/scene-001.png',
    'manifest.json',
  ]);
  assert.equal(listing.artifacts.find(artifact => artifact.relative_path.endsWith('.txt')).preview_kind, 'text');
  assert.equal(listing.artifacts.find(artifact => artifact.relative_path.endsWith('.csv')).mime_type, 'text/csv');
  assert.equal(listing.artifacts.find(artifact => artifact.relative_path.endsWith('.png')).preview_kind, 'image');
  assert.equal(listing.artifacts.some(artifact => path.isAbsolute(artifact.relative_path)), false);
});

test('löst nur vorhandene reguläre Dateien im Jobordner auf', () => {
  const dataDir = createTempDataDir();
  const jobDirectory = createOutputFixture(dataDir);
  const service = new OutputArtifactService({ dataDir });

  const resolved = service.resolve(createJob(), 'manifest.json');

  assert.equal(resolved.relative_path, 'manifest.json');
  assert.equal(resolved.absolute_path, path.join(jobDirectory, 'manifest.json'));
  assert.equal(fs.readFileSync(resolved.absolute_path, 'utf8'), '{"status":"COMPLETED"}\n');
  assert.throws(() => service.resolve(createJob(), '../outside.txt'), OutputArtifactPathError);
  assert.throws(() => service.resolve(createJob(), 'missing.txt'), /nicht gefunden/i);
});

test('lehnt Symlink-Komponenten auch bei einem Ziel innerhalb des Jobordners ab', () => {
  const dataDir = createTempDataDir();
  const jobDirectory = createOutputFixture(dataDir);
  const service = new OutputArtifactService({ dataDir });
  fs.symlinkSync(
    path.join(jobDirectory, '02-transcript'),
    path.join(jobDirectory, 'transcript-link'),
    'junction',
  );

  assert.throws(
    () => service.resolve(createJob(), 'transcript-link/transcript.txt'),
    OutputArtifactPathError,
  );
});
