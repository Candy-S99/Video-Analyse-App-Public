export interface ScreenshotEvaluationFrame { frame_id: string; timestamp_seconds: number; png: Buffer; }
export interface ScreenshotEvaluationRequest { candidateId: string; description: string; category: string; targetTimestampSeconds: number; frames: ScreenshotEvaluationFrame[]; }
export interface ScreenshotEvaluatorOptions { generate: (request: { prompt: string; frames: ScreenshotEvaluationFrame[] }) => Promise<string>; }

export interface ScreenshotEvaluationResult {
  primary: ScreenshotEvaluationFrame | null;
  variants: ScreenshotEvaluationFrame[];
  fallbackTimestampSeconds: number | null;
  decisions: Array<{ frame_id: string; accepted: boolean; reason?: string }>;
}

export class ScreenshotEvaluator {
  constructor(private readonly options: ScreenshotEvaluatorOptions) {}

  public async evaluate(request: ScreenshotEvaluationRequest): Promise<ScreenshotEvaluationResult> {
    if (!Array.isArray(request.frames) || request.frames.length === 0) throw new Error('At least one extracted PNG frame is required.');
    const text = await this.options.generate({ prompt: this.prompt(request), frames: request.frames });
    let response: any;
    try { response = JSON.parse(text); } catch { response = {}; }
    const byId = new Map(request.frames.map(frame => [frame.frame_id, frame]));
    const primary = typeof response.primary_frame_id === 'string' ? byId.get(response.primary_frame_id) ?? null : null;
    const selected = new Set(primary ? [primary.frame_id] : []);
    const variants: ScreenshotEvaluationFrame[] = [];
    for (const id of Array.isArray(response.variant_frame_ids) ? response.variant_frame_ids : []) {
      if (typeof id !== 'string' || selected.has(id)) continue;
      const frame = byId.get(id);
      if (!frame) continue;
      selected.add(id);
      variants.push(frame);
      if (variants.length === 3) break;
    }
    const decisions = Array.isArray(response.decisions) ? response.decisions
      .filter((decision: any) => decision && typeof decision.frame_id === 'string' && byId.has(decision.frame_id))
      .map((decision: any) => ({ frame_id: decision.frame_id, accepted: decision.accepted === true, reason: typeof decision.reason === 'string' ? decision.reason : undefined })) : [];
    return { primary, variants, fallbackTimestampSeconds: primary ? null : request.targetTimestampSeconds, decisions };
  }

  private prompt(request: ScreenshotEvaluationRequest): string {
    return `Du bewertest ausschließlich die ${request.frames.length} echten, zuvor extrahierten PNG-Originalframes für Kandidat ${request.candidateId} (${request.category}: ${request.description}). Keine Bildgenerierung. Keine Auswahl außerhalb der übergebenen frame_id-Werte. Wähle einen PRIMARY nur bei stabiler, lesbarer, informationsreicher Darstellung und höchstens drei nicht redundante VARIANTEN. Lehne Talking Heads ohne Informationswert, Übergänge, Ladebilder, Unschärfe, Cursor-only-Frames und redundante Varianten ab. Antworte ausschließlich als JSON mit primary_frame_id, variant_frame_ids, decisions [{frame_id, accepted, reason}] und fallback_recommended.`;
  }
}
