import { Router } from 'express';
import { createJob, getJobStatus, getJobResult, getJobEvents, getAllJobEvents, listJobs, getConfig, updateConfig, updateGeminiApiKey, deleteGeminiApiKey, cancelJob, clearHistory, clearAllLogs, getScreenshots, getScreenshot, previewRetention, cleanupRetention } from '../controllers/jobController';

const router = Router();

router.get('/config', getConfig);
router.put('/config', updateConfig);
router.put('/config/gemini-api-key', updateGeminiApiKey);
router.delete('/config/gemini-api-key', deleteGeminiApiKey);
router.post('/jobs', createJob);
router.get('/jobs', listJobs);
router.delete('/jobs', clearHistory);
router.delete('/jobs/logs', clearAllLogs);
router.get('/jobs/events', getAllJobEvents);
router.get('/jobs/:job_id', getJobStatus);
router.post('/jobs/:job_id/cancel', cancelJob);
router.get('/jobs/:job_id/events', getJobEvents);
router.get('/jobs/:job_id/screenshots', getScreenshots);
router.get('/jobs/:job_id/screenshots/:screenshot_id', getScreenshot);
router.get('/jobs/:job_id/result', getJobResult);
router.get('/retention/preview', previewRetention);
router.post('/retention/cleanup', cleanupRetention);

export default router;
