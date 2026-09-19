import React, { useState } from 'react';
import { Activity, CheckCircle2, Clock3, Code2, Loader2, RefreshCw, Trash2, TriangleAlert, XCircle } from 'lucide-react';
import { JobCostSummary, JobEvent, JobUsageSummary } from '../../shared/types';

interface JobEventLogProps {
  events: JobEvent[];
  usage: JobUsageSummary;
  cost?: JobCostSummary;
  loading?: boolean;
  onOpenFullscreen: () => void;
  onRefresh?: () => void;
  onClearLogs?: () => void;
  fullscreen?: boolean;
  scope?: 'job' | 'global';
}

const labels: Partial<Record<JobEvent['type'], string>> = {
  JOB_CREATED: 'Auftrag erstellt',
  JOB_STARTED: 'Analyse gestartet',
  JOB_CANCELLED: 'Auftrag abgebrochen',
  JOB_COMPLETED: 'Auftrag abgeschlossen',
  JOB_FAILED: 'Auftrag fehlgeschlagen',
  API_STARTED: 'API-Aufruf gestartet',
  API_COMPLETED: 'API-Aufruf abgeschlossen',
  API_FAILED: 'API-Aufruf fehlgeschlagen',
  API_ABORTED: 'API-Aufruf abgebrochen',
  FALLBACK_ATTEMPT: 'Fallback-Modell versucht',
  RETRY_SCHEDULED: 'Wiederholung geplant',
  SCREENSHOT_PHASE_STARTED: 'Screenshot-Phase gestartet',
  SCREENSHOT_PHASE_COMPLETED: 'Screenshot-Phase abgeschlossen',
  SCREENSHOT_CANDIDATE_COMPLETED: 'Screenshot-Kandidat abgeschlossen',
  SCREENSHOT_FALLBACK: 'Screenshot-Fallback verwendet',
  SCREENSHOT_PARTIAL: 'Screenshot teilweise abgeschlossen',
  SCREENSHOT_FAILED: 'Screenshot fehlgeschlagen',
  RETENTION_PREVIEW: 'Aufbewahrungsvorschau erstellt',
  RETENTION_CLEANUP_COMPLETED: 'Aufbewahrung bereinigt',
};

const JSON_LOG_FIELD_PATTERN = /"(job_id|usage|prompt_tokens|candidate_tokens|total_tokens|reported_requests|input_tokens|output_tokens|token_cost|cost|input_usd|output_usd|estimated_usd|pricing_tier|pricing_version|pricing_effective_period)"\s*:\s*("(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?)/g;

function highlightJsonLine(line: string, lineIndex: number): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  line.replace(JSON_LOG_FIELD_PATTERN, (match, field: string, _value: string, offset: number) => {
    if (offset > cursor) parts.push(line.slice(cursor, offset));
    parts.push(
      <span key={`${lineIndex}-${offset}`} className={field === 'job_id' ? 'json-log-job-id text-emerald-400' : 'json-log-token text-emerald-400'}>
        {match}
      </span>,
    );
    cursor = offset + match.length;
    return match;
  });
  if (cursor < line.length) parts.push(line.slice(cursor));
  return <React.Fragment key={lineIndex}>{parts}</React.Fragment>;
}

function EventIcon({ type }: { type: JobEvent['type'] }) {
  if (type.includes('COMPLETED')) return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (type.includes('FAILED')) return <TriangleAlert className="w-4 h-4 text-red-500" />;
  if (type.includes('CANCELLED') || type.includes('ABORTED')) return <XCircle className="w-4 h-4 text-amber-500" />;
  if (type === 'API_STARTED') return <Loader2 className="w-4 h-4 text-indigo-500" />;
  return <Activity className="w-4 h-4 text-stone-500" />;
}

export const JobEventLog: React.FC<JobEventLogProps> = ({ events, usage, cost, loading, onOpenFullscreen, onRefresh, onClearLogs, fullscreen = false, scope = 'job' }) => (
  <JobEventLogContent events={events} usage={usage} cost={cost} loading={loading} onOpenFullscreen={onOpenFullscreen} onRefresh={onRefresh} onClearLogs={onClearLogs} fullscreen={fullscreen} scope={scope} />
);

