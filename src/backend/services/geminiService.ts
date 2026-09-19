import { GoogleGenAI, Type } from '@google/genai';
import { JobEventContext, getReportedUsage } from './jobEventLogger';
import { estimateGeminiCost } from './geminiPricing';
import { SecretStore, secretStore as defaultSecretStore } from './secretStore';
import { safeErrorMessage } from './secretRedactor';

export class GeminiApiKeyRequiredError extends Error {
  public readonly code = 'GEMINI_API_KEY_REQUIRED' as const;

  constructor() {
    super('Für die Videoanalyse wird ein Gemini API Key benötigt. Bitte hinterlege ihn unter Einstellungen.');
    this.name = 'GeminiApiKeyRequiredError';
  }
}

export interface GeminiServiceOptions {
  secretStore?: Pick<SecretStore, 'getGeminiApiKey' | 'hasGeminiApiKey'>;
  clientFactory?: (apiKey: string) => any;
}

const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.6-flash'];
const DEFAULT_STABLE_MODEL = 'gemini-3.8-flash';

function extractRetryDelayMs(err: any): number {
  try {
    const raw = typeof err === 'string' ? err : (err?.message || JSON.stringify(err));
    const delayMatch = raw.match(/retryDelay["']?\s*:\s*["']?([0-9.]+)s/i);
    if (delayMatch) return Math.min(Math.ceil(parseFloat(delayMatch[1]) * 1000) + 1500, 60000);
    const retryInMatch = raw.match(/retry in ([0-9.]+)s/i);
    if (retryInMatch) return Math.min(Math.ceil(parseFloat(retryInMatch[1]) * 1000) + 1500, 60000);
  } catch {}
  return 8000;
}

function createAbortError(): Error {
  const error = new Error('Gemini request aborted.');
  error.name = 'AbortError';
  return error;
}

function waitWithAbort(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class GeminiService {
  private readonly secretStore: Pick<SecretStore, 'getGeminiApiKey' | 'hasGeminiApiKey'>;
  private readonly clientFactory: (apiKey: string) => any;

  constructor({ secretStore = defaultSecretStore, clientFactory }: GeminiServiceOptions = {}) {
    this.secretStore = secretStore;
    this.clientFactory = clientFactory || ((apiKey: string) => new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    }));
  }

  public hasApiKey(): boolean {
    return this.secretStore.hasGeminiApiKey();
  }

  private getClient(): any {
    const apiKey = this.secretStore.getGeminiApiKey();
    if (!apiKey) throw new GeminiApiKeyRequiredError();
    return this.clientFactory(apiKey);
  }

  private safeErrorMessage(error: unknown): string {
    return safeErrorMessage(error, [this.secretStore.getGeminiApiKey() || '']);
  }

  public getModel(overrideModel?: string): string {
    const raw = (overrideModel || process.env.GEMINI_MODEL || DEFAULT_STABLE_MODEL).trim();
    const cleaned = raw.replace(/^models\//, '');
    if (/^gemini-[a-zA-Z0-9\.\-]+$/.test(cleaned)) {
      return cleaned;
    }
    console.warn(`[GeminiService] Unsupported or invalid model "${raw}". Using default "${DEFAULT_STABLE_MODEL}".`);
    return DEFAULT_STABLE_MODEL;
  }

  private async generateWithFallback(params: {
    model: string;
    contents: any[];
    config?: any;
    abortSignal?: AbortSignal;
    eventContext?: JobEventContext;
  }): Promise<any> {
    if (params.abortSignal?.aborted) {
      throw createAbortError();
    }

    const primaryModel = this.getModel(params.model);
    
    // Build ordered list of candidate models starting with requested model
    const candidateModels = [
      primaryModel,
      ...FALLBACK_MODELS.filter(m => m !== primaryModel)
    ];

    let lastError: any = null;
    let quotaError: any = null;

    const logEvent = (type: 'API_STARTED' | 'API_COMPLETED' | 'API_FAILED' | 'API_ABORTED' | 'FALLBACK_ATTEMPT' | 'RETRY_SCHEDULED', options: Record<string, any> = {}) => {
      if (!params.eventContext) return;
      params.eventContext.logger.append({
        job_id: params.eventContext.jobId,
        type,
        operation: params.eventContext.operation,
        provider: 'gemini',
        model: options.model || params.eventContext.model,
        status: options.status,
        duration_ms: options.duration_ms,
        usage: options.usage,
        cost_estimate: options.cost_estimate,
        details: options.details || params.eventContext.details,
      });
    };

    const requestModel = async (model: string) => {
      const startedAt = Date.now();
      logEvent('API_STARTED', { model });
      try {
        const { abortSignal, eventContext, ...request } = params;
        const ai = this.getClient();
        const response = await ai.models.generateContent({
          ...request,
          model,
          config: {
            ...(request.config || {}),
            abortSignal,
          },
        });
        const usage = getReportedUsage(response.usageMetadata);
        logEvent('API_COMPLETED', {
          model,
          status: 'SUCCEEDED',
          duration_ms: Date.now() - startedAt,
          usage,
          cost_estimate: usage ? estimateGeminiCost(model, usage) : undefined,
        });
        return response;
      } catch (error: any) {
        logEvent(params.abortSignal?.aborted || error?.name === 'AbortError' ? 'API_ABORTED' : 'API_FAILED', {
          model,
          status: params.abortSignal?.aborted || error?.name === 'AbortError' ? 'CANCELLED' : 'FAILED',
          duration_ms: Date.now() - startedAt,
        });
        throw error;
      }
    };

    // Pass 1: Try candidate models immediately
    for (const model of candidateModels) {
      try {
        return await requestModel(model);
      } catch (err: any) {
        if (err instanceof GeminiApiKeyRequiredError) {
          throw err;
        }
        if (params.abortSignal?.aborted || err?.name === 'AbortError') {
          throw err;
        }
        lastError = err;
        logEvent('FALLBACK_ATTEMPT', { model, details: { ...(params.eventContext?.details || {}), fallback_from: model } });
        const msg = this.safeErrorMessage(err);
        const is429 = msg.includes('429') || err.status === 429 || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
        const is503 = msg.includes('503') || err.status === 503 || msg.includes('UNAVAILABLE') || msg.includes('high demand');
        const is404 = msg.includes('404') || err.status === 404 || msg.includes('NOT_FOUND');

        if (is429) {
          quotaError = err;
          console.warn(`[GeminiService] Model "${model}" hit quota limit (429). Trying next fallback model...`);
        } else if (is503) {
          console.warn(`[GeminiService] Model "${model}" temporarily busy (503). Trying next fallback model...`);
        } else if (is404) {
          console.warn(`[GeminiService] Model "${model}" not found (404). Trying next fallback model...`);
        } else {
          console.warn(`[GeminiService] Model "${model}" failed: ${msg.slice(0, 120)}. Trying next model...`);
        }
      }
    }

    // Pass 2: If all models hit limits and we encountered quota or busy errors, wait for the specified retryDelay and try once more
    if (quotaError || lastError) {
      const waitMs = extractRetryDelayMs(quotaError || lastError);
      logEvent('RETRY_SCHEDULED', { details: { ...(params.eventContext?.details || {}), wait_ms: waitMs } });
      console.log(`[GeminiService] All fallback models reached capacity. Pausing for ${Math.round(waitMs / 1000)}s before retry...`);
      await waitWithAbort(waitMs, params.abortSignal);

      for (const model of candidateModels) {
        if (params.abortSignal?.aborted) {
          throw createAbortError();
        }
        try {
          console.log(`[GeminiService] Retrying with model "${model}" after backoff...`);
          return await requestModel(model);
        } catch (retryErr: any) {
          if (params.abortSignal?.aborted || retryErr?.name === 'AbortError') {
            throw retryErr;
          }
          lastError = retryErr;
        }
      }
    }

    throw lastError || new Error("All Gemini model attempts failed.");
  }

  /** Screenshot-Auswahl ist absichtlich ein einzelner Modellaufruf ohne Fallback oder Backoff. */
  public async evaluateScreenshotFrames(params: {
    prompt: string;
    frames: Array<{ frame_id: string; png: Buffer }>;
    modelOverride?: string;
    abortSignal?: AbortSignal;
    eventContext?: JobEventContext;
  }): Promise<string> {
    if (params.abortSignal?.aborted) throw createAbortError();
    const model = this.getModel(params.modelOverride);
    const startedAt = Date.now();
    const log = (type: 'API_STARTED' | 'API_COMPLETED' | 'API_FAILED' | 'API_ABORTED', extra: Record<string, any> = {}) => params.eventContext?.logger.append({
      job_id: params.eventContext.jobId,
      type,
      operation: 'SCREENSHOT_EVALUATION',
      provider: 'gemini',
      model,
      status: extra.status,
      duration_ms: extra.duration_ms,
      usage: extra.usage,
      cost_estimate: extra.cost_estimate,
      details: params.eventContext.details,
    });
    log('API_STARTED');
    try {
      const ai = this.getClient();
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [
          { text: params.prompt },
          ...params.frames.map(frame => ({ inlineData: { mimeType: 'image/png', data: frame.png.toString('base64') } })),
        ] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              primary_frame_id: { type: Type.STRING, nullable: true },
              variant_frame_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
              decisions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { frame_id: { type: Type.STRING }, accepted: { type: Type.BOOLEAN }, reason: { type: Type.STRING } }, required: ['frame_id', 'accepted'] } },
              fallback_recommended: { type: Type.BOOLEAN },
            },
            required: ['primary_frame_id', 'variant_frame_ids', 'decisions', 'fallback_recommended'],
          },
          temperature: 0,
          abortSignal: params.abortSignal,
        },
      });
      const usage = getReportedUsage(response.usageMetadata);
      log('API_COMPLETED', { status: 'SUCCEEDED', duration_ms: Date.now() - startedAt, usage, cost_estimate: usage ? estimateGeminiCost(model, usage) : undefined });
      if (!response.text) throw new Error('Empty screenshot evaluation response.');
      return response.text;
    } catch (error: any) {
      const aborted = params.abortSignal?.aborted || error?.name === 'AbortError';
      log(aborted ? 'API_ABORTED' : 'API_FAILED', { status: aborted ? 'CANCELLED' : 'FAILED', duration_ms: Date.now() - startedAt });
      throw error;
    }
  }

  public async uploadVideo(filePath: string, mimeType: string = 'video/mp4') {
    console.log(`Uploading video to Gemini: ${filePath}`);
    const ai = this.getClient();
    const file = await ai.files.upload({
      file: filePath,
      config: { mimeType },
    });
    console.log(`Uploaded file as ${file.name}. Polling for ACTIVE state...`);

    let currentState = await ai.files.get({ name: file.name });
    while (currentState.state === 'PROCESSING') {
      await new Promise(resolve => setTimeout(resolve, 5000));
      currentState = await ai.files.get({ name: file.name });
      console.log(`File state: ${currentState.state}`);
    }

    if (currentState.state === 'FAILED') {
      throw new Error(`Video processing failed on Gemini server.`);
    }

    return currentState;
  }

  public async deleteVideo(fileName: string) {
    if (!this.hasApiKey()) return;
    try {
      const ai = this.getClient();
      await ai.files.delete({ name: fileName });
      console.log(`Deleted file ${fileName} from Gemini.`);
    } catch (e) {
      console.error(`Failed to delete file ${fileName} from Gemini: ${this.safeErrorMessage(e)}`);
    }
  }

  public async getVideoMetadata(fileUri: string, modelOverride?: string, abortSignal?: AbortSignal, eventContext?: JobEventContext): Promise<{ title?: string; duration_seconds?: number }> {
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        duration_seconds: { type: Type.INTEGER }
      },
      required: ["duration_seconds"]
    };

    const response = await this.generateWithFallback({
      model: this.getModel(modelOverride),
      abortSignal,
      eventContext,
      contents: [
        {
          role: 'user',
          parts: [
            { fileData: { fileUri, mimeType: 'video/mp4' } },
            { text: 'Analyze this video and return the exact total duration in seconds as JSON: {"duration_seconds": number, "title": string}' }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.1
      }
    });

    const text = response.text;
    if (!text) return { duration_seconds: 60 };
    try {
      return JSON.parse(text);
    } catch {
      return { duration_seconds: 60 };
    }
  }

  public async analyzeSegment(fileUri: string, startSeconds: number, endSeconds: number, prompt: string, modelOverride?: string, abortSignal?: AbortSignal, eventContext?: JobEventContext) {
    const responseSchema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          start_seconds: { type: Type.INTEGER },
          end_seconds: { type: Type.INTEGER },
          visual_description: { type: Type.STRING },
          category: { type: Type.STRING },
          is_significant_change: { type: Type.BOOLEAN },
          is_visual_only: { type: Type.BOOLEAN },
          is_talking_head_only: { type: Type.BOOLEAN }
        },
        required: ["start_seconds", "end_seconds", "visual_description", "category", "is_significant_change", "is_visual_only", "is_talking_head_only"]
      }
    };

    const response = await this.generateWithFallback({
      model: this.getModel(modelOverride),
      abortSignal,
      eventContext,
      contents: [
        {
          role: 'user',
          parts: [
            { 
              fileData: { fileUri, mimeType: 'video/mp4' },
              videoMetadata: { startOffset: `${startSeconds}s`, endOffset: `${endSeconds}s` }
            },
            { text: prompt }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.2
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini");
    return JSON.parse(text);
  }

  public async consolidateInventory(inventory: any[], prompt: string, modelOverride?: string, abortSignal?: AbortSignal, eventContext?: JobEventContext) {
    const responseSchema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          candidate_id: { type: Type.STRING },
          timestamp_seconds: { type: Type.INTEGER },
          timestamp_display: { type: Type.STRING },
          start_seconds: { type: Type.INTEGER },
          end_seconds: { type: Type.INTEGER },
          visual_description: { type: Type.STRING },
          category: { type: Type.STRING },
          information_score: { type: Type.INTEGER },
          visual_only: { type: Type.BOOLEAN },
          screenshot_recommended: { type: Type.BOOLEAN },
          duplicate_group: { type: Type.STRING },
          source_segment: { type: Type.INTEGER }
        },
        required: ["candidate_id", "timestamp_seconds", "timestamp_display", "start_seconds", "end_seconds", "visual_description", "category", "information_score", "visual_only", "screenshot_recommended", "duplicate_group", "source_segment"]
      }
    };

    const response = await this.generateWithFallback({
      model: this.getModel(modelOverride),
      abortSignal,
      eventContext,
      contents: [
        {
          role: 'user',
          parts: [
            { text: `Die folgende Liste ist die visuelle Inventur des Videos:\n\n${JSON.stringify(inventory, null, 2)}\n\n${prompt}` }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.1
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini");
    return JSON.parse(text);
  }

  public async extractTranscript(fileUri: string, modelOverride?: string, abortSignal?: AbortSignal, eventContext?: JobEventContext) {
    console.log(`Extracting full audio transcript via Gemini...`);
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        language: { type: Type.STRING },
        full_text: { type: Type.STRING },
        segments: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              start_seconds: { type: Type.INTEGER },
              end_seconds: { type: Type.INTEGER },
              timestamp_display: { type: Type.STRING },
              speaker: { type: Type.STRING },
              text: { type: Type.STRING }
            },
            required: ["start_seconds", "end_seconds", "timestamp_display", "text"]
          }
        }
      },
      required: ["language", "full_text", "segments"]
    };

    const response = await this.generateWithFallback({
      model: this.getModel(modelOverride),
      abortSignal,
      eventContext,
      contents: [
        {
          role: 'user',
          parts: [
            { 
              fileData: { fileUri, mimeType: 'video/mp4' }
            },
            { 
              text: `Extrahiere das vollständige, gesprochene Wort-für-Wort Transkript dieses Videos.
Formatiere das Ergebnis exakt nach dem vorgegebenen Schema:
1. 'language': Erkannte Sprache (z.B. 'de' oder 'en').
2. 'full_text': Der gesamte gesprochene Text als ein zusammenhängender, sauber formatierter Fließtext mit korrekter Groß-/Kleinschreibung und Zeichensetzung.
3. 'segments': Eine chronologische Liste von aufeinanderfolgenden Textabschnitten mit präzisen Zeitstempeln (start_seconds, end_seconds, timestamp_display im Format MM:SS, optional speaker, und text).

Falls im Video überhaupt nicht gesprochen wird, setze 'full_text': "" und 'segments': [].` 
            }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.1
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty transcript response from Gemini");
    return JSON.parse(text);
  }
}

export const geminiService = new GeminiService();
