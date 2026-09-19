export interface ManagedProcess {
  kill(signal?: NodeJS.Signals): boolean | void;
  on?: (event: 'close' | 'exit' | 'error', listener: (...args: any[]) => void) => unknown;
  once?: (event: 'close' | 'exit' | 'error', listener: (...args: any[]) => void) => unknown;
}
export interface ProcessTerminationOptions {
  graceMs?: number;
  forceMs?: number;
}

export class ProcessRegistry {
  private readonly processes = new Set<ManagedProcess>();
  private terminationPromise: Promise<void> | null = null;

  public get size(): number {
    return this.processes.size;
  }

  public register(process: ManagedProcess): () => void {
    this.processes.add(process);
    const unregister = () => this.unregister(process);
    if (process.once) {
      process.once('close', unregister);
      process.once('exit', unregister);
      process.once('error', unregister);
    } else if (process.on) {
      process.on('close', unregister);
      process.on('exit', unregister);
      process.on('error', unregister);
    }
    return unregister;
  }

  public unregister(process: ManagedProcess): void {
    this.processes.delete(process);
  }

  public async terminateAll({ graceMs = 5000, forceMs = 1000 }: ProcessTerminationOptions = {}): Promise<void> {
    if (this.terminationPromise) return this.terminationPromise;
    this.terminationPromise = this.terminateAllInternal(graceMs, forceMs);
    try {
      await this.terminationPromise;
    } finally {
      this.terminationPromise = null;
    }
  }

  private async terminateAllInternal(graceMs: number, forceMs: number): Promise<void> {
    for (const process of [...this.processes]) {
      try { process.kill('SIGTERM'); } catch { /* process already exited */ }
    }
    await this.waitForEmpty(graceMs);

    if (this.processes.size > 0) {
      for (const process of [...this.processes]) {
        try { process.kill('SIGKILL'); } catch { /* process already exited */ }
      }
      await this.waitForEmpty(forceMs);
    }
    this.processes.clear();
  }

  private async waitForEmpty(timeoutMs: number): Promise<void> {
    if (this.processes.size === 0) return;
    await new Promise<void>(resolve => {
      const startedAt = Date.now();
      const check = () => {
        if (this.processes.size === 0 || Date.now() - startedAt >= timeoutMs) return resolve();
        setTimeout(check, Math.min(25, Math.max(1, timeoutMs)));
      };
      check();
    });
  }
}
