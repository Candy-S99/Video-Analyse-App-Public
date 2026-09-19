import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MediaSourceError, MediaSourceService } from '../src/backend/services/mediaSourceService.ts';
import { OutputLayout } from '../src/backend/services/outputLayout.ts';
import { youtubeService } from '../src/backend/services/youtubeService.ts';

function createTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'video-analysis-media-test-'));
}

test('validiert YouTube-ID und materialisiert Video atomar in 03-video/video.mp4', async () => {
  const dataDir = createTempDataDir();
  const layout = new OutputLayout({ dataDir });
  const calls = [];
  const service = new MediaSourceService({
    layout,
    downloader: async (url, options) => {
      calls.push({ url, options });
      fs.writeFileSync(options.output, Buffer.from('video-data'));
    },
  });

  const result = await service.materialize({
    jobId: 'job-123',
    title: 'Sicherer Titel / Demo',
    sourceUrl: 'https://youtu.be/abcdefghijk?t=2',
  });
  const expected = layout.forJob('job-123', 'Sicherer Titel / Demo').artifactPath('03-video/video.mp4');

  assert.equal(result.sourcePath, expected);
  assert.equal(result.localPath, expected);
  assert.equal(result.canonicalUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(fs.readFileSync(expected, 'utf8'), 'video-data');
  assert.equal(fs.readdirSync(path.dirname(expected)).some(name => name.includes('.tmp-')), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, result.canonicalUrl);
  assert.equal(calls[0].options.noPlaylist, true);
  assert.equal(calls[0].options.jsRuntimes, 'node');
  assert.equal(calls[0].options.format, 'bestvideo[ext=mp4][protocol=https][height<=480]/best[ext=mp4][protocol=https][height<=480]/best[ext=mp4]');
  assert.equal(Object.hasOwn(calls[0].options, 'cookies'), false);
  assert.equal(Object.hasOwn(calls[0].options, 'username'), false);
  assert.equal(Object.hasOwn(calls[0].options, 'password'), false);
  assert.equal(Object.hasOwn(calls[0].options, 'allowUnplayableFormats'), false);
});

test('weist ungültige Quellen vor dem Downloader und unsichere Jobpfade zurück', async () => {
  let downloadCalls = 0;
  const service = new MediaSourceService({
    dataDir: createTempDataDir(),
    youtubeService: { extractYouTubeId: () => null },
    downloader: async () => { downloadCalls += 1; },
  });

  await assert.rejects(
    service.materialize({ jobId: 'job-123', sourceUrl: 'https://example.com/video' }),
    error => error instanceof MediaSourceError && error.code === 'INVALID_YOUTUBE_URL',
  );
  assert.equal(downloadCalls, 0);

  const unsafeJobService = new MediaSourceService({
    dataDir: createTempDataDir(),
    youtubeService,
    downloader: async () => { downloadCalls += 1; },
  });
  await assert.rejects(
    unsafeJobService.materialize({ jobId: '../outside', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk' }),
    error => error instanceof MediaSourceError && error.code === 'INVALID_JOB_ID',
  );
});

test('verwendet ausschließlich kanonische YouTube-URLs aus YoutubeService', async () => {
  const received = [];
  const service = new MediaSourceService({
    dataDir: createTempDataDir(),
    youtubeService,
    downloader: async (url, options) => {
      received.push({ url, options });
      fs.writeFileSync(options.output, 'video');
    },
  });

  await service.resolve({ jobId: 'job-456', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk&list=private-looking' });
  assert.equal(received[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(received[0].options.noPlaylist, true);
});

test('räumt temporäres Material nach Downloaderfehler auf', async () => {
  const dataDir = createTempDataDir();
  const layout = new OutputLayout({ dataDir });
  const service = new MediaSourceService({
    layout,
    downloader: async (_url, options) => {
      fs.writeFileSync(options.output, 'partial');
      throw new Error('download failed');
    },
  });

  await assert.rejects(
    service.materialize({ jobId: 'job-789', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk' }),
    error => error instanceof MediaSourceError && error.code === 'DOWNLOAD_FAILED',
  );
  const job = layout.forJob('job-789');
  assert.equal(fs.existsSync(job.artifactPath('03-video/video.mp4')), false);
  assert.equal(fs.readdirSync(job.artifactPath('03-video')).some(name => name.includes('.tmp-')), false);
});

test('wiederholt einen transienten Downloaderfehler und materialisiert beim Folgeversuch', async () => {
  const dataDir = createTempDataDir();
  const layout = new OutputLayout({ dataDir });
  let attempts = 0;
  const service = new MediaSourceService({
    layout,
    downloader: async (_url, options) => {
      attempts += 1;
      if (attempts === 1) {
        fs.writeFileSync(options.output, 'partial');
        throw new Error('HTTP Error 403: Forbidden');
      }
      fs.writeFileSync(options.output, 'video-data');
    },
  });

  const result = await service.materialize({ jobId: 'job-retry', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk' });
  const target = layout.forJob('job-retry').artifactPath('03-video/video.mp4');

  assert.equal(result.localPath, target);
  assert.equal(attempts, 2);
  assert.equal(fs.readFileSync(target, 'utf8'), 'video-data');
  assert.equal(fs.readdirSync(path.dirname(target)).some(name => name.includes('.tmp-')), false);
});
