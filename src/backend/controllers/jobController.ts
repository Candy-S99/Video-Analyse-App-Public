import { Request, Response } from 'express';
import { ApplicationShuttingDownError, InvalidConfigError, JobManager, jobManager } from '../services/jobManager';
import fs from 'fs';
import path from 'path';
import { RetentionService } from '../services/retentionService';
import { safeErrorMessage } from '../services/secretRedactor';

const safeControllerError = (manager: JobManager, error: unknown): string => safeErrorMessage(error, [manager.getSecretStore().getGeminiApiKey() || '']);

const createJobFor = (manager: JobManager) => (req: Request, res: Response) => {
  const { source_url, correlation_id } = req.body;
  
  if (!source_url || typeof source_url !== 'string') {
    return res.status(400).json({ error: 'source_url is required and must be a string' });
  }

  if (manager.isShuttingDown()) {
    return res.status(503).json({ error: { code: 'APPLICATION_SHUTTING_DOWN', message: 'Die Anwendung wird gerade beendet und nimmt keine neuen Analysen an.' } });
  }

  if (!manager.hasGeminiApiKey()) {
    return res.status(409).json({
      error: {
        code: 'GEMINI_API_KEY_REQUIRED',
        message: 'Für die Videoanalyse wird ein Gemini API Key benötigt. Bitte hinterlege ihn unter Einstellungen.',
      },
    });
  }

  try {
    const job = manager.createJob(source_url, correlation_id);
    return res.status(202).json({
      job_id: job.job_id,
      status: job.status,
      created_at: job.created_at
    });
  } catch (error: any) {
    if (error instanceof ApplicationShuttingDownError) {
      return res.status(503).json({ error: { code: 'APPLICATION_SHUTTING_DOWN', message: 'Die Anwendung wird gerade beendet und nimmt keine neuen Analysen an.' } });
    }
    return res.status(500).json({ error: safeControllerError(manager, error) });
  }
};

