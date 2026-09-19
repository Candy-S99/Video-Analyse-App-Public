import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SECRET_STORE_VERSION = 1;
const DEFAULT_DATA_DIR = path.join(process.cwd(), 'data', 'jobs');
const DEFAULT_SECRET_FILE = '.video-analysis-secrets.json';

type PersistedSecretState = {
  version: number;
  gemini_api_key: string | null;
};

export interface SecretStoreOptions {
  filePath?: string;
  environment?: NodeJS.ProcessEnv;
}

export class SecretStore {
  private readonly filePath: string;
  private state: PersistedSecretState;

  constructor({ filePath, environment = process.env }: SecretStoreOptions = {}) {
    this.filePath = path.resolve(
      filePath || path.join(environment.DATA_DIR || DEFAULT_DATA_DIR, DEFAULT_SECRET_FILE),
    );
    this.state = this.load(environment);
  }

  public getGeminiApiKey(): string | undefined {
    return this.state.gemini_api_key || undefined;
  }

  public hasGeminiApiKey(): boolean {
    return Boolean(this.state.gemini_api_key);
  }

  public setGeminiApiKey(value: string): void {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!key) throw new Error('API key must not be empty.');
    this.persist({ version: SECRET_STORE_VERSION, gemini_api_key: key });
  }

  public deleteGeminiApiKey(): void {
    this.persist({ version: SECRET_STORE_VERSION, gemini_api_key: null });
  }

  private load(environment: NodeJS.ProcessEnv): PersistedSecretState {
    if (fs.existsSync(this.filePath)) {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<PersistedSecretState>;
      if (parsed.version !== SECRET_STORE_VERSION || (parsed.gemini_api_key !== null && typeof parsed.gemini_api_key !== 'string')) {
        throw new Error('Secret store has an unsupported format.');
      }
      return {
        version: SECRET_STORE_VERSION,
        gemini_api_key: parsed.gemini_api_key ?? null,
      };
    }

    const environmentKey = environment.GEMINI_API_KEY?.trim();
    const initialState = {
      version: SECRET_STORE_VERSION,
      gemini_api_key: environmentKey || null,
    } satisfies PersistedSecretState;
    if (environmentKey) this.persist(initialState);
    return initialState;
  }

  private persist(nextState: PersistedSecretState): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${randomUUID()}`;
    const descriptor = fs.openSync(temporaryPath, 'w', 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }

    try {
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error: any) {
      // Windows cannot replace an existing destination with rename(). Remove only
      // this exact secret file, then complete the move and keep no temp artifact.
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM' && error?.code !== 'ENOTEMPTY') throw error;
      fs.rmSync(this.filePath, { force: true });
      fs.renameSync(temporaryPath, this.filePath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    }
    this.state = nextState;
  }
}

export const secretStore = new SecretStore();
