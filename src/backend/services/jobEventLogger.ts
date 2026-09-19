import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { JobCostSummary, JobEvent, JobEventsResponse, JobTokenUsage } from '../../shared/types';
import { estimateGeminiCost } from './geminiPricing';
import { redactSecrets } from './secretRedactor';

const KNOWN_EVENT_TYPES = new Set([
  'JOB_CREATED',
  'JOB_STARTED',
  'JOB_CANCELLED',
  'JOB_COMPLETED',
  'JOB_FAILED',
  'API_STARTED',
  'API_COMPLETED',
  'API_FAILED',
  'API_ABORTED',
  'FALLBACK_ATTEMPT',
  'RETRY_SCHEDULED',
  'SCREENSHOT_PHASE_STARTED',
  'SCREENSHOT_PHASE_COMPLETED',
  'SCREENSHOT_CANDIDATE_COMPLETED',
  'SCREENSHOT_FALLBACK',
  'SCREENSHOT_PARTIAL',
  'SCREENSHOT_FAILED',
  'RETENTION_PREVIEW',
  'RETENTION_CLEANUP_COMPLETED',
]);

export interface JobEventLoggerOptions {
  dataDir: string;
  getSecrets?: () => readonly string[];
}

export interface JobEventInput extends Omit<JobEvent, 'event_id' | 'timestamp'> {
  event_id?: string;
  timestamp?: string;
}

/**
 * Appends one safe, structured record per line. Callers must never pass API keys,
 * prompts or video/transcript content as details.
 */
export class JobEventLogger {
  private readonly eventsPath: string;
  private readonly getSecrets: () => readonly string[];
  private readonly suppressedJobIds = new Set<string>();

  constructor({ dataDir, getSecrets = () => [] }: JobEventLoggerOptions) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.eventsPath = path.join(dataDir, 'events.jsonl');
    this.getSecrets = getSecrets;
  }

  public append(input: JobEventInput): JobEvent | null {
    if (!KNOWN_EVENT_TYPES.has(input.type)) return null;
    const event: JobEvent = this.redactEvent({
      ...input,
      event_id: input.event_id || randomUUID(),
      timestamp: input.timestamp || new Date().toISOString(),
    });
    if (!this.suppressedJobIds.has(event.job_id)) {
      fs.appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    }
    return event;
  }

  public suppressJob(jobId: string): void {
    this.suppressedJobIds.add(jobId);
  }

  public clear(): number {
    if (!fs.existsSync(this.eventsPath)) return 0;
    fs.unlinkSync(this.eventsPath);
    return 1;
  }

  public getForJob(jobId: string): JobEventsResponse {
    const events = this.readEvents().filter(event => event.job_id === jobId);
    return this.summarize(events);
  }

  public emptyResponse(): JobEventsResponse {
    return { events: [], usage: this.emptyUsage(), cost: this.emptyCost() };
  }

  public getAll(): JobEventsResponse {
    const events = this.readEvents();
    return this.summarize(events);
  }

  private summarize(events: JobEvent[]): JobEventsResponse {
    const summary = events.reduce((result, event) => {
      if (event.usage && typeof event.usage.total_tokens === 'number') {
        result.usage.prompt_tokens += event.usage.prompt_tokens || 0;
        result.usage.candidate_tokens += event.usage.candidate_tokens || 0;
        result.usage.total_tokens += event.usage.total_tokens;
        result.usage.reported_requests += 1;
      }
      if (event.cost_estimate && typeof event.cost_estimate.estimated_usd === 'number') {
        result.cost.input_usd += event.cost_estimate.input_usd || 0;
        result.cost.output_usd += event.cost_estimate.output_usd || 0;
        result.cost.estimated_usd += event.cost_estimate.estimated_usd;
        result.cost.priced_requests += 1;
      }
      return result;
    }, { usage: this.emptyUsage(), cost: this.emptyCost() });

    return { events, usage: summary.usage, cost: summary.cost };
  }

  private readEvents(): JobEvent[] {
    if (!fs.existsSync(this.eventsPath)) return [];
    return fs.readFileSync(this.eventsPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap(line => {
        try {
          const parsed = JSON.parse(line) as JobEvent;
          const safeParsed = this.redactEvent(parsed);
          if (!safeParsed?.job_id || !KNOWN_EVENT_TYPES.has(safeParsed.type)) return [];
          if (safeParsed.provider === 'gemini' && safeParsed.type === 'API_COMPLETED' && safeParsed.model && safeParsed.usage && !safeParsed.cost_estimate) {
            const eventDate = new Date(safeParsed.timestamp);
            const costEstimate = estimateGeminiCost(safeParsed.model, safeParsed.usage, Number.isNaN(eventDate.valueOf()) ? new Date() : eventDate);
            return [costEstimate ? { ...safeParsed, cost_estimate: costEstimate } : safeParsed];
          }
          return [safeParsed];
        } catch {
          return [];
        }
      });
  }

  private redactEvent<T extends object>(event: T): T {
    const redact = (value: unknown): unknown => {
      if (typeof value === 'string') return redactSecrets(value, this.getSecrets());
      if (Array.isArray(value)) return value.map(item => redact(item));
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
      }
      return value;
    };
    return redact(event) as T;
  }

  private emptyUsage() {
    return {
      prompt_tokens: 0,
      candidate_tokens: 0,
      total_tokens: 0,
      reported_requests: 0,
    };
  }

  private emptyCost(): JobCostSummary {
    return {
      input_usd: 0,
      output_usd: 0,
      estimated_usd: 0,
      priced_requests: 0,
      currency: 'USD',
    };
  }
}

export interface JobEventContext {
  jobId: string;
  logger: JobEventLogger;
  operation: JobEvent['operation'];
  provider?: JobEvent['provider'];
  model?: string;
  details?: JobEvent['details'];
}

export function getReportedUsage(usageMetadata: any): JobTokenUsage | undefined {
  const total = usageMetadata?.totalTokenCount;
  if (typeof total !== 'number') return undefined;
  return {
    prompt_tokens: typeof usageMetadata?.promptTokenCount === 'number' ? usageMetadata.promptTokenCount : undefined,
    candidate_tokens: typeof usageMetadata?.candidatesTokenCount === 'number' ? usageMetadata.candidatesTokenCount : undefined,
    total_tokens: total,
  };
}
