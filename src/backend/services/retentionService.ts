import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface RetentionResult { deleted_count: number; deleted_size_bytes: number; deleted_paths: string[]; warnings: string[]; }

interface ScreenshotRecord { relative_path?: unknown; retention_status?: string; status?: string; purged_at?: string; }
interface ManifestRecord { screenshot_candidates?: Array<{ screenshots?: ScreenshotRecord[] }>; }

export class RetentionService {
  constructor(private readonly dataDir: string, private readonly now = () => Date.now(), private readonly maxAgeMs = 60 * 24 * 60 * 60 * 1000) {}

  public preview(): RetentionResult { return this.collect(false); }
  public cleanup({ confirm }: { confirm: boolean }): RetentionResult { return confirm === true ? this.collect(true) : { deleted_count: 0, deleted_size_bytes: 0, deleted_paths: [], warnings: ['confirmation required'] }; }
  public runStartupCleanup(enabled: boolean): RetentionResult { return enabled ? this.cleanup({ confirm: true }) : { deleted_count: 0, deleted_size_bytes: 0, deleted_paths: [], warnings: ['automatic cleanup disabled'] }; }

  private collect(remove: boolean): RetentionResult {
    const output = path.join(this.dataDir, 'output');
    const result: RetentionResult = { deleted_count: 0, deleted_size_bytes: 0, deleted_paths: [], warnings: [] };
    if (!fs.existsSync(output)) return result;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(file); continue; }
        const relative = path.relative(this.dataDir, file).split(path.sep).join('/');
        if (entry.name === 'manifest.json' || entry.name === 'README.md' || /\.(json|jsonl|log)$/i.test(entry.name) || !/\.(png|tmp)$/i.test(entry.name)) continue;
        const stats = fs.statSync(file);
        if (this.now() - stats.mtimeMs < this.maxAgeMs) continue;
        result.deleted_count++;
        result.deleted_size_bytes += stats.size;
        result.deleted_paths.push(relative);
        if (remove) {
          fs.unlinkSync(file);
          if (/\.png$/i.test(entry.name)) this.markScreenshotPurged(file, relative, result.warnings);
        }
      }
    };
    walk(output);
    return result;
  }

  private markScreenshotPurged(file: string, relativePath: string, warnings: string[]): void {
    const manifestPath = path.join(path.dirname(path.dirname(file)), 'manifest.json');
    if (!fs.existsSync(manifestPath)) return;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManifestRecord;
      let changed = false;
      for (const candidate of manifest.screenshot_candidates ?? []) for (const screenshot of candidate.screenshots ?? []) {
        if (screenshot.relative_path !== relativePath) continue;
        screenshot.retention_status = 'PURGED';
        screenshot.status = 'PURGED';
        screenshot.purged_at = new Date(this.now()).toISOString();
        changed = true;
      }
      if (!changed) return;
      const temporary = path.join(path.dirname(manifestPath), `.${path.basename(manifestPath)}.tmp-${randomUUID()}`);
      fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
      fs.renameSync(temporary, manifestPath);
    } catch (error: any) {
      warnings.push(`Manifest konnte nach Löschung nicht aktualisiert werden: ${String(error?.message || error).slice(0, 200)}`);
    }
  }
}