const getJobStatusFor = (manager: JobManager) => (req: Request, res: Response) => {
  const job_id = req.params.job_id as string;
  const job = manager.getJob(job_id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const segmentsSuccessful = Number.isSafeInteger(job.analysis?.segments_successful) && job.analysis.segments_successful >= 0
    ? job.analysis.segments_successful
    : 0;
  const segmentsFailed = Number.isSafeInteger(job.analysis?.segments_failed) && job.analysis.segments_failed >= 0
    ? job.analysis.segments_failed
    : 0;

  return res.status(200).json({
    job_id: job.job_id,
    status: job.status,
    phase: job.phase,
    progress: {
      ...job.progress,
      segments_successful: segmentsSuccessful,
      segments_failed: segmentsFailed,
    },
    updated_at: new Date().toISOString()
  });
};

export const getJobResult = (req: Request, res: Response) => {
  const job_id = req.params.job_id as string;
  const job = jobManager.getJob(job_id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status === 'QUEUED' || job.status === 'PROCESSING') {
    return res.status(409).json({ 
      error: 'Job is not yet complete', 
      status: job.status 
    });
  }

  return res.status(200).json(job);
};

export const getConfig = (req: Request, res: Response) => {
  return res.status(200).json(jobManager.getConfig());
};

const getConfigFor = (manager: JobManager) => (_req: Request, res: Response) => {
  return res.status(200).json(manager.getConfig());
};

const updateGeminiApiKeyFor = (manager: JobManager) => (req: Request, res: Response) => {
  if (typeof req.body?.api_key !== 'string' || !req.body.api_key.trim()) {
    return res.status(400).json({
      error: {
        code: 'INVALID_API_KEY',
        message: 'api_key must be a non-empty string',
      },
    });
  }
  try {
    return res.status(200).json({ gemini_api_key_configured: manager.setGeminiApiKey(req.body.api_key).gemini_api_key_configured });
  } catch (_error) {
    return res.status(400).json({ error: { code: 'INVALID_API_KEY', message: 'api_key could not be stored' } });
  }
};

export const createJob = createJobFor(jobManager);

const deleteGeminiApiKeyFor = (manager: JobManager) => (_req: Request, res: Response) => {
  manager.deleteGeminiApiKey();
  return res.status(200).json({ gemini_api_key_configured: false });
};

const updateConfigFor = (manager: JobManager) => (req: Request, res: Response) => {
  const body = req.body === undefined ? {} : req.body;

  try {
    return res.status(200).json(manager.updateConfig(body));
  } catch (error) {
    if (error instanceof InvalidConfigError) {
      return res.status(400).json({
        error: {
          code: error.code,
          field: error.field,
          message: error.message,
        },
      });
    }
    throw error;
  }
};

export const createJobController = (manager: JobManager = jobManager) => ({
  createJob: createJobFor(manager),
  getJobStatus: getJobStatusFor(manager),
  getConfig: getConfigFor(manager),
  updateConfig: updateConfigFor(manager),
  updateGeminiApiKey: updateGeminiApiKeyFor(manager),
  deleteGeminiApiKey: deleteGeminiApiKeyFor(manager),
});

export const getJobStatus = getJobStatusFor(jobManager);
export const updateConfig = updateConfigFor(jobManager);
export const updateGeminiApiKey = updateGeminiApiKeyFor(jobManager);
export const deleteGeminiApiKey = deleteGeminiApiKeyFor(jobManager);

export const getJobEvents = (req: Request, res: Response) => {
  const jobId = req.params.job_id as string;
  if (!jobManager.getJob(jobId)) {
    return res.status(404).json({ error: 'Job not found' });
  }
  return res.status(200).json(jobManager.getJobEvents(jobId));
};

export const getAllJobEvents = (req: Request, res: Response) => {
  return res.status(200).json(jobManager.getAllJobEvents());
};

export const getScreenshots = (req: Request, res: Response) => {
  const job = jobManager.getJob(req.params.job_id as string);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const screenshots = job.screenshot_candidates.flatMap(candidate => candidate.screenshots ?? []).sort((a, b) => a.extraction_timestamp_seconds - b.extraction_timestamp_seconds);
  return res.status(200).json(screenshots);
};

export const getScreenshot = (req: Request, res: Response) => {
  const jobId = req.params.job_id as string; const screenshotId = req.params.screenshot_id as string; const job = jobManager.getJob(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const metadata = job.screenshot_candidates.flatMap(candidate => candidate.screenshots ?? []).find(item => item.screenshot_id === screenshotId);
  if (!metadata) return res.status(404).json({ error: 'Screenshot not found' });
  if (metadata.retention_status === 'PURGED') return res.status(410).json({ error: 'SCREENSHOT_PURGED', screenshot: metadata });
  const dataDir = jobManager.getConfig().data_dir; const absolute = path.resolve(dataDir, metadata.relative_path);
  if (!absolute.startsWith(path.resolve(dataDir) + path.sep) || !fs.existsSync(absolute)) return res.status(404).json({ error: 'Screenshot file not found' });
  return res.type('png').sendFile(absolute);
};

export const previewRetention = (_req: Request, res: Response) => res.status(200).json(new RetentionService(jobManager.getConfig().data_dir).preview());
export const cleanupRetention = (req: Request, res: Response) => {
  if (req.body?.confirm !== true) return res.status(409).json({ error: 'confirmation required' });
  return res.status(200).json(new RetentionService(jobManager.getConfig().data_dir).cleanup({ confirm: true }));
};

export const cancelJob = (req: Request, res: Response) => {
  const job_id = req.params.job_id as string;
  const job = jobManager.getJob(job_id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'QUEUED' && job.status !== 'PROCESSING') {
    return res.status(409).json({
      error: 'Job is not active',
      status: job.status,
    });
  }

  try {
    return res.status(200).json(jobManager.cancelJob(job_id));
  } catch (error: any) {
    return res.status(500).json({ error: safeControllerError(jobManager, error) });
  }
};

export const clearHistory = (req: Request, res: Response) => {
  try {
    const deletedCount = jobManager.clearHistory();
    return res.status(200).json({ deleted_count: deletedCount });
  } catch (error: any) {
    return res.status(500).json({ error: safeControllerError(jobManager, error) });
  }
};

export const clearAllLogs = (req: Request, res: Response) => {
  try {
    const deletedCount = jobManager.clearAllLogs();
    return res.status(200).json({ deleted_count: deletedCount });
  } catch (error: any) {
    return res.status(500).json({ error: safeControllerError(jobManager, error) || 'Log-Historie konnte nicht gelöscht werden' });
  }
};

export const listJobs = (req: Request, res: Response) => {
  try {
    const jobs = jobManager.listPersistedJobs()
      .map((job) => {
        const events = jobManager.getJobEvents(job.job_id);
        return {
          job_id: job.job_id,
          status: job.status,
          url: job.source.url,
          title: job.video.title,
          created_at: job.created_at,
          token_usage: events.usage,
          cost_estimate: events.cost,
        };
      });
    return res.json(jobs);
  } catch (e: any) {
    return res.status(500).json({ error: safeControllerError(jobManager, e) });
  }
};
