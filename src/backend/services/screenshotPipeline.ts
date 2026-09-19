import type { FineSearchFrameMetadata, ScreenshotCandidate, ScreenshotMetadata } from '../../shared/types';

export interface ScreenshotPipelineDependencies {
  extractFrame: (input: { timestampSeconds: number; frameId: string }) => Promise<{ outputPath: string; width: number; height: number; fileSizeBytes: number; png?: Buffer }>;
  evaluate: (input: { candidate: ScreenshotCandidate; frames: Array<{ frame_id: string; timestamp_seconds: number; png?: Buffer }> }) => Promise<{ primary: { frame_id: string } | null; variants: Array<{ frame_id: string }>; fallbackTimestampSeconds: number | null }>;
  store: (input: { candidate: ScreenshotCandidate; frameId: string; timestampSeconds: number; role: 'PRIMARY' | 'VARIANT'; existingCount: number }) => Promise<ScreenshotMetadata>;
}

export class ScreenshotPipeline {
  constructor(private readonly deps: ScreenshotPipelineDependencies) {}
  public timestamps(target: number, duration: number, window = 2, interval = .5): number[] {
    const values: number[] = []; for (let value = target - window; value <= target + window + 1e-9; value += interval) values.push(Math.max(0, Math.min(duration, Number(value.toFixed(3)))));
    return [...new Set(values)];
  }
  public async run(candidate: ScreenshotCandidate, options: { durationSeconds: number; window?: number; interval?: number; maxScreenshots?: number; fallback?: 'exact_timestamp' | 'skip'; throwIfCancelled?: () => void }): Promise<ScreenshotCandidate> {
    if (!Number.isFinite(candidate.timestamp_seconds) || candidate.timestamp_seconds < 0 || candidate.timestamp_seconds > options.durationSeconds) {
      candidate.fine_search_frames = [];
      candidate.screenshots = [];
      candidate.status = 'SKIPPED';
      return candidate;
    }
    const frames: Array<{ frame_id: string; timestamp_seconds: number; png?: Buffer }> = []; const technical: FineSearchFrameMetadata[] = [];
    for (const [index, timestampSeconds] of this.timestamps(candidate.timestamp_seconds, options.durationSeconds, options.window, options.interval).entries()) {
      const frame_id = `frame-${String(index + 1).padStart(2, '0')}`; try { options.throwIfCancelled?.(); const extracted = await this.deps.extractFrame({ timestampSeconds, frameId: frame_id }); frames.push({ frame_id, timestamp_seconds: timestampSeconds, png: extracted.png }); technical.push({ frame_id, requested_timestamp_seconds: timestampSeconds, actual_timestamp_seconds: timestampSeconds, extraction_status: 'EXTRACTED', evaluation: 'NOT_EVALUATED' }); } catch (error: any) { technical.push({ frame_id, requested_timestamp_seconds: timestampSeconds, extraction_status: 'FAILED', evaluation: 'NOT_EVALUATED', error_code: String(error?.code || 'EXTRACTION_FAILED') }); }
    }
    candidate.fine_search_frames = technical; if (!frames.length) { candidate.status = 'FAILED'; return candidate; }
    const selection = await this.deps.evaluate({ candidate, frames }); const byId = new Map(frames.map(f => [f.frame_id, f])); const saved: ScreenshotMetadata[] = [];
    if (selection.primary && byId.has(selection.primary.frame_id)) saved.push(await this.deps.store({ candidate, frameId: selection.primary.frame_id, timestampSeconds: byId.get(selection.primary.frame_id)!.timestamp_seconds, role: 'PRIMARY', existingCount: saved.length }));
    const maxScreenshots = Math.max(1, Math.min(4, options.maxScreenshots ?? 4));
    for (const variant of selection.variants.slice(0, Math.max(0, maxScreenshots - saved.length))) if (byId.has(variant.frame_id)) saved.push(await this.deps.store({ candidate, frameId: variant.frame_id, timestampSeconds: byId.get(variant.frame_id)!.timestamp_seconds, role: 'VARIANT', existingCount: saved.length }));
    if (!saved.length && selection.fallbackTimestampSeconds !== null && options.fallback !== 'skip') {
      const fallbackFrame = [...frames].sort((left, right) => Math.abs(left.timestamp_seconds - selection.fallbackTimestampSeconds!) - Math.abs(right.timestamp_seconds - selection.fallbackTimestampSeconds!))[0];
      if (fallbackFrame) {
        const fallback = await this.deps.store({ candidate, frameId: fallbackFrame.frame_id, timestampSeconds: fallbackFrame.timestamp_seconds, role: 'PRIMARY', existingCount: saved.length });
        fallback.status = 'FALLBACK';
        saved.push(fallback);
      }
    }
    candidate.screenshots = saved;
    candidate.status = technical.some(f => f.extraction_status === 'FAILED') ? 'PARTIAL' : saved.length ? 'COMPLETED' : 'SKIPPED'; return candidate;
  }
}
