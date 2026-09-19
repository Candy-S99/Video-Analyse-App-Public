import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ProcessRegistry } from './processRegistry';

export type FrameExtractionErrorCode = 'ABORTED' | 'FFMPEG_NOT_FOUND' | 'INVALID_TIMESTAMP' | 'OUTPUT_MISSING' | 'PATH_OUTSIDE_JOB' | 'PROCESS_FAILED';

export class FrameExtractionError extends Error {
  constructor(public readonly code: FrameExtractionErrorCode, message: string, public readonly stderr = '') {
    super(message);
    this.name = 'FrameExtractionError';
  }
}

type ChildLike = {
  stderr?: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown };
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean | void;
};

export interface FrameExtractorOptions {
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildLike;
  processRegistry?: ProcessRegistry;
}

export interface ExtractFrameRequest {
  sourcePath: string;
  timestampSeconds: number;
  outputPath: string;
  durationSeconds?: number;
  jobDirectory?: string;
  abortSignal?: AbortSignal;
}

export interface ExtractedFrame {
  outputPath: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export class FrameExtractor {
  private readonly spawn: FrameExtractorOptions['spawn'];
  private readonly processRegistry?: ProcessRegistry;

  constructor({ spawn = nodeSpawn as unknown as FrameExtractorOptions['spawn'], processRegistry }: FrameExtractorOptions = {}) {
    this.spawn = spawn;
    this.processRegistry = processRegistry;
  }

  public async extract(request: ExtractFrameRequest): Promise<ExtractedFrame> {
    this.validateRequest(request);
    if (request.abortSignal?.aborted) throw new FrameExtractionError('ABORTED', 'Frame extraction aborted.');
    mkdirSync(path.dirname(request.outputPath), { recursive: true });

    const args = ['-hide_banner', '-loglevel', 'error', '-ss', String(request.timestampSeconds), '-i', request.sourcePath, '-frames:v', '1', '-c:v', 'png', '-y', request.outputPath];
    const child = this.start('ffmpeg', args);
    const unregister = this.processRegistry?.register(child as any);
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-2000); });

    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          child.kill('SIGTERM');
          reject(new FrameExtractionError('ABORTED', 'Frame extraction aborted.'));
        };
        request.abortSignal?.addEventListener('abort', abort, { once: true });
        if (request.abortSignal?.aborted) abort();
        child.on('error', error => {
          request.abortSignal?.removeEventListener('abort', abort);
          reject(this.toProcessError(error, stderr));
        });
        child.on('close', code => {
          request.abortSignal?.removeEventListener('abort', abort);
          if (request.abortSignal?.aborted) return reject(new FrameExtractionError('ABORTED', 'Frame extraction aborted.'));
          if (code !== 0) return reject(new FrameExtractionError('PROCESS_FAILED', `ffmpeg failed${stderr ? `: ${stderr}` : ''}`, stderr));
          resolve();
        });
      });
    } finally {
      unregister?.();
    }

    if (!existsSync(request.outputPath)) throw new FrameExtractionError('OUTPUT_MISSING', 'ffmpeg did not create a PNG output.');
    const metadata = this.readPngMetadata(request.outputPath);
    return { outputPath: request.outputPath, ...metadata };
  }

  private start(command: string, args: string[]): ChildLike {
    try {
      return this.spawn!(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      throw this.toProcessError(error as NodeJS.ErrnoException, '');
    }
  }

  private validateRequest(request: ExtractFrameRequest): void {
    if (!Number.isFinite(request.timestampSeconds) || request.timestampSeconds < 0 || (request.durationSeconds !== undefined && request.timestampSeconds > request.durationSeconds)) {
      throw new FrameExtractionError('INVALID_TIMESTAMP', 'Timestamp must be within the video duration.');
    }
    if (request.jobDirectory) {
      const root = path.resolve(request.jobDirectory);
      const output = path.resolve(request.outputPath);
      const relative = path.relative(root, output);
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        throw new FrameExtractionError('PATH_OUTSIDE_JOB', 'Frame output path escapes the job directory.');
      }
    }
  }

  private readPngMetadata(filePath: string): Omit<ExtractedFrame, 'outputPath'> {
    const buffer = readFileSync(filePath).subarray(0, 24);
    if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString('ascii', 12, 16) !== 'IHDR') {
      throw new FrameExtractionError('OUTPUT_MISSING', 'ffmpeg output is not a valid PNG.');
    }
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), fileSizeBytes: statSync(filePath).size };
  }

  private toProcessError(error: NodeJS.ErrnoException, stderr: string): FrameExtractionError {
    if (error.code === 'ENOENT') return new FrameExtractionError('FFMPEG_NOT_FOUND', 'ffmpeg executable was not found.');
    return new FrameExtractionError('PROCESS_FAILED', `ffmpeg failed${stderr ? `: ${stderr}` : `: ${error.message}`}`, stderr);
  }
}
