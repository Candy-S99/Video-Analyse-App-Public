import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ScreenshotMetadata, ScreenshotRole } from '../../shared/types';
import { OutputLayout } from './outputLayout';

export interface ScreenshotStorageOptions { dataDir?: string; layout?: OutputLayout; now?: () => Date; }
export interface StoreScreenshotRequest { jobId: string; title?: string; sceneNumber: number; screenshotId: string; role: ScreenshotRole; timestampSeconds: number; sourcePng: Buffer; existingCount?: number; }
export type StoredScreenshot = ScreenshotMetadata & { absolutePath: string };

export class ScreenshotStorage {
  private readonly layout: OutputLayout; private readonly now: () => Date;
  constructor({ dataDir, layout, now = () => new Date() }: ScreenshotStorageOptions = {}) {
    if (!layout && !dataDir) throw new Error('dataDir or layout is required'); this.layout = layout ?? new OutputLayout({ dataDir: dataDir! }); this.now = now;
  }
  public async store(request: StoreScreenshotRequest): Promise<StoredScreenshot> {
    if (request.role !== 'PRIMARY' && request.role !== 'VARIANT') throw new Error('Invalid screenshot role');
    if (!Number.isInteger(request.sceneNumber) || request.sceneNumber < 1 || (request.existingCount ?? 0) >= 4) throw new Error('Screenshot limit exceeded');
    if (!request.sourcePng.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG');
    const paths = this.layout.ensureJobDirectories(request.jobId, request.title);
    const suffix = request.role === 'PRIMARY' ? '' : `-variant-${String(Math.max(1, request.existingCount ?? 1)).padStart(2, '0')}`;
    const filename = `scene-${String(request.sceneNumber).padStart(3, '0')}${suffix}.png`;
    const absolutePath = paths.artifactPath(`06-screenshots/${filename}`); const temp = path.join(path.dirname(absolutePath), `.${filename}.tmp-${randomUUID()}`);
    fs.writeFileSync(temp, request.sourcePng); fs.renameSync(temp, absolutePath);
    const now = this.now().toISOString(); return { screenshot_id: request.screenshotId, role: request.role, status: 'COMPLETED', retention_status: 'ACTIVE', extraction_timestamp_seconds: request.timestampSeconds, timestamp_offset_seconds: 0, filename, relative_path: `${paths.relativeJobDirectory}/06-screenshots/${filename}`, api_url: `/api/v1/video-analysis/jobs/${request.jobId}/screenshots/${encodeURIComponent(request.screenshotId)}`, mime_type: 'image/png', width: request.sourcePng.readUInt32BE(16), height: request.sourcePng.readUInt32BE(20), file_size_bytes: fs.statSync(absolutePath).size, extracted_at: now, absolutePath };
  }
}
