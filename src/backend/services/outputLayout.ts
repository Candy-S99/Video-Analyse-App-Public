import fs from 'fs';
import path from 'path';

const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DIRECTORY_NAMES = ['00-source', '01-metadata', '02-transcript', '03-video', '05-scenes', '06-screenshots'] as const;
const WINDOWS_RESERVED_NAMES = new Set([
  'aux', 'con', 'nul', 'prn',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

const TRANSLITERATION: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss',
  æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ħ: 'h',
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'Zh', З: 'Z', И: 'I', Й: 'J',
  К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F',
  Х: 'Kh', Ц: 'Ts', Ч: 'Ch', Ш: 'Sh', Щ: 'Sch', Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'Yu', Я: 'Ya',
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'j',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export interface JobOutputPaths {
  jobId: string;
  safeTitle: string;
  relativeJobDirectory: string;
  jobDirectory: string;
  manifestPath: string;
  eventsPath: string;
  screenshotPath(sceneId: string): string;
  artifactPath(relativePath: string): string;
}

export interface OutputLayoutOptions {
  dataDir: string;
}

export class OutputLayout {
  private readonly dataDir: string;
  private readonly canonicalDataDir: string;
  private readonly outputDirectory: string;

  constructor({ dataDir }: OutputLayoutOptions) {
    this.dataDir = path.resolve(dataDir);
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.canonicalDataDir = fs.realpathSync(this.dataDir);
    this.outputDirectory = this.assertContained(path.join(this.canonicalDataDir, 'output'));
  }

  public forJob(jobId: string, title?: string): JobOutputPaths {
    this.assertJobId(jobId);
    const hasTitle = typeof title === 'string' && title.trim().length > 0;
    const safeTitle = hasTitle ? this.safeTitle(title as string) : 'pending';
    const jobDirectory = hasTitle
      ? path.join(this.outputDirectory, `${jobId}--${safeTitle}`)
      : this.findExistingJobDirectory(jobId) || path.join(this.outputDirectory, `${jobId}--pending`);
    const safeJobDirectory = this.assertContained(jobDirectory);
    const relativeJobDirectory = this.toRelativePath(safeJobDirectory);
    const manifestPath = this.assertContained(path.join(safeJobDirectory, 'manifest.json'));
    const eventsPath = this.eventsPath();

    return {
      jobId,
      safeTitle,
      relativeJobDirectory,
      jobDirectory: safeJobDirectory,
      manifestPath,
      eventsPath,
      screenshotPath: (sceneId: string) => this.screenshotPathForDirectory(safeJobDirectory, sceneId),
      artifactPath: (relativePath: string) => this.artifactPathForDirectory(safeJobDirectory, relativePath),
    };
  }

  public manifestPath(jobId: string, title?: string): string {
    return this.forJob(jobId, title).manifestPath;
  }

  public eventsPath(): string {
    return this.assertContained(path.join(this.canonicalDataDir, 'events.jsonl'));
  }

  public screenshotPath(jobId: string, sceneId: string, title?: string): string {
    return this.forJob(jobId, title).screenshotPath(sceneId);
  }

  public artifactPath(jobId: string, relativePath: string, title?: string): string {
    return this.forJob(jobId, title).artifactPath(relativePath);
  }

  public ensureJobDirectories(jobId: string, title?: string): JobOutputPaths {
    this.assertJobId(jobId);
    fs.mkdirSync(this.outputDirectory, { recursive: true });

    const hasTitle = typeof title === 'string' && title.trim().length > 0;
    if (hasTitle) {
      const finalPaths = this.forJob(jobId, title);
      const pendingDirectory = this.assertContained(path.join(this.outputDirectory, `${jobId}--pending`));
      if (!fs.existsSync(finalPaths.jobDirectory) && fs.existsSync(pendingDirectory)) {
        this.assertContained(pendingDirectory);
        fs.renameSync(pendingDirectory, finalPaths.jobDirectory);
      }
    }

    const result = this.forJob(jobId, title);
    fs.mkdirSync(result.jobDirectory, { recursive: true });
    for (const directory of DIRECTORY_NAMES) {
      const directoryPath = this.assertContained(path.join(result.jobDirectory, directory));
      fs.mkdirSync(directoryPath, { recursive: true });
    }
    return result;
  }

  public safeTitle(title: string): string {
    const transliterated = Array.from(title.normalize('NFKD'))
      .map(character => TRANSLITERATION[character] ?? character)
      .join('')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    let slug = transliterated
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '');

    if (!slug || WINDOWS_RESERVED_NAMES.has(slug.split('-')[0])) slug = 'video';
    return slug;
  }

  private assertJobId(jobId: unknown): asserts jobId is string {
    if (typeof jobId !== 'string' || !JOB_ID_PATTERN.test(jobId)) {
      throw new Error(`Invalid job ID: ${String(jobId)}`);
    }
  }

  private findExistingJobDirectory(jobId: string): string | null {
    if (!fs.existsSync(this.outputDirectory)) return null;
    const prefix = `${jobId}--`;
    const candidates = fs.readdirSync(this.outputDirectory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
      .sort((left, right) => (left.name.endsWith('--pending') ? -1 : right.name.endsWith('--pending') ? 1 : left.name.localeCompare(right.name)));

    for (const candidate of candidates) {
      const candidatePath = this.assertContained(path.join(this.outputDirectory, candidate.name));
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) return candidatePath;
    }
    return null;
  }

  private screenshotPathForDirectory(jobDirectory: string, sceneId: string): string {
    if (typeof sceneId !== 'string' || /[\\/\u0000-\u001F\u007F]/.test(sceneId) || sceneId.includes('..')) {
      throw new Error('Invalid screenshot scene ID');
    }
    const safeName = this.safeTitle(sceneId);
    return this.assertContained(path.join(jobDirectory, '06-screenshots', `${safeName}.png`));
  }

  private artifactPathForDirectory(jobDirectory: string, relativePath: string): string {
    if (
      typeof relativePath !== 'string'
      || !relativePath
      || /[\u0000-\u001F\u007F]/.test(relativePath)
      || relativePath.includes('\\')
      || path.posix.isAbsolute(relativePath)
      || /^[A-Za-z]:/.test(relativePath)
    ) {
      throw new Error('Invalid artifact path');
    }
    const normalized = path.posix.normalize(relativePath);
    if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
      throw new Error('Artifact path escapes the job directory');
    }
    return this.assertContained(path.join(jobDirectory, ...normalized.split('/')));
  }

  private toRelativePath(candidate: string): string {
    return path.relative(this.canonicalDataDir, candidate).split(path.sep).join('/');
  }

  private assertContained(candidate: string): string {
    const resolved = path.resolve(candidate);
    if (!this.isContained(this.canonicalDataDir, resolved)) throw new Error('Path escapes data directory');

    let probe = resolved;
    const missingParts: string[] = [];
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      missingParts.unshift(path.basename(probe));
      probe = parent;
    }
    const canonicalProbe = fs.realpathSync(probe);
    const canonicalCandidate = path.resolve(canonicalProbe, ...missingParts);
    if (!this.isContained(this.canonicalDataDir, canonicalCandidate)) throw new Error('Path escapes data directory');
    return resolved;
  }

  private isContained(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
  }
}
