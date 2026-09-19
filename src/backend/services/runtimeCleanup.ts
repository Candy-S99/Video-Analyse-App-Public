import fs from 'node:fs';
import path from 'node:path';

const JOB_TEMP_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-.+\.(?:png|tmp|mp4)$/i;

export interface RuntimeCleanupOptions {
  tempDir: string;
  dataDir: string;
}
export class RuntimeCleanup {
  private readonly tempDir: string;
  private readonly dataDir: string;

  constructor({ tempDir, dataDir }: RuntimeCleanupOptions) {
    this.tempDir = path.resolve(tempDir);
    this.dataDir = path.resolve(dataDir);
  }

  public async cleanup(): Promise<void> {
    this.removeMatching(this.tempDir, name => JOB_TEMP_FILE.test(name));
    this.removeMatching(this.dataDir, name => name.startsWith('.video.tmp-'));
  }

  private removeMatching(directory: string, predicate: (name: string) => boolean): void {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        this.removeMatching(absolutePath, predicate);
      } else if (entry.isFile() && predicate(entry.name)) {
        fs.rmSync(absolutePath, { force: true });
      }
    }
  }
}
