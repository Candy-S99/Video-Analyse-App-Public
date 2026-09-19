import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { OutputLayout } from './outputLayout';

export interface OutputArtifactWriterOptions {
  dataDir: string;
  now?: () => Date;
  rename?: (source: string, destination: string) => void;
  layout?: OutputLayout;
}

export interface SceneArtifact {
  candidate_id?: string;
  timestamp_seconds?: number;
  start_seconds?: number;
  end_seconds?: number;
  category?: string;
  information_score?: number;
  visual_description?: string;
}

const SCENE_COLUMNS = [
  'candidate_id',
  'timestamp_seconds',
  'start_seconds',
  'end_seconds',
  'category',
  'information_score',
  'visual_description',
] as const;

export class OutputArtifactWriter {
  private readonly layout: OutputLayout;
  private readonly now: () => Date;
  private readonly rename: (source: string, destination: string) => void;

  constructor(options: OutputArtifactWriterOptions) {
    this.layout = options.layout || new OutputLayout({ dataDir: options.dataDir });
    this.now = options.now || (() => new Date());
    this.rename = options.rename || ((source, destination) => fs.renameSync(source, destination));
  }

  public writeSource(jobId: string, source: Record<string, unknown> | string, title?: string): string {
    const content = typeof source === 'string'
      ? source
      : Object.entries(source)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join('\n');
    return this.writeTextArtifact(jobId, '00-source/source.txt', content, title);
  }

  public writeInfo(jobId: string, info: unknown, title?: string): string {
    return this.writeTextArtifact(jobId, '01-metadata/info.json', `${JSON.stringify(info, null, 2)}\n`, title);
  }

  public writeDescription(jobId: string, description: unknown, title?: string): string {
    const content = typeof description === 'string'
      ? description
      : String((description as { description?: unknown })?.description ?? '');
    return this.writeTextArtifact(jobId, '01-metadata/description.txt', content, title);
  }

  public writeTranscript(jobId: string, transcript: unknown, title?: string): string {
    const content = typeof transcript === 'string'
      ? transcript
      : String((transcript as { full_text?: unknown })?.full_text ?? '');
    return this.writeTextArtifact(jobId, '02-transcript/transcript.txt', content, title);
  }

  public writeScenes(jobId: string, scenes: SceneArtifact[], title?: string): string {
    const rows = [SCENE_COLUMNS.join(','), ...scenes.map(scene => SCENE_COLUMNS.map(column => this.csvValue(scene[column])).join(','))];
    return this.writeTextArtifact(jobId, '05-scenes/scenes.csv', `${rows.join('\n')}\n`, title);
  }

  public writeManifest(jobId: string, manifest: unknown, title?: string): string {
    return this.writeTextArtifact(jobId, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, title);
  }

  public writeArtifact(jobId: string, relativePath: string, content: string | Buffer, title?: string): string {
    return this.writeTextArtifact(jobId, relativePath, content, title);
  }

  private writeTextArtifact(jobId: string, relativePath: string, content: string | Buffer, title?: string): string {
    const job = this.layout.ensureJobDirectories(jobId, title);
    const targetPath = job.artifactPath(relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.tmp-${randomUUID()}`);
    let fileDescriptor: number | undefined;
    try {
      fileDescriptor = fs.openSync(temporaryPath, 'w');
      fs.writeFileSync(fileDescriptor, content);
      fs.fsyncSync(fileDescriptor);
      fs.closeSync(fileDescriptor);
      fileDescriptor = undefined;
      this.rename(temporaryPath, targetPath);
      return targetPath;
    } finally {
      if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
  }

  private csvValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    const text = String(value);
    return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
}
