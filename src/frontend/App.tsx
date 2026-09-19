import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Video, 
  Settings as SettingsIcon, 
  Sun, 
  Moon, 
  Camera, 
  FileText, 
  Code2, 
  Copy, 
  Check,
  RefreshCw,
  ExternalLink,
  Layers,
  Trash2,
  XCircle,
  Maximize2,
  Power
} from 'lucide-react';
import { JobResult, JobStatus, AppConfig, JobEventsResponse, JobOutputArtifact, JobOutputListing, OutputMode } from '../shared/types';
import { SettingsModal } from './components/SettingsModal';
import { TranscriptView } from './components/TranscriptView';
import { ScreenshotCandidatesView } from './components/ScreenshotCandidatesView';
import { JobEventLog } from './components/JobEventLog';
import { DetailFullscreenDialog } from './components/DetailFullscreenDialog';
import { QuickConfigDialog, type QuickConfigPanel } from './components/QuickConfigDialog';
import { OutputArtifactsDialog } from './components/OutputArtifactsDialog';

async function safeFetchJson<T = any>(url: string, options?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      const json = await res.json();
      if (!res.ok) {
        const rawError = json?.error;
        const message = typeof rawError === 'string'
          ? rawError
          : rawError && typeof rawError === 'object' && typeof rawError.message === 'string'
            ? rawError.message
            : rawError && typeof rawError === 'object' && typeof rawError.code === 'string'
              ? rawError.code
              : `Fehler (${res.status})`;
        return { ok: false, error: message };
      }
      return { ok: true, data: json };
    } else {
      if (!res.ok) {
        return { ok: false, error: `Server antwortete mit Status ${res.status}` };
      }
      return { ok: false, error: 'Server lieferte HTML statt JSON' };
    }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Netzwerkfehler' };
  }
}

const emptyEventsResponse = (): JobEventsResponse => ({
  events: [],
  usage: { prompt_tokens: 0, candidate_tokens: 0, total_tokens: 0, reported_requests: 0 },
  cost: { input_usd: 0, output_usd: 0, estimated_usd: 0, priced_requests: 0, currency: 'USD' },
});

function formatEstimatedCost(cost?: { estimated_usd?: number; priced_requests?: number }): string {
  if (!cost || typeof cost.estimated_usd !== 'number' || !cost.priced_requests) return '–';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(cost.estimated_usd);
}

const TERMINAL_JOB_STATUSES: JobStatus[] = ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'];

function isTerminalJobStatus(status: unknown): status is JobStatus {
  return typeof status === 'string' && TERMINAL_JOB_STATUSES.includes(status as JobStatus);
}

