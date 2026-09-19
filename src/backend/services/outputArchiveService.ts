import type { Writable } from 'node:stream';
import { ZipArchive } from 'archiver';
import type { JobResult } from '../../shared/types';
import { OutputArtifactService, type ResolvedOutputArtifact } from './outputArtifactService';

export class OutputArchiveRequestError extends Error {
  public readonly code = 'INVALID_OUTPUT_ARCHIVE_REQUEST';

  constructor(message = 'paths muss ein nicht-leeres Array aus Dateipfaden sein') {
    super(message);
    this.name = 'OutputArchiveRequestError';
  }
}

export interface OutputArchiveServiceOptions {
  dataDir: string;
  artifacts?: OutputArtifactService;
}

export class OutputArchiveService {
  private readonly artifacts: OutputArtifactService;

  constructor(options: OutputArchiveServiceOptions) {
    this.artifacts = options.artifacts || new OutputArtifactService({ dataDir: options.dataDir });
  }

  public resolve(job: Pick<JobResult, 'job_id' | 'video'>, paths: unknown): ResolvedOutputArtifact[] {
    if (!Array.isArray(paths) || paths.length === 0 || paths.some(path => typeof path !== 'string')) {
      throw new OutputArchiveRequestError();
    }

    const resolved = (paths as string[]).map(relativePath => this.artifacts.resolve(job, relativePath));
    return [...new Map(resolved.map(artifact => [artifact.relative_path, artifact])).values()];
  }

  public async stream(artifacts: ResolvedOutputArtifact[], destination: Writable): Promise<void> {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const completion = new Promise<void>((resolve, reject) => {
      archive.once('error', reject);
      destination.once('error', reject);
      destination.once('finish', resolve);
    });

    archive.pipe(destination);
    for (const artifact of artifacts) {
      archive.file(artifact.absolute_path, { name: artifact.relative_path });
    }
    await archive.finalize();
    await completion;
  }
}
