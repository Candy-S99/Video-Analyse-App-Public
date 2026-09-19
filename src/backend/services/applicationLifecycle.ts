import type { Server } from 'node:http';
import type { JobManager } from './jobManager';
import type { ProcessRegistry } from './processRegistry';

export type ApplicationLifecycleState = 'RUNNING' | 'SHUTTING_DOWN' | 'STOPPED';

export interface ApplicationLifecycleOptions {
  jobManager: Pick<JobManager, 'shutdown' | 'getActiveJobCount'>;
  processRegistry: Pick<ProcessRegistry, 'terminateAll'>;
  server?: Pick<Server, 'close'> & { closeIdleConnections?: () => void; closeAllConnections?: () => void };
  cleanupTemporaryFiles?: () => Promise<void>;
  shutdownTimeoutMs?: number;
  processGraceMs?: number;
  processForceMs?: number;
  forceExitMs?: number;
  exit?: (code: number) => void;
}
export class ApplicationLifecycle {
  public state: ApplicationLifecycleState = 'RUNNING';
  private readonly jobManager: ApplicationLifecycleOptions['jobManager'];
  private readonly processRegistry: ApplicationLifecycleOptions['processRegistry'];
  private readonly server?: ApplicationLifecycleOptions['server'];
  private readonly cleanupTemporaryFiles: () => Promise<void>;
  private readonly shutdownTimeoutMs: number;
  private readonly processGraceMs: number;
  private readonly processForceMs: number;
  private readonly forceExitMs: number;
  private readonly exit: (code: number) => void;
  private shutdownPromise: Promise<void> | null = null;

  constructor({
    jobManager,
    processRegistry,
    server,
    cleanupTemporaryFiles = async () => {},
    shutdownTimeoutMs = 10000,
    processGraceMs = 5000,
    processForceMs = 1000,
    forceExitMs = 15000,
    exit = code => process.exit(code),
  }: ApplicationLifecycleOptions) {
    this.jobManager = jobManager;
    this.processRegistry = processRegistry;
    this.server = server;
    this.cleanupTemporaryFiles = cleanupTemporaryFiles;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.processGraceMs = processGraceMs;
    this.processForceMs = processForceMs;
    this.forceExitMs = forceExitMs;
    this.exit = exit;
  }

  public getActiveJobCount(): number {
    return this.jobManager.getActiveJobCount();
  }

  public shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.state = 'SHUTTING_DOWN';
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    let forced = false;
    const forceTimer = setTimeout(() => {
      forced = true;
      this.state = 'STOPPED';
      this.exit(1);
    }, this.forceExitMs);
    forceTimer.unref?.();

    try {
      const jobs = this.jobManager.shutdown({ timeoutMs: this.shutdownTimeoutMs });
      const processes = this.processRegistry.terminateAll({ graceMs: this.processGraceMs, forceMs: this.processForceMs });
      await jobs;
      await processes;
      await this.cleanupTemporaryFiles();
      await this.closeServer();
      if (!forced) {
        this.state = 'STOPPED';
        this.exit(0);
      }
    } finally {
      clearTimeout(forceTimer);
    }
  }

  private async closeServer(): Promise<void> {
    if (!this.server) return;
    this.server.closeIdleConnections?.();
    await new Promise<void>(resolve => {
      try {
        this.server!.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}