export default function App() {
  const [url, setUrl] = useState('');
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [quickConfigPanel, setQuickConfigPanel] = useState<QuickConfigPanel | null>(null);
  const [outputMode, setOutputMode] = useState<OutputMode>('both');
  const [activeTab, setActiveTab] = useState<'screenshots' | 'transcript' | 'json'>('screenshots');
  const [copiedJson, setCopiedJson] = useState(false);
  const [actionJobId, setActionJobId] = useState<string | null>(null);
  const [isClearHistoryOpen, setIsClearHistoryOpen] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [isClearLogsOpen, setIsClearLogsOpen] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [jobEvents, setJobEvents] = useState<JobEventsResponse>(emptyEventsResponse);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [globalEvents, setGlobalEvents] = useState<JobEventsResponse>(emptyEventsResponse);
  const [globalEventsLoading, setGlobalEventsLoading] = useState(false);
  const [fullscreenView, setFullscreenView] = useState<'screenshots' | 'transcript' | 'json' | 'events' | null>(null);
  const [fullscreenEventScope, setFullscreenEventScope] = useState<'job' | 'global'>('job');
  const [shutdownToken, setShutdownToken] = useState('');
  const [shutdownState, setShutdownState] = useState<'RUNNING' | 'SHUTTING_DOWN' | 'STOPPED'>('RUNNING');
  const [shutdownActiveJobs, setShutdownActiveJobs] = useState(0);
  const [isShutdownDialogOpen, setIsShutdownDialogOpen] = useState(false);
  const [openOutputJobId, setOpenOutputJobId] = useState<string | null>(null);
  const [outputListing, setOutputListing] = useState<JobOutputListing | null>(null);
  const [outputLoading, setOutputLoading] = useState(false);
  const [outputError, setOutputError] = useState('');
  const [selectedOutputArtifact, setSelectedOutputArtifact] = useState<JobOutputArtifact | null>(null);
  const [outputPreviewText, setOutputPreviewText] = useState('');
  const [outputPreviewLoading, setOutputPreviewLoading] = useState(false);
  const [selectedOutputPaths, setSelectedOutputPaths] = useState<Set<string>>(new Set());
  const [archiveDownloading, setArchiveDownloading] = useState(false);
  
  // Theme Management (Dark Mode)
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) return saved === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  const toggleDarkMode = () => {
    setIsDark(prev => !prev);
  };

  const fetchConfig = async () => {
    const res = await safeFetchJson<AppConfig>('/api/v1/video-analysis/config');
    if (res.ok && res.data) {
      setConfig(res.data);
    }
  };

  const fetchSystemStatus = async () => {
    const res = await safeFetchJson<{ state: 'RUNNING' | 'SHUTTING_DOWN' | 'STOPPED'; active_jobs: number; shutdown_token: string }>('/api/v1/video-analysis/system/status');
    if (res.ok && res.data) {
      setShutdownToken(res.data.shutdown_token);
      setShutdownState(res.data.state);
      setShutdownActiveJobs(res.data.active_jobs);
    }
  };

  const saveConfig = async (newConfig: Partial<AppConfig>): Promise<boolean> => {
    const res = await safeFetchJson<AppConfig>('/api/v1/video-analysis/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    });
    if (res.ok && res.data) {
      setConfig(res.data);
      return true;
    }
    return false;
  };

  const saveQuickConfig = async (newConfig: Partial<AppConfig>): Promise<boolean> => {
    setError('');
    const success = await saveConfig(newConfig);
    if (!success) setError('Schnelleinstellung konnte nicht gespeichert werden.');
    return success;
  };

  const saveApiKey = async (apiKey: string): Promise<boolean> => {
    const res = await safeFetchJson<{ gemini_api_key_configured: boolean }>('/api/v1/video-analysis/config/gemini-api-key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (res.ok) {
      await fetchConfig();
      return true;
    }
    setError(res.error || 'API Key konnte nicht gespeichert werden');
    return false;
  };

  const deleteApiKey = async (): Promise<boolean> => {
    const res = await safeFetchJson<{ gemini_api_key_configured: boolean }>('/api/v1/video-analysis/config/gemini-api-key', { method: 'DELETE' });
    if (res.ok) {
      await fetchConfig();
      return true;
    }
    setError(res.error || 'API Key konnte nicht entfernt werden');
    return false;
  };

  const fetchJobs = async () => {
    const res = await safeFetchJson<any[]>('/api/v1/video-analysis/jobs');
    if (res.ok && res.data) {
      setJobs(res.data);
    }
  };

  const outputArtifactUrl = (jobId: string, relativePath: string, download = false) => {
    const query = new URLSearchParams({ path: relativePath });
    if (download) query.set('download', 'true');
    return `/api/v1/video-analysis/jobs/${encodeURIComponent(jobId)}/output/file?${query.toString()}`;
  };

  const saveBlobLocally = async (blob: Blob, suggestedName: string, mimeType: string): Promise<void> => {
    const picker = (window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string;
        types?: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<{ createWritable: () => Promise<{ write: (value: Blob) => Promise<void>; close: () => Promise<void> }> }>;
    }).showSaveFilePicker;

    if (picker) {
      try {
        const extension = suggestedName.includes('.') ? `.${suggestedName.split('.').pop()}` : undefined;
        const handle = await picker({
          suggestedName,
          ...(extension ? { types: [{ description: mimeType === 'application/zip' ? 'ZIP-Archiv' : 'Output-Datei', accept: { [mimeType]: [extension] } }] } : {}),
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (pickerError: any) {
        if (pickerError?.name === 'AbortError') return;
        throw pickerError;
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = suggestedName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  };

  const handleOpenOutput = async (job: { job_id: string; status: JobStatus; title?: string }) => {
    if (!isTerminalJobStatus(job.status)) return;
    setOpenOutputJobId(job.job_id);
    setOutputListing(null);
    setSelectedOutputArtifact(null);
    setOutputPreviewText('');
    setOutputPreviewLoading(false);
    setSelectedOutputPaths(new Set());
    setOutputError('');
    setOutputLoading(true);
    const res = await safeFetchJson<JobOutputListing>(`/api/v1/video-analysis/jobs/${encodeURIComponent(job.job_id)}/output`);
    if (res.ok && res.data) {
      setOutputListing(res.data);
    } else {
      setOutputError(res.error || 'Output konnte nicht geladen werden');
    }
    setOutputLoading(false);
  };

  const handleSelectOutputArtifact = async (artifact: JobOutputArtifact) => {
    if (!openOutputJobId) return;
    setSelectedOutputArtifact(artifact);
    setOutputPreviewText('');
    if (artifact.preview_kind !== 'text') {
      setOutputPreviewLoading(false);
      return;
    }
    setOutputPreviewLoading(true);
    try {
      const response = await fetch(outputArtifactUrl(openOutputJobId, artifact.relative_path));
      if (!response.ok) throw new Error(`Server antwortete mit Status ${response.status}`);
      setOutputPreviewText(await response.text());
    } catch (err: any) {
      setOutputPreviewText(`Vorschau konnte nicht geladen werden: ${err?.message || 'Unbekannter Fehler'}`);
    } finally {
      setOutputPreviewLoading(false);
    }
  };

  const toggleOutputArtifact = (artifact: JobOutputArtifact) => {
    setSelectedOutputPaths(previous => {
      const next = new Set(previous);
      if (next.has(artifact.relative_path)) next.delete(artifact.relative_path);
      else next.add(artifact.relative_path);
      return next;
    });
  };

  const selectAllOutputArtifacts = () => {
    setSelectedOutputPaths(new Set(outputListing?.artifacts.map(artifact => artifact.relative_path) ?? []));
  };

  const clearOutputSelection = () => setSelectedOutputPaths(new Set());

  const downloadOutputArtifact = async (artifact: JobOutputArtifact) => {
    if (!openOutputJobId) return;
    setOutputError('');
    try {
      const response = await fetch(outputArtifactUrl(openOutputJobId, artifact.relative_path, true));
      if (!response.ok) throw new Error(`Server antwortete mit Status ${response.status}`);
      const blob = await response.blob();
      await saveBlobLocally(blob, artifact.file_name, artifact.mime_type);
    } catch (downloadError: any) {
      setOutputError(`Download fehlgeschlagen: ${downloadError?.message || 'Unbekannter Fehler'}`);
    }
  };

  const downloadSelectedOutputArtifacts = async () => {
    if (!openOutputJobId || selectedOutputPaths.size === 0 || archiveDownloading) return;
    setArchiveDownloading(true);
    setOutputError('');
    try {
      const response = await fetch(`/api/v1/video-analysis/jobs/${encodeURIComponent(openOutputJobId)}/output/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: Array.from(selectedOutputPaths) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined);
        const message = body?.error?.message || body?.error || `Server antwortete mit Status ${response.status}`;
        throw new Error(message);
      }
      const blob = await response.blob();
      await saveBlobLocally(blob, `${openOutputJobId}-output.zip`, 'application/zip');
    } catch (downloadError: any) {
      setOutputError(`Sammeldownload fehlgeschlagen: ${downloadError?.message || 'Unbekannter Fehler'}`);
    } finally {
      setArchiveDownloading(false);
    }
  };

  const closeOutputDialog = () => {
    setOpenOutputJobId(null);
    setOutputListing(null);
    setSelectedOutputArtifact(null);
    setOutputPreviewText('');
    setOutputPreviewLoading(false);
    setSelectedOutputPaths(new Set());
    setOutputError('');
  };

  useEffect(() => {
    void fetchConfig();
    void fetchJobs();
    void fetchGlobalEvents();
    void fetchSystemStatus();
  }, []);

  // Poll active selected job if it is processing or queued
  useEffect(() => {
    if (!selectedJob || shutdownState !== 'RUNNING') return;
    if (selectedJob.status === 'QUEUED' || selectedJob.status === 'PROCESSING') {
      const pollTimer = setInterval(() => {
        loadJobResult(selectedJob.job_id);
      }, 3000);
      return () => clearInterval(pollTimer);
    }
  }, [selectedJob?.status, selectedJob?.job_id, shutdownState]);

  const handleShutdownConfirm = async () => {
    setIsShutdownDialogOpen(false);
    setShutdownState('SHUTTING_DOWN');
    setError('');
    const res = await safeFetchJson<{ state: 'SHUTTING_DOWN'; active_jobs: number }>('/api/v1/video-analysis/system/shutdown', {
      method: 'POST',
      headers: { 'X-Video-Analysis-Shutdown-Token': shutdownToken },
    });
    if (!res.ok) {
      setShutdownState('RUNNING');
      setError(res.error || 'Anwendung konnte nicht beendet werden');
      return;
    }
    setShutdownActiveJobs(res.data?.active_jobs ?? 0);
    window.setTimeout(() => {
      window.close();
      setShutdownState('STOPPED');
    }, 700);
  };

  const handleStartJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setLoading(true);
    setError('');
    
    const res = await safeFetchJson<{ job_id: string; status: string }>('/api/v1/video-analysis/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_url: url, output_mode: outputMode })
    });

    setLoading(false);

    if (!res.ok) {
      setError(res.error || 'Job konnte nicht gestartet werden');
      return;
    }

    setUrl('');
    await fetchJobs();
    if (res.data?.job_id) {
      loadJobResult(res.data.job_id);
    }
  };

  const loadJobResult = async (jobId: string) => {
    const previousStatus = selectedJob?.job_id === jobId ? selectedJob.status : undefined;
    const refreshOverviewAfterTerminalStatus = (nextStatus?: string) => {
      const wasActive = previousStatus === 'QUEUED' || previousStatus === 'PROCESSING';
      const isTerminal = nextStatus === 'COMPLETED' || nextStatus === 'PARTIAL' || nextStatus === 'FAILED' || nextStatus === 'CANCELLED';
      if (wasActive && isTerminal) {
        void Promise.all([fetchJobs(), fetchGlobalEvents()]);
      }
    };
    const res = await safeFetchJson<JobResult>(`/api/v1/video-analysis/jobs/${jobId}/result`);
    if (res.ok && res.data) {
      setSelectedJob(res.data);
      refreshOverviewAfterTerminalStatus(res.data.status);
    } else {
      const statusRes = await safeFetchJson<JobResult>(`/api/v1/video-analysis/jobs/${jobId}`);
      if (statusRes.ok && statusRes.data) {
        setSelectedJob(statusRes.data);
        refreshOverviewAfterTerminalStatus(statusRes.data.status);
      }
    }
  };

  const handleCopyJobJson = () => {
    if (!selectedJob) return;
    navigator.clipboard.writeText(JSON.stringify(selectedJob, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const fetchJobEvents = async (jobId: string) => {
    setEventsLoading(true);
    const res = await safeFetchJson<JobEventsResponse>(`/api/v1/video-analysis/jobs/${jobId}/events`);
    if (res.ok && res.data) {
      setJobEvents(res.data);
    } else {
      setJobEvents(emptyEventsResponse());
    }
    setEventsLoading(false);
  };

  const fetchGlobalEvents = async () => {
    setGlobalEventsLoading(true);
    const res = await safeFetchJson<JobEventsResponse>('/api/v1/video-analysis/jobs/events');
    if (res.ok && res.data) {
      setGlobalEvents(res.data);
    } else {
      setGlobalEvents(emptyEventsResponse());
    }
    setGlobalEventsLoading(false);
  };

  useEffect(() => {
    if (selectedJob?.job_id) {
      void fetchJobEvents(selectedJob.job_id);
    } else {
      setJobEvents(emptyEventsResponse());
    }
  }, [selectedJob?.job_id]);

  const handleCancelJob = async (jobId: string) => {
    setActionJobId(jobId);
    setError('');

    const res = await safeFetchJson<JobResult>(`/api/v1/video-analysis/jobs/${jobId}/cancel`, {
      method: 'POST',
    });

    if (!res.ok) {
      setError(res.error || 'Job konnte nicht abgebrochen werden');
    } else if (res.data) {
      if (selectedJob?.job_id === jobId) {
        setSelectedJob(res.data);
      }
      await fetchJobs();
      await fetchJobEvents(jobId);
      await fetchGlobalEvents();
    }

    setActionJobId(null);
  };

  const handleClearHistoryConfirm = async () => {
    setClearingHistory(true);
    setError('');

    const res = await safeFetchJson<{ deleted_count: number }>('/api/v1/video-analysis/jobs', {
      method: 'DELETE',
    });

    if (!res.ok) {
      setError(res.error || 'Historie konnte nicht gelöscht werden');
    } else {
      setJobs([]);
      setSelectedJob(null);
      await fetchGlobalEvents();
      setIsClearHistoryOpen(false);
    }

    setClearingHistory(false);
  };

  const handleClearLogsConfirm = async () => {
    setClearingLogs(true);
    setError('');

    const res = await safeFetchJson<{ deleted_count: number }>('/api/v1/video-analysis/jobs/logs', {
      method: 'DELETE',
    });

    if (!res.ok) {
      setError(res.error || 'Log-Historie konnte nicht gelöscht werden');
    } else {
      setGlobalEvents(emptyEventsResponse());
      setJobEvents(emptyEventsResponse());
      setJobs(currentJobs => currentJobs.map(job => ({
        ...job,
        token_usage: { prompt_tokens: 0, candidate_tokens: 0, total_tokens: 0, reported_requests: 0 },
        cost_estimate: { input_usd: 0, output_usd: 0, estimated_usd: 0, priced_requests: 0, currency: 'USD' },
      })));
      setIsClearLogsOpen(false);
    }

    setClearingLogs(false);
  };

  const getStatusColor = (status: JobStatus) => {
    switch (status) {
      case 'COMPLETED': return 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800';
      case 'PROCESSING': return 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800';
      case 'QUEUED': return 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800';
      case 'FAILED': return 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800';
      case 'PARTIAL': return 'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/60 border-orange-200 dark:border-orange-800';
      case 'CANCELLED': return 'text-stone-700 dark:text-stone-300 bg-stone-100 dark:bg-stone-800 border-stone-300 dark:border-stone-700';
      default: return 'text-stone-700 dark:text-stone-300 bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700';
    }
  };

  const renderActiveDetailContent = (fullscreen = false) => {
    if (!selectedJob) return null;
    if (activeTab === 'screenshots') {
      return <ScreenshotCandidatesView candidates={selectedJob.screenshot_candidates} />;
    }
    if (activeTab === 'transcript') {
      return <TranscriptView transcript={selectedJob.transcript} />;
    }
    return (
      <div className="space-y-3 h-full flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shrink-0">
          <div className="text-xs text-stone-600 dark:text-stone-400">Vollständiges n8n REST-API Schema (inkl. Transkript & Screenshot-Kandidaten)</div>
          <button type="button" onClick={handleCopyJobJson} className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-medium border border-indigo-200 dark:border-indigo-800/60 flex items-center gap-1.5 transition-colors">
            {copiedJson ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedJson ? 'Kopiert!' : 'Gesamtes JSON kopieren'}
          </button>
        </div>
        <pre className={`p-4 bg-stone-900 text-stone-100 rounded-xl text-xs font-mono overflow-auto border border-stone-800 leading-relaxed ${fullscreen ? 'min-h-[60vh]' : 'flex-1 min-h-0'}`}>
          {JSON.stringify(selectedJob, null, 2)}
        </pre>
      </div>
    );
  };

  if (shutdownState === 'STOPPED') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-stone-950 text-stone-100 p-6">
        <section className="max-w-md text-center space-y-3">
          <Power className="w-10 h-10 mx-auto text-emerald-400" />
          <h1 className="text-xl font-semibold">Anwendung wurde beendet</h1>
          <p className="text-sm text-stone-400">Der lokale Server und alle laufenden Verarbeitungen wurden beendet. Dieses Browserfenster kann geschlossen werden.</p>
        </section>
      </main>
    );
  }

  if (shutdownState === 'SHUTTING_DOWN') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-stone-950 text-stone-100 p-6">
        <section className="max-w-md text-center space-y-3" role="status" aria-live="polite">
          <Power className="w-10 h-10 mx-auto text-amber-400 animate-pulse" />
          <h1 className="text-xl font-semibold">Anwendung wird beendet …</h1>
          <p className="text-sm text-stone-400">Laufende Analysen, Prozesse und der lokale Server werden kontrolliert beendet.</p>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 p-4 sm:p-6 transition-colors font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Main Header */}
        <header className="bg-white dark:bg-stone-900 p-5 sm:p-6 rounded-2xl shadow-xs border border-stone-200 dark:border-stone-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
                <Video className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                  Video Analysis & Transcript Service
                </h1>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Gemini-gestützte visuelle Screenshot-Analyse & vollständige Transkript-Extraktion für n8n
                </p>
              </div>
            </div>

            {/* Quick Controls & Status */}
            <div className="flex items-center gap-2 flex-wrap">
              {config && (
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    id="quick-model-btn"
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={quickConfigPanel === 'model'}
                    onClick={() => setQuickConfigPanel('model')}
                    className="rounded-lg border border-stone-200 bg-stone-100 px-2.5 py-1 font-mono text-stone-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300"
                  >
                    <strong>{config.model}</strong>
                  </button>
                  <button
                    id="quick-segment-btn"
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={quickConfigPanel === 'segment'}
                    onClick={() => setQuickConfigPanel('segment')}
                    className="rounded-lg border border-stone-200 bg-stone-100 px-2 py-1 text-stone-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300"
                  >
                    {config.segment_length_seconds}s Segmente
                  </button>
                </div>
              )}

              <div id="output-mode-selector" className="flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-100 p-1 dark:border-stone-700 dark:bg-stone-800" aria-label="Ausgabemodus">
                {([['transcript', 'Nur Transkript'], ['screenshots', 'Nur Screenshots'], ['both', 'Beides']] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    id={`output-mode-${mode}`}
                    type="button"
                    aria-pressed={outputMode === mode}
                    onClick={() => setOutputMode(mode)}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${outputMode === mode ? 'bg-white text-indigo-700 shadow-sm dark:bg-stone-700 dark:text-indigo-300' : 'text-stone-600 hover:bg-white/70 dark:text-stone-400 dark:hover:bg-stone-700/70'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Dark Mode Switch Button */}
              <button
                id="dark-mode-toggle-btn"
                type="button"
                onClick={toggleDarkMode}
                title={isDark ? 'Zum Hell-Modus wechseln' : 'Zum Dunkel-Modus wechseln'}
                className="p-2 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 transition-colors flex items-center gap-1.5 text-xs font-medium"
              >
                {isDark ? (
                  <>
                    <Sun className="w-4 h-4 text-amber-400" />
                    <span className="hidden sm:inline">Hell</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-4 h-4 text-indigo-600" />
                    <span className="hidden sm:inline">Dunkel</span>
                  </>
                )}
              </button>

              {/* Settings Button (Zahnrad) */}
              <button
                id="settings-open-btn"
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                title="Service-Einstellungen öffnen"
                className="p-2 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 transition-colors flex items-center gap-1.5 text-xs font-medium"
              >
                <SettingsIcon className="w-4 h-4 text-stone-600 dark:text-stone-300" />
                <span className="hidden sm:inline">Einstellungen</span>
              </button>

              <button
                id="shutdown-app-btn"
                type="button"
                onClick={() => setIsShutdownDialogOpen(true)}
                disabled={shutdownState !== 'RUNNING'}
                title="Lokale Anwendung vollständig beenden"
                className="p-2 rounded-xl border border-red-300 dark:border-red-900/80 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/60 text-red-700 dark:text-red-300 transition-colors flex items-center gap-1.5 text-xs font-medium disabled:opacity-50"
              >
                <Power className="w-4 h-4" />
                <span className="hidden sm:inline">App beenden</span>
              </button>
            </div>
          </div>

          {/* Video URL Form */}
          <form onSubmit={handleStartJob} className="flex flex-col sm:flex-row gap-2.5">
            <input
              id="youtube-url-input"
              type="url"
              required
              placeholder="https://www.youtube.com/watch?v=..."
              className="flex-1 px-4 py-2.5 bg-stone-50 dark:bg-stone-800/80 border border-stone-200 dark:border-stone-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-stone-900 transition-all text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-500"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              id="start-analysis-btn"
              type="submit"
              disabled={loading || !url || shutdownState !== 'RUNNING'}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition-colors shadow-xs"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Video analysieren
            </button>
          </form>
          {error && (
            <div className="mt-3 p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </header>

        {/* Workspace Layout: Job List above Job Details */}
        <div className="space-y-6">
          
          {/* Recent Jobs List */}
          <div id="jobs-history-section" className="bg-white dark:bg-stone-900 rounded-2xl shadow-xs border border-stone-200 dark:border-stone-800 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-stone-100 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 flex items-center justify-between">
              <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-stone-500" />
                Letzte Analyse-Jobs
              </h2>
              <div className="flex items-center gap-2">
                <button
                  id="clear-history-btn"
                  type="button"
                  onClick={() => setIsClearHistoryOpen(true)}
                  disabled={jobs.length === 0 || clearingHistory}
                  title="Gesamte Job-Historie löschen"
                  className="px-2.5 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg border border-red-200 dark:border-red-900/70 transition-colors flex items-center gap-1.5 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Historie löschen</span>
                </button>
                <button
                  type="button"
                  onClick={fetchJobs}
                  title="Aktualisieren"
                  className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-md transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            
            <div className="max-h-[520px] overflow-y-auto p-2 space-y-1.5">
              {jobs.map((job) => {
                const isSelected = selectedJob?.job_id === job.job_id;
                const isActive = job.status === 'QUEUED' || job.status === 'PROCESSING';
                return (
                  <div
                    key={job.job_id}
                    className={`w-full rounded-xl transition-all flex items-stretch gap-2 border ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30 shadow-xs'
                        : 'border-transparent hover:bg-stone-50 dark:hover:bg-stone-800/50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => loadJobResult(job.job_id)}
                      className="flex-1 min-w-0 text-left p-3 rounded-xl transition-all flex items-start gap-3"
                    >
                      <div className={`mt-0.5 p-1.5 rounded-lg border ${getStatusColor(job.status)}`}>
                        {job.status === 'COMPLETED' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                         job.status === 'PROCESSING' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                         job.status === 'FAILED' ? <AlertCircle className="w-3.5 h-3.5" /> :
                         job.status === 'CANCELLED' ? <XCircle className="w-3.5 h-3.5" /> :
                         <Clock className="w-3.5 h-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                          {job.title || job.url}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-semibold uppercase tracking-wider border ${getStatusColor(job.status)}`}>
                            {job.status}
                          </span>
                          <span className="text-[10px] text-stone-400 dark:text-stone-500 font-mono">
                            {new Date(job.created_at).toLocaleTimeString()}
                          </span>
                          {job.screenshot_candidates_count !== undefined && (
                            <span className="text-[10px] text-stone-500 dark:text-stone-400 font-medium">
                              • {job.screenshot_candidates_count} Shots
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 pr-2">
                      <button
                        id={`open-output-${job.job_id}`}
                        type="button"
                        onClick={() => void handleOpenOutput(job)}
                        disabled={!isTerminalJobStatus(job.status)}
                        title={isTerminalJobStatus(job.status) ? 'Output-Artefakte im Browser ansehen' : 'Output steht erst nach Abschluss der Analyse zur Verfügung'}
                        aria-label={`Output von ${job.title || job.job_id} im Browser ansehen`}
                        className="px-2.5 py-2 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-lg border border-indigo-200 dark:border-indigo-800/70 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 text-xs font-semibold"
                      >
                        <Layers className="w-4 h-4" />
                        <span className="hidden xl:inline">Output</span>
                      </button>
                      <div
                        id={`token-usage-${job.job_id}`}
                        aria-label={`Token gesamt: ${job.token_usage?.total_tokens ? Number(job.token_usage.total_tokens).toLocaleString('de-DE') : 'nicht gemeldet'}`}
                        title="Gemeldete Gemini-Token für diesen Job"
                        className="hidden sm:flex min-w-[104px] flex-col justify-center px-3 py-2 mr-1 rounded-xl border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/70 dark:bg-indigo-950/35"
                      >
                        <span className="text-[10px] font-medium text-indigo-700/80 dark:text-indigo-300/80">Token gesamt</span>
                        <span className="mt-0.5 text-lg leading-none font-semibold tracking-tight text-indigo-800 dark:text-indigo-200">
                          {job.token_usage?.total_tokens ? Number(job.token_usage.total_tokens).toLocaleString('de-DE') : '–'}
                        </span>
                      </div>
                      <div
                        id={`cost-estimate-${job.job_id}`}
                        aria-label={`Kostenschätzung: ${formatEstimatedCost(job.cost_estimate)}`}
                        title="Geschätzte Gemini-Kosten auf Basis der gemeldeten Token"
                        className="hidden sm:flex min-w-[118px] flex-col justify-center px-3 py-2 mr-1 rounded-xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/70 dark:bg-emerald-950/25"
                      >
                        <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">Kostenschätzung</span>
                        <span className="mt-0.5 text-lg leading-none font-semibold tracking-tight text-emerald-700 dark:text-emerald-300">
                          {formatEstimatedCost(job.cost_estimate)}
                        </span>
                      </div>
                      <a
                        id={`open-youtube-${job.job_id}`}
                        href={job.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        title="Originalvideo auf YouTube öffnen"
                        aria-label="Originalvideo auf YouTube öffnen"
                        className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      {isActive && (
                        <button
                          id={`cancel-${job.job_id}`}
                          type="button"
                          onClick={() => handleCancelJob(job.job_id)}
                          disabled={actionJobId === job.job_id}
                          title="Lauf abbrechen"
                          aria-label="Lauf abbrechen"
                          className="min-w-[108px] px-3 py-2 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/60 rounded-lg border border-amber-200 dark:border-amber-800/70 transition-colors disabled:opacity-50 disabled:cursor-wait flex items-center justify-center gap-1.5 text-xs font-semibold"
                        >
                          {actionJobId === job.job_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                          <span>Abbrechen</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {jobs.length === 0 && (
                <div className="flex flex-col items-center justify-center p-8 text-center text-stone-400 dark:text-stone-500">
                  <Video className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-xs font-medium">Noch keine Jobs vorhanden</p>
                  <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-0.5">
                    Füge oben eine YouTube-URL ein, um zu starten.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Detailed Job View */}
          <div id="job-details-section" className="bg-white dark:bg-stone-900 rounded-2xl shadow-xs border border-stone-200 dark:border-stone-800 min-h-[640px] lg:h-[680px] flex flex-col overflow-hidden">
            {selectedJob ? (
              <>
                {/* Job Detail Header */}
                <div className="p-4 border-b border-stone-100 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider border ${getStatusColor(selectedJob.status)}`}>
                        {selectedJob.status}
                      </span>
                      <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100 truncate">
                        {selectedJob.video?.title || 'YouTube Video'}
                      </h2>
                    </div>
                    <div className="text-[11px] text-stone-500 dark:text-stone-400 font-mono mt-0.5 flex items-center gap-2">
                      <span>ID: {selectedJob.job_id.slice(0, 8)}...</span>
                      {selectedJob.source?.url && (
                        <a
                          href={selectedJob.source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-0.5"
                        >
                          YouTube <ExternalLink className="w-3 h-3 inline" />
                        </a>
                      )}
                      {selectedJob.analysis?.model && (
                        <span>• Modell: {selectedJob.analysis.model}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {/* Navigation Tabs */}
                  <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700/60">
                    <button
                      type="button"
                      onClick={() => setActiveTab('screenshots')}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                        activeTab === 'screenshots'
                          ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-xs'
                          : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
                      }`}
                    >
                      <Camera className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Screenshots ({selectedJob.screenshot_candidates?.length || 0})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('transcript')}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                        activeTab === 'transcript'
                          ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-xs'
                          : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Transkript</span>
                      {selectedJob.transcript?.segments && selectedJob.transcript.segments.length > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('json')}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                        activeTab === 'json'
                          ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-xs'
                          : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
                      }`}
                    >
                      <Code2 className="w-3.5 h-3.5 text-indigo-500" />
                      <span>JSON (n8n)</span>
                    </button>
                  </div>
                    <button id="open-fullscreen-detail-btn" type="button" onClick={() => setFullscreenView(activeTab)} className="p-2 rounded-lg border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-800" title="Aktuellen Bereich groß anzeigen" aria-label="Aktuellen Bereich groß anzeigen">
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Tab Content Area */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 bg-stone-50/40 dark:bg-stone-950/20">
                  {renderActiveDetailContent()}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-stone-400 dark:text-stone-500">
                <Video className="w-12 h-12 mb-3 text-stone-300 dark:text-stone-700" />
                <p className="text-sm font-medium text-stone-600 dark:text-stone-300">Wähle einen Job aus</p>
                <p className="text-xs text-stone-400 dark:text-stone-500 mt-1 max-w-sm">
                  Klicke in der linken Liste auf einen Analyse-Job, um Screenshots, das vollständige Transkript oder das JSON-Schema für n8n anzuzeigen.
                </p>
              </div>
            )}
          </div>
          {selectedJob && <JobEventLog events={jobEvents.events} usage={jobEvents.usage} cost={jobEvents.cost} loading={eventsLoading} onOpenFullscreen={() => { setFullscreenEventScope('job'); setFullscreenView('events'); }} scope="job" />}
        </div>
        <JobEventLog
          events={globalEvents.events}
          usage={globalEvents.usage}
          cost={globalEvents.cost}
          loading={globalEventsLoading}
          scope="global"
          onRefresh={() => { void Promise.all([fetchJobs(), fetchGlobalEvents()]); }}
          onClearLogs={() => setIsClearLogsOpen(true)}
          onOpenFullscreen={() => { setFullscreenEventScope('global'); setFullscreenView('events'); }}
        />
      </div>

      <OutputArtifactsDialog
        isOpen={openOutputJobId !== null}
        jobId={openOutputJobId || ''}
        jobTitle={jobs.find(job => job.job_id === openOutputJobId)?.title}
        listing={outputListing}
        loading={outputLoading}
        error={outputError}
        selectedArtifact={selectedOutputArtifact}
        selectedArtifactPaths={selectedOutputPaths}
        previewText={outputPreviewText}
        previewLoading={outputPreviewLoading}
        archiveDownloading={archiveDownloading}
        artifactUrl={(relativePath) => outputArtifactUrl(openOutputJobId || '', relativePath)}
        onClose={closeOutputDialog}
        onSelectArtifact={artifact => void handleSelectOutputArtifact(artifact)}
        onToggleArtifact={toggleOutputArtifact}
        onSelectAll={selectAllOutputArtifacts}
        onClearSelection={clearOutputSelection}
        onDownloadSelected={() => void downloadSelectedOutputArtifacts()}
        onDownloadArtifact={artifact => void downloadOutputArtifact(artifact)}
      />

      <DetailFullscreenDialog
        isOpen={fullscreenView !== null}
        title={fullscreenView === 'events' ? fullscreenEventScope === 'global' ? 'Globaler Ereignisverlauf & Tokenverbrauch' : 'Ereignisverlauf & Tokenverbrauch' : fullscreenView === 'transcript' ? 'Transkript' : fullscreenView === 'json' ? 'JSON (n8n)' : 'Screenshot-Kandidaten'}
        onClose={() => setFullscreenView(null)}
      >
        {fullscreenView === 'events' ? fullscreenEventScope === 'global' ? <JobEventLog events={globalEvents.events} usage={globalEvents.usage} cost={globalEvents.cost} loading={globalEventsLoading} onOpenFullscreen={() => undefined} fullscreen scope="global" /> : <JobEventLog events={jobEvents.events} usage={jobEvents.usage} cost={jobEvents.cost} loading={eventsLoading} onOpenFullscreen={() => undefined} fullscreen scope="job" /> : renderActiveDetailContent(true)}
      </DetailFullscreenDialog>

      {/* Settings Modal (Zahnrad Dialog) */}
      {isClearHistoryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="clear-history-title">
          <div className="w-full max-w-md bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-700 p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h2 id="clear-history-title" className="text-base font-bold text-stone-900 dark:text-stone-100">Historie löschen?</h2>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">Alle gespeicherten Jobs werden entfernt. Laufende Jobs werden vorher abgebrochen.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setIsClearHistoryOpen(false)}
                disabled={clearingHistory}
                className="px-3 py-2 text-sm font-medium text-stone-700 dark:text-stone-300 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-xl transition-colors disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleClearHistoryConfirm}
                disabled={clearingHistory}
                className="px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {clearingHistory && <Loader2 className="w-4 h-4 animate-spin" />}
                Historie löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {isClearLogsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="clear-logs-title">
          <div className="w-full max-w-lg bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-red-200 dark:border-red-900/70 p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h2 id="clear-logs-title" className="text-base font-bold text-stone-900 dark:text-stone-100">Log-Historie löschen?</h2>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">Diese Aktion löscht die globale JSONL-Datei sowie alle Ereignisse, Tokenwerte und Kostenschätzungen dauerhaft.</p>
                <p className="mt-2 text-xs text-stone-500 dark:text-stone-500">Gespeicherte Job-Ergebnisse bleiben erhalten. Laufende Jobs werden vorher abgebrochen. Die Löschung kann nicht rückgängig gemacht werden; neue Logs werden ab dem nächsten Auftrag wieder geschrieben.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setIsClearLogsOpen(false)}
                disabled={clearingLogs}
                className="px-3 py-2 text-sm font-medium text-stone-700 dark:text-stone-300 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-xl transition-colors disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                id="confirm-clear-logs-btn"
                type="button"
                onClick={handleClearLogsConfirm}
                disabled={clearingLogs}
                className="px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {clearingLogs && <Loader2 className="w-4 h-4 animate-spin" />}
                Log-Historie löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {isShutdownDialogOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-stone-950/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="shutdown-dialog-title">
          <div className="w-full max-w-md bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-red-200 dark:border-red-900/70 p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400"><Power className="w-5 h-5" /></div>
              <div>
                <h2 id="shutdown-dialog-title" className="text-base font-bold text-stone-900 dark:text-stone-100">Anwendung wirklich beenden?</h2>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">Der lokale Server wird vollständig heruntergefahren und laufende Analysen werden abgebrochen.</p>
                {shutdownActiveJobs > 0 && <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">Es läuft aktuell {shutdownActiveJobs === 1 ? 'noch 1 Analyse' : `noch ${shutdownActiveJobs} Analysen`}. Diese werden beendet.</p>}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setIsShutdownDialogOpen(false)} className="px-3 py-2 text-sm font-medium text-stone-700 dark:text-stone-300 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-xl">Abbrechen</button>
              <button type="button" onClick={handleShutdownConfirm} className="px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl flex items-center gap-2"><Power className="w-4 h-4" />App beenden</button>
            </div>
          </div>
        </div>
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onSave={saveConfig}
        onSaveApiKey={saveApiKey}
        onDeleteApiKey={deleteApiKey}
      />

      {config && quickConfigPanel && (
        <QuickConfigDialog
          panel={quickConfigPanel}
          config={config}
          onClose={() => setQuickConfigPanel(null)}
          onSave={saveQuickConfig}
        />
      )}
    </div>
  );
}