const JobEventLogContent: React.FC<JobEventLogProps> = ({ events, usage, cost, loading, onOpenFullscreen, onRefresh, onClearLogs, fullscreen = false, scope = 'job' }) => {
  const [showRawLog, setShowRawLog] = useState(false);
  const rawJsonLog = events.map(event => JSON.stringify(event)).join('\n');
  const isGlobal = scope === 'global';
  const safeCost = cost || { input_usd: 0, output_usd: 0, estimated_usd: 0, priced_requests: 0, currency: 'USD' as const };
  const formattedCost = safeCost.priced_requests > 0
    ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: safeCost.currency, minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(safeCost.estimated_usd)
    : '–';
  return <section id={fullscreen ? undefined : isGlobal ? 'global-job-event-log' : 'job-event-log'} className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 overflow-hidden">
    <header className="p-4 border-b border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-indigo-500" />
        <div>
          <h2 className="text-sm font-bold">{isGlobal ? 'Globaler Ereignisverlauf & Tokenverbrauch' : 'Ereignisverlauf & Tokenverbrauch'}</h2>
          <p className="text-[11px] text-stone-500 dark:text-stone-400">{isGlobal ? 'Alle Jobs aus der dauerhaft gespeicherten JSONL-Datei.' : 'Gemeldete Gemini-Token und gespeicherte Kostenschätzungen dieses Auftrags.'}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!fullscreen && isGlobal && onRefresh && <button id="global-refresh-events-btn" type="button" onClick={onRefresh} disabled={loading} className="p-2 rounded-lg border border-stone-200 dark:border-stone-700 text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-800 disabled:opacity-50" title="Globalen Verlauf manuell aktualisieren" aria-label="Globalen Verlauf manuell aktualisieren"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button>}
        {!fullscreen && isGlobal && onClearLogs && <button id="clear-logs-btn" type="button" onClick={onClearLogs} disabled={loading} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg border border-red-700 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed" title="Alle Ereignis-, Token- und Kostenlogs löschen"><Trash2 className="w-3.5 h-3.5" />Log-Historie löschen</button>}
        <button id={fullscreen ? 'toggle-json-log-fullscreen-btn' : isGlobal ? 'global-toggle-json-log-btn' : 'toggle-json-log-btn'} type="button" onClick={() => setShowRawLog(value => !value)} aria-pressed={showRawLog} className={`px-3 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1.5 ${showRawLog ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300' : 'border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800'}`}>
          <Code2 className="w-3.5 h-3.5" />{showRawLog ? 'JSON-Log schließen' : 'JSON-Log'}
        </button>
        {!fullscreen && <button id={isGlobal ? 'global-open-fullscreen-events-btn' : 'open-fullscreen-events-btn'} type="button" onClick={onOpenFullscreen} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800">Großansicht</button>}
      </div>
    </header>
    <div className="p-3 border-b border-stone-200 dark:border-stone-800">
      <div className="grid grid-cols-2 gap-3 max-w-xl">
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/70 dark:bg-indigo-950/35 p-3"><p className="text-[10px] uppercase tracking-wide text-indigo-700/80 dark:text-indigo-300/80">Token gesamt</p><p className="mt-0.5 font-mono text-lg font-bold text-indigo-800 dark:text-indigo-200">{Number(usage.total_tokens).toLocaleString('de-DE')}</p></div>
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/70 dark:bg-emerald-950/25 p-3"><p className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Kostenschätzung</p><p className="mt-0.5 font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300">{formattedCost}</p></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-stone-500"><span>Gemeldete Aufrufe: <strong>{Number(usage.reported_requests).toLocaleString('de-DE')}</strong></span><span>Eingabe: <strong>{Number(usage.prompt_tokens).toLocaleString('de-DE')}</strong></span><span>Ausgabe: <strong>{Number(usage.candidate_tokens).toLocaleString('de-DE')}</strong></span><span>Preisberechnete Aufrufe: <strong>{Number(safeCost.priced_requests).toLocaleString('de-DE')}</strong></span></div>
    </div>
    <div id={fullscreen ? undefined : isGlobal ? 'global-job-event-scroll' : 'job-event-scroll'} className={`${fullscreen ? 'max-h-none' : 'max-h-[18rem]'} overflow-y-auto p-3 space-y-2`}>
      {showRawLog ? <pre id={fullscreen ? 'job-json-log-fullscreen' : 'job-json-log'} className="min-h-[12rem] whitespace-pre-wrap break-all rounded-xl bg-stone-950 p-4 text-[11px] leading-relaxed text-stone-100 overflow-auto">{rawJsonLog ? rawJsonLog.split('\n').map((line, index, lines) => <React.Fragment key={index}>{highlightJsonLine(line, index)}{index < lines.length - 1 ? '\n' : ''}</React.Fragment>) : 'Noch kein JSON-Log vorhanden.'}</pre> : loading ? <div className="flex justify-center p-6"><Loader2 className="w-5 h-5 animate-spin text-indigo-500" /></div> : events.length === 0 ? <p className="p-4 text-center text-xs text-stone-500">Für diesen Auftrag liegen noch keine Ereignisse vor.</p> : events.map(event => (
        <article key={event.event_id} className="flex gap-3 p-3 rounded-xl border border-stone-100 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-950/20">
          <div className="pt-0.5"><EventIcon type={event.type} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-xs font-medium">{labels[event.type] ?? event.type}</span>{event.operation && <span className="font-mono text-[10px] text-indigo-600 dark:text-indigo-300">{event.operation}</span>}{event.model && <span className="font-mono text-[10px] text-stone-500">{event.model}</span>}</div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-stone-500"><span className="inline-flex items-center gap-1"><Clock3 className="w-3 h-3" />{new Date(event.timestamp).toLocaleString('de-DE')}</span>{event.duration_ms !== undefined && <span>{event.duration_ms} ms</span>}{event.usage?.total_tokens !== undefined && <span>{event.usage.total_tokens.toLocaleString('de-DE')} Token gemeldet</span>}{event.cost_estimate?.estimated_usd !== undefined && <span className="text-emerald-700 dark:text-emerald-300">Schätzung {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(event.cost_estimate.estimated_usd)}</span>}</div>
          </div>
        </article>
      ))}
    </div>
  </section>
};
