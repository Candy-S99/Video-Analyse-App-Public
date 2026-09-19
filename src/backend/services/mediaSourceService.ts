import fs from 'node:fs';
import path from 'node:path';
import youtubeDl from 'youtube-dl-exec';
import { OutputLayout } from './outputLayout';
import { youtubeService, type YouTubeService } from './youtubeService';
import { ProcessRegistry } from './processRegistry';

export type MediaSourceErrorCode = 'INVALID_YOUTUBE_URL' | 'INVALID_JOB_ID' | 'DOWNLOAD_FAILED';

export class MediaSourceError extends Error {
  constructor(public readonly code: MediaSourceErrorCode, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MediaSourceError';
  }
}

type DownloaderOptions = { output: string; noPlaylist: true; format: string; jsRuntimes: 'node' };
type DownloaderProcess = Promise<unknown> & { kill?: (signal?: NodeJS.Signals) => boolean | void; on?: (...args: any[]) => unknown; once?: (...args: any[]) => unknown };
type Downloader = (url: string, options: DownloaderOptions) => DownloaderProcess;

function isRetryableDownloadError(error: unknown): boolean {
  const value = error as { message?: unknown; stderr?: unknown } | null;
  const text = [value?.message, value?.stderr, error].map(String).join(' ');
  return /\b(?:403|429|5\d\d)\b|timed? ?out|network|connection|temporarily|unavailable/i.test(text);
}

export interface MediaSourceServiceOptions {
  dataDir?: string;
  layout?: OutputLayout;
  youtubeService?: Pick<YouTubeService, 'extractYouTubeId' | 'getCanonicalUrl'>;
  downloader?: Downloader;
  processRegistry?: ProcessRegistry;
}

export interface MaterializeMediaRequest { jobId: string; title?: string; sourceUrl: string; abortSignal?: AbortSignal; }
export interface MaterializedMedia { sourcePath: string; localPath: string; canonicalUrl: string; }

export class MediaSourceService {
  private readonly layout: OutputLayout;
  private readonly youtube: Pick<YouTubeService, 'extractYouTubeId' | 'getCanonicalUrl'>;
  private readonly downloader: Downloader;
  private readonly processRegistry?: ProcessRegistry;

  constructor({ dataDir, layout, youtubeService: providedYoutube = youtubeService, downloader, processRegistry }: MediaSourceServiceOptions = {}) {
    if (!layout && !dataDir) throw new Error('dataDir or layout is required');
    this.layout = layout ?? new OutputLayout({ dataDir: dataDir! });
    this.youtube = providedYoutube;
    this.downloader = downloader ?? ((url, options) => youtubeDl.exec(url, options) as unknown as DownloaderProcess);
    this.processRegistry = processRegistry;
  }

  public async resolve(request: MaterializeMediaRequest): Promise<MaterializedMedia> { return this.materialize(request); }

  public async materialize({ jobId, title, sourceUrl, abortSignal }: MaterializeMediaRequest): Promise<MaterializedMedia> {
    const id = this.youtube.extractYouTubeId(sourceUrl);
    if (!id) throw new MediaSourceError('INVALID_YOUTUBE_URL', 'A public YouTube video URL is required.');
    let paths;
    try { paths = this.layout.ensureJobDirectories(jobId, title); } catch (error) { throw new MediaSourceError('INVALID_JOB_ID', 'Invalid job output path.', error); }
    const canonicalUrl = this.youtube.getCanonicalUrl(sourceUrl);
    const targetPath = paths.artifactPath('03-video/video.mp4');
    const temporaryPath = path.join(path.dirname(targetPath), `.video.tmp-${process.pid}-${Date.now()}.mp4`);
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const process = this.downloader(canonicalUrl, { output: temporaryPath, noPlaylist: true, format: 'bestvideo[ext=mp4][protocol=https][height<=480]/best[ext=mp4][protocol=https][height<=480]/best[ext=mp4]', jsRuntimes: 'node' });
        const unregister = process.kill ? this.processRegistry?.register(process as any) : undefined;
        const abort = () => process.kill?.('SIGTERM');
        try {
          abortSignal?.addEventListener('abort', abort, { once: true });
          if (abortSignal?.aborted) abort();
          await process;
        } finally {
          abortSignal?.removeEventListener('abort', abort);
          unregister?.();
        }
        if (!fs.existsSync(temporaryPath)) throw new Error('Downloader did not write the requested video.');
        fs.renameSync(temporaryPath, targetPath);
        return { sourcePath: targetPath, localPath: targetPath, canonicalUrl };
      } catch (error) {
        lastError = error;
        if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
        if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
        if (attempt >= 3 || !isRetryableDownloadError(error)) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
      if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
      throw new MediaSourceError('DOWNLOAD_FAILED', 'Public video download failed.', lastError);
    }
  }
}
