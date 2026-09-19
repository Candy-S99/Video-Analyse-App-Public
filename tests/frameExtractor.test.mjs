import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FrameExtractor, FrameExtractionError } from '../src/backend/services/frameExtractor.ts';

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-frame-test-'));
}

function createPng(width = 1920, height = 1080, bodySize = 64) {
  const png = Buffer.alloc(33 + bodySize);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 4, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png[24] = 8;
  png[25] = 2;
  png.write('IEND', png.length - 4, 4, 'ascii');
  return png;
}

function createSuccessfulChildProcess({ outputPath, stderr = '' } = {}) {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalled = false;
  child.kill = () => { child.killCalled = true; };
  queueMicrotask(() => {
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    if (outputPath) fs.writeFileSync(outputPath, createPng());
    child.emit('close', 0, null);
  });
  return child;
}

test('startet ffmpeg mit exaktem Zeitpunkt und einem PNG-Frame', async () => {
  const calls = [];
  const extractor = new FrameExtractor({
    spawn: (...args) => {
      calls.push(args);
      return createSuccessfulChildProcess({ outputPath: args[1].at(-1) });
    },
  });
  const outputPath = 'C:/jobs/job-123/06-screenshots/scene-001.png';

  const result = await extractor.extract({
    sourcePath: 'C:/jobs/job-123/03-video/video.mp4',
    timestampSeconds: 23.5,
    outputPath,
  });

  assert.deepEqual(calls[0][1], [
    '-hide_banner', '-loglevel', 'error', '-ss', '23.5', '-i',
    'C:/jobs/job-123/03-video/video.mp4', '-frames:v', '1', '-c:v', 'png', '-y', outputPath,
  ]);
  assert.deepEqual(calls[0][2], { stdio: ['ignore', 'ignore', 'pipe'] });
  assert.deepEqual(result, { outputPath, width: 1920, height: 1080, fileSizeBytes: 97 });
});

test('beendet ffmpeg beim Abbruchsignal', async () => {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalled = false;
  child.kill = () => { child.killCalled = true; };
  const controller = new AbortController();
  const extractor = new FrameExtractor({ spawn: () => child });

  const pending = extractor.extract({
    sourcePath: 'video.mp4',
    timestampSeconds: 1,
    outputPath: 'scene-001.png',
    abortSignal: controller.signal,
  });
  controller.abort();

  await assert.rejects(pending, error => error instanceof FrameExtractionError && error.code === 'ABORTED');
  assert.equal(child.killCalled, true);
});

test('liefert Originalauflösung und lehnt fehlende PNG-Ausgabe ab', async () => {
  const directory = createTempDirectory();
  const outputPath = path.join(directory, 'scene.png');
  const extractor = new FrameExtractor({
    spawn: (...args) => createSuccessfulChildProcess({ outputPath: args[1].at(-1) }),
  });

  const result = await extractor.extract({
    sourcePath: path.join(directory, 'video.mp4'),
    timestampSeconds: 0,
    outputPath,
  });
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.equal(result.fileSizeBytes, fs.statSync(outputPath).size);

  await assert.rejects(
    new FrameExtractor({ spawn: () => createSuccessfulChildProcess() }).extract({ sourcePath: 'video.mp4', timestampSeconds: 1, outputPath: path.join(directory, 'missing.png') }),
    error => error instanceof FrameExtractionError && error.code === 'OUTPUT_MISSING',
  );
});

test('typisiert ffmpeg-Fehler mit gekürztem stderr und erkennt fehlendes ffmpeg', async () => {
  const longStderr = 'diagnosis '.repeat(500);
  const failingSpawn = () => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stderr.emit('data', Buffer.from(longStderr));
      child.emit('close', 1, null);
    });
    return child;
  };
  const extractor = new FrameExtractor({ spawn: failingSpawn });
  await assert.rejects(
    extractor.extract({ sourcePath: 'video.mp4', timestampSeconds: 1, outputPath: 'scene.png' }),
    error => error instanceof FrameExtractionError && error.code === 'PROCESS_FAILED'
      && error.stderr.length <= 2000 && /diagnosis/.test(error.message),
  );
  const missingExtractor = new FrameExtractor({
    spawn: () => { throw Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }); },
  });
  await assert.rejects(
    missingExtractor.extract({ sourcePath: 'video.mp4', timestampSeconds: 1, outputPath: 'scene.png' }),
    error => error instanceof FrameExtractionError && error.code === 'FFMPEG_NOT_FOUND',
  );
});

test('weist negative, nichtfinite und hinter der Videolänge liegende Zeitpunkte zurück', async () => {
  const spawn = () => { throw new Error('spawn darf nicht aufgerufen werden'); };
  const extractor = new FrameExtractor({ spawn });

  for (const timestampSeconds of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      extractor.extract({ sourcePath: 'video.mp4', timestampSeconds, outputPath: 'scene.png' }),
      error => error instanceof FrameExtractionError && error.code === 'INVALID_TIMESTAMP',
    );
  }
  await assert.rejects(
    extractor.extract({ sourcePath: 'video.mp4', timestampSeconds: 60.1, durationSeconds: 60, outputPath: 'scene.png' }),
    error => error instanceof FrameExtractionError && error.code === 'INVALID_TIMESTAMP',
  );
});

test('erzwingt bei gesetztem Jobordner Pfad-Containment für die Ausgabe', async () => {
  const directory = createTempDirectory();
  const extractor = new FrameExtractor({ spawn: () => { throw new Error('spawn darf nicht aufgerufen werden'); } });

  await assert.rejects(
    extractor.extract({
      jobDirectory: directory,
      sourcePath: path.join(directory, '03-video', 'video.mp4'),
      timestampSeconds: 1,
      outputPath: path.join(directory, '..', 'outside.png'),
    }),
    error => error instanceof FrameExtractionError && error.code === 'PATH_OUTSIDE_JOB',
  );
});
