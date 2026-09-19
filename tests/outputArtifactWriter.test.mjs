import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { OutputLayout } from '../src/backend/services/outputLayout.ts';
import { OutputArtifactWriter } from '../src/backend/services/outputArtifactWriter.ts';

function createTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-output-test-'));
}

test('legt jobbezogenen Ausgabeordner mit sicherem Titel an', () => {
  const tempDir = createTempDataDir();
  const layout = new OutputLayout({ dataDir: tempDir });

  const result = layout.forJob('job-123', 'Demo: Video / mit Fragezeichen?');

  assert.equal(result.relativeJobDirectory, 'output/job-123--demo-video-mit-fragezeichen');
  assert.equal(path.normalize(result.manifestPath).endsWith(path.normalize('output/job-123--demo-video-mit-fragezeichen/manifest.json')), true);
  assert.equal(path.normalize(result.screenshotPath('scene-001')).endsWith(path.normalize('06-screenshots/scene-001.png')), true);
});

test('erstellt alle jobbezogenen Ausgabeordner und verwendet pending ohne Titel', () => {
  const tempDir = createTempDataDir();
  const layout = new OutputLayout({ dataDir: tempDir });

  const result = layout.ensureJobDirectories('job-123');

  assert.equal(result.relativeJobDirectory, 'output/job-123--pending');
  for (const directory of ['00-source', '01-metadata', '02-transcript', '03-video', '05-scenes', '06-screenshots']) {
    assert.equal(fs.statSync(path.join(tempDir, result.relativeJobDirectory, directory)).isDirectory(), true, directory);
  }
});

test('weist ungültige Job-IDs und unsichere Artefaktpfade zurück', () => {
  const tempDir = createTempDataDir();
  const layout = new OutputLayout({ dataDir: tempDir });

  assert.throws(() => layout.forJob('../job-123', 'Video'), /job.?id/i);
  assert.throws(() => layout.forJob('job/123', 'Video'), /job.?id/i);
  assert.throws(() => layout.artifactPath('job-123', '../outside.txt'), /path|contain/i);
  assert.throws(() => layout.forJob('job-123').screenshotPath('..\\outside'), /path|contain|scene/i);
});

test('materialisiert Metadaten, Szenenliste und Manifest atomar', () => {
  const tempDir = createTempDataDir();
  const writer = new OutputArtifactWriter({
    dataDir: tempDir,
    now: () => new Date('2026-09-13T20:00:00.000Z'),
  });

  writer.writeSource('job-123', {
    rawUrl: 'https://youtu.be/abcdefghijk',
    canonicalUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  });
  writer.writeInfo('job-123', { title: 'Demo', duration_seconds: 42 });
  writer.writeDescription('job-123', 'Eine Beschreibung.');
  writer.writeTranscript('job-123', { full_text: 'Gesprochener Text.' });
  writer.writeScenes('job-123', [{
    candidate_id: 'scene-001',
    timestamp_seconds: 23,
    start_seconds: 22,
    end_seconds: 24,
    visual_description: 'Diagramm',
    category: 'diagram',
    information_score: 92,
  }]);
  writer.writeManifest('job-123', { job_id: 'job-123', status: 'PROCESSING' });

  const jobDir = path.join(tempDir, 'output', 'job-123--pending');
  assert.equal(fs.existsSync(path.join(jobDir, '00-source', 'source.txt')), true);
  assert.equal(fs.existsSync(path.join(jobDir, '01-metadata', 'info.json')), true);
  assert.equal(fs.existsSync(path.join(jobDir, '01-metadata', 'description.txt')), true);
  assert.equal(fs.existsSync(path.join(jobDir, '02-transcript', 'transcript.txt')), true);
  assert.equal(fs.existsSync(path.join(jobDir, '05-scenes', 'scenes.csv')), true);
  assert.equal(fs.existsSync(path.join(jobDir, 'manifest.json')), true);
  assert.equal(fs.readdirSync(path.join(jobDir, '05-scenes')).some(name => name.includes('.tmp-')), false);
});

test('schreibt scenes.csv mit exakter Kopfzeile und vollständigem CSV-Escaping', () => {
  const tempDir = createTempDataDir();
  const writer = new OutputArtifactWriter({ dataDir: tempDir });

  writer.writeScenes('job-123', [{
    candidate_id: 'scene,001',
    timestamp_seconds: 23,
    start_seconds: 22,
    end_seconds: 24,
    category: 'diagram',
    information_score: 92,
    visual_description: 'Zeile 1, "Zitat"\nZeile 2',
  }]);

  const csv = fs.readFileSync(path.join(tempDir, 'output', 'job-123--pending', '05-scenes', 'scenes.csv'), 'utf8');
  assert.equal(csv, 'candidate_id,timestamp_seconds,start_seconds,end_seconds,category,information_score,visual_description\n"scene,001",23,22,24,diagram,92,"Zeile 1, ""Zitat""\nZeile 2"\n');
});

test('lässt beim fehlgeschlagenen Rename das vorhandene Artefakt unverändert', () => {
  const tempDir = createTempDataDir();
  const target = path.join(tempDir, 'output', 'job-123--pending', 'manifest.json');
  let failRename = false;
  const writer = new OutputArtifactWriter({
    dataDir: tempDir,
    rename: (source, destination) => {
      if (failRename) throw new Error('rename failed');
      fs.renameSync(source, destination);
    },
  });

  writer.writeManifest('job-123', { version: 1 });
  const initial = fs.readFileSync(target, 'utf8');
  failRename = true;
  assert.throws(() => writer.writeManifest('job-123', { version: 2 }), /rename failed/);
  assert.equal(fs.readFileSync(target, 'utf8'), initial);
  assert.equal(fs.readdirSync(path.dirname(target)).some(name => name.includes('.tmp-')), false);
});
