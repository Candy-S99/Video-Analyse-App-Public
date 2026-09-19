import fs from 'node:fs';
import path from 'node:path';
import type { JobOutputArtifact, JobOutputListing, JobResult, OutputArtifactPreviewKind } from '../../shared/types';
import { OutputLayout, type JobOutputPaths } from './outputLayout';

type OutputJob = Pick<JobResult, 'job_id' | 'video'>;

export interface ResolvedOutputArtifact extends JobOutputArtifact {
  absolute_path: string;
}

export class OutputArtifactPathError extends Error {
  public readonly code = 'INVALID_OUTPUT_PATH';

  constructor(message = 'Ungültiger Output-Dateipfad') {
    super(message);
    this.name = 'OutputArtifactPathError';
  }
}

export class OutputArtifactNotFoundError extends Error {
  public readonly code = 'OUTPUT_ARTIFACT_NOT_FOUND';

  constructor(message = 'Output-Datei nicht gefunden') {
    super(message);
    this.name = 'OutputArtifactNotFoundError';
  }
}

export class OutputDirectoryNotFoundError extends Error {
  public readonly code = 'OUTPUT_DIRECTORY_NOT_FOUND';

  constructor(message = 'Output-Ordner nicht gefunden') {
    super(message);
    this.name = 'OutputDirectoryNotFoundError';
  }
}

const MIME_TYPES: Record<string, { mimeType: string; previewKind: OutputArtifactPreviewKind }> = {
  '.png': { mimeType: 'image/png', previewKind: 'image' },
  '.jpg': { mimeType: 'image/jpeg', previewKind: 'image' },
  '.jpeg': { mimeType: 'image/jpeg', previewKind: 'image' },
  '.webp': { mimeType: 'image/webp', previewKind: 'image' },
  '.json': { mimeType: 'application/json', previewKind: 'text' },
  '.txt': { mimeType: 'text/plain', previewKind: 'text' },
  '.csv': { mimeType: 'text/csv', previewKind: 'text' },
  '.mp4': { mimeType: 'video/mp4', previewKind: 'none' },
};

export interface OutputArtifactServiceOptions {
  dataDir: string;
  layout?: OutputLayout;
}

export class OutputArtifactService {
  private readonly layout: OutputLayout;

  constructor(options: OutputArtifactServiceOptions) {
    this.layout = options.layout || new OutputLayout({ dataDir: options.dataDir });
  }

  public list(job: OutputJob): JobOutputListing {
    const paths = this.getJobPaths(job);
    const artifacts = this.walk(paths.jobDirectory)
      .map(absolutePath => this.toArtifact(absolutePath, paths.jobDirectory));

    return {
      job_id: job.job_id,
      output_directory: paths.relativeJobDirectory,
      artifacts,
    };
  }

  public resolve(job: OutputJob, relativePath: string): ResolvedOutputArtifact {
    const paths = this.getJobPaths(job);
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      throw new OutputArtifactPathError();
    }

    let absolutePath: string;
    try {
      absolutePath = paths.artifactPath(relativePath);
    } catch (error) {
      throw new OutputArtifactPathError(error instanceof Error ? error.message : undefined);
    }

    this.assertRegularPath(paths.jobDirectory, absolutePath);

    const canonicalRoot = fs.realpathSync(paths.jobDirectory);
    const canonicalPath = fs.realpathSync(absolutePath);
    if (!this.isContained(canonicalRoot, canonicalPath)) {
      throw new OutputArtifactPathError('Output-Dateipfad verlässt den Jobordner');
    }

    return {
      ...this.toArtifact(absolutePath, paths.jobDirectory),
      absolute_path: absolutePath,
    };
  }

  private getJobPaths(job: OutputJob): JobOutputPaths {
    const title = typeof job.video?.title === 'string' ? job.video.title : undefined;
    const paths = this.layout.forJob(job.job_id, title);
    if (!fs.existsSync(paths.jobDirectory) || !fs.statSync(paths.jobDirectory).isDirectory()) {
      throw new OutputDirectoryNotFoundError();
    }
    return paths;
  }

  private walk(directory: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        files.push(...this.walk(absolutePath));
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
    return files;
  }

  private toArtifact(absolutePath: string, root: string): JobOutputArtifact {
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
    const fileName = path.basename(absolutePath);
    const extension = path.extname(fileName).toLowerCase();
    const metadata = MIME_TYPES[extension] || { mimeType: 'application/octet-stream', previewKind: 'none' as const };
    return {
      relative_path: relativePath,
      file_name: fileName,
      size_bytes: fs.statSync(absolutePath).size,
      mime_type: metadata.mimeType,
      preview_kind: metadata.previewKind,
    };
  }

  private assertRegularPath(root: string, candidate: string): void {
    const relative = path.relative(root, candidate);
    let current = root;
    const components = relative.split(path.sep);
    for (const [index, component] of components.entries()) {
      current = path.join(current, component);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(current);
      } catch {
        throw new OutputArtifactNotFoundError();
      }
      if (stat.isSymbolicLink()) {
        throw new OutputArtifactPathError('Output-Dateipfad enthält einen symbolischen Link');
      }
      const finalComponent = index === components.length - 1;
      if ((!finalComponent && !stat.isDirectory()) || (finalComponent && !stat.isFile())) {
        throw new OutputArtifactNotFoundError();
      }
    }
  }

  private isContained(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
  }
}
