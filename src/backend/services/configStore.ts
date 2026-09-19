import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface PersistedAppConfig {
  model: string;
  segment_length_seconds: number;
  extract_transcript: boolean;
  fine_search_window_seconds: number;
  fine_search_interval_seconds: number;
  max_screenshots_per_candidate: number;
  fine_search_fallback: 'exact_timestamp' | 'skip';
  automatic_cleanup_enabled: boolean;
}

export interface ConfigStoreOptions {
  filePath: string;
}

const PERSISTED_FIELDS: (keyof PersistedAppConfig)[] = [
  'model',
  'segment_length_seconds',
  'extract_transcript',
  'fine_search_window_seconds',
  'fine_search_interval_seconds',
  'max_screenshots_per_candidate',
  'fine_search_fallback',
  'automatic_cleanup_enabled',
];

export class ConfigStore {
  private readonly filePath: string;

  constructor({ filePath }: ConfigStoreOptions) {
    this.filePath = path.resolve(filePath);
  }

  public load(): Partial<PersistedAppConfig> | null {
    if (!fs.existsSync(this.filePath)) return null;

    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

      const source = parsed as Record<string, unknown>;
      const result: Partial<PersistedAppConfig> = {};
      for (const field of PERSISTED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(source, field)) {
          (result as Record<string, unknown>)[field] = source[field];
        }
      }
      return result;
    } catch {
      return null;
    }
  }

  public save(config: PersistedAppConfig): void {
    const persisted = Object.fromEntries(
      PERSISTED_FIELDS.map(field => [field, config[field]]),
    );
    const temporaryPath = `${this.filePath}.tmp-${randomUUID()}`;

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      try {
        fs.renameSync(temporaryPath, this.filePath);
      } catch (error) {
        if (!fs.existsSync(this.filePath)) throw error;
        fs.rmSync(this.filePath, { force: true });
        fs.renameSync(temporaryPath, this.filePath);
      }
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}
