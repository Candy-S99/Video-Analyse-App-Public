import express, { type Express, type Request, type Response } from 'express';
import path from 'node:path';
import { createServer as createHttpServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import 'dotenv/config';
import jobRoutes from './src/backend/routes/jobRoutes';
import { jobManager } from './src/backend/services/jobManager';
import { ApplicationLifecycle } from './src/backend/services/applicationLifecycle';
import { RuntimeCleanup } from './src/backend/services/runtimeCleanup';
import { isAllowedLocalHost, isAllowedLocalOrigin, isValidShutdownRequest } from './src/backend/services/systemSecurity';
import { safeErrorMessage } from './src/backend/services/secretRedactor';
import { secretStore } from './src/backend/services/secretStore';
import { createServer as createViteServer } from 'vite';

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_HOST = process.env.APP_BIND_HOST || '127.0.0.1';

interface AppOptions {
  shutdownToken: string;
  getLifecycle: () => ApplicationLifecycle;
}

export async function createApp({ shutdownToken, getLifecycle }: AppOptions): Promise<Express> {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/ready', (_req, res) => res.status(200).json({ status: 'ready' }));

  const isLocalRequest = (req: Request): boolean => isAllowedLocalOrigin({
    origin: req.get('origin'),
    host: req.get('host'),
  });

  app.get('/api/v1/video-analysis/system/status', (req, res) => {
    if (!isLocalRequest(req) && !isAllowedLocalHost(req.get('host'))) return res.status(403).json({ error: 'Local origin required' });
    const lifecycle = getLifecycle();
    return res.status(200).json({
      state: lifecycle.state,
      active_jobs: lifecycle.getActiveJobCount(),
      shutdown_token: shutdownToken,
    });
  });

  app.post('/api/v1/video-analysis/system/shutdown', (req, res) => {
    if (!isValidShutdownRequest({
      origin: req.get('origin'),
      host: req.get('host'),
      token: req.get('x-video-analysis-shutdown-token'),
    }, shutdownToken)) {
      return res.status(403).json({ error: 'Local shutdown authorization required' });
    }

    const lifecycle = getLifecycle();
    const activeJobs = lifecycle.getActiveJobCount();
    res.status(202).json({ state: 'SHUTTING_DOWN', active_jobs: activeJobs });
    setImmediate(() => { void lifecycle.shutdown(); });
    return undefined;
  });

  app.use('/api/v1/video-analysis', jobRoutes);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  app.use((err: unknown, req: Request, res: Response, next: (error?: unknown) => void) => {
    const message = safeErrorMessage(err, [secretStore.getGeminiApiKey() || '']);
    console.error(`Server error: ${message}`);
    if (req.originalUrl.startsWith('/api')) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    return next(err);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  return app;
}

export async function startServer({ port = PORT, host = DEFAULT_HOST }: { port?: number; host?: string } = {}): Promise<{ app: Express; server: Server; lifecycle: ApplicationLifecycle; shutdownToken: string }> {
  const shutdownToken = randomBytes(32).toString('hex');
  let lifecycle: ApplicationLifecycle;
  const app = await createApp({ shutdownToken, getLifecycle: () => lifecycle });
  const server = createHttpServer(app);
  lifecycle = new ApplicationLifecycle({
    jobManager,
    processRegistry: jobManager.getProcessRegistry(),
    server,
    cleanupTemporaryFiles: () => new RuntimeCleanup({
      tempDir: process.env.TEMP_DIR || path.join(process.cwd(), 'temp'),
      dataDir: jobManager.getConfig().data_dir,
    }).cleanup(),
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const handleSignal = () => { void lifecycle.shutdown(); };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
  console.log(`Server running on http://localhost:${port}`);
  return { app, server, lifecycle, shutdownToken };
}

if (process.env.NODE_ENV !== 'test' && process.env.VIDEO_ANALYSIS_NO_AUTOSTART !== '1') {
  void startServer().catch(error => {
    console.error(`Server startup failed: ${safeErrorMessage(error, [secretStore.getGeminiApiKey() || ''])}`);
    process.exitCode = 1;
  });
}
