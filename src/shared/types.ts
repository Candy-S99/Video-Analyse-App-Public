export type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';

export type JobPhase =
  | 'ANALYSIS'
  | 'TRANSCRIPT_EXTRACTION'
  | 'INVENTORY_CONSOLIDATION'
  | 'SCREENSHOT_EXTRACTION'
  | 'FINALIZING';

export type ScreenshotRole = 'PRIMARY' | 'VARIANT';
export type ScreenshotStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'SKIPPED' | 'FALLBACK' | 'PURGED';
export type RetentionStatus = 'ACTIVE' | 'PURGED';
export type ExternalStorageStatus = 'NOT_CONFIGURED' | 'PENDING' | 'COMPLETED' | 'FAILED';

export interface FineSearchFrameMetadata {
  frame_id: string;
  requested_timestamp_seconds: number;
  actual_timestamp_seconds?: number;
  extraction_status: 'EXTRACTED' | 'FAILED' | 'SKIPPED';
  evaluation: 'ACCEPTED' | 'REJECTED' | 'REDUNDANT' | 'NOT_EVALUATED';
  reason?: string;
  error_code?: string;
}

export interface ScreenshotMetadata {
  screenshot_id: string;
  role: ScreenshotRole;
  status: ScreenshotStatus;
  retention_status?: RetentionStatus;
  extraction_timestamp_seconds: number;
  timestamp_offset_seconds: number;
  filename: string;
  relative_path: string;
  api_url: string;
  mime_type: 'image/png';
  width: number;
  height: number;
  file_size_bytes: number;
  extracted_at: string;
  purged_at?: string;
  warning?: string;
}

export interface ScreenshotProgress {
  segments_completed: number;
  segments_total: number;
  candidates_completed: number;
  candidates_total: number;
  screenshots_completed: number;
  screenshots_failed: number;
  fine_search_frames_examined: number;
}

export interface ScreenshotExternalStorage {
  status: ExternalStorageStatus;
  relative_path?: string;
  copied_at?: string;
  warning?: string;
}

export interface FailedSegment {
  segmentNumber: number;
  startSeconds: number;
  endSeconds: number;
  errorCode: string;
  errorMessage: string;
  retries: number;
}

export interface InventoryItem {
  start_seconds: number;
  end_seconds: number;
  visual_description: string;
  category: string;
  is_significant_change: boolean;
  is_visual_only: boolean;
  is_talking_head_only: boolean;
}

export interface ScreenshotCandidate {
  candidate_id: string;
  timestamp_seconds: number;
  timestamp_display: string;
  start_seconds: number;
  end_seconds: number;
  visual_description: string;
  category: string;
  information_score: number;
  visual_only: boolean;
  screenshot_recommended: boolean;
  duplicate_group: string;
  source_segment: number;
  status?: ScreenshotStatus;
  screenshots?: ScreenshotMetadata[];
  fine_search_frames?: FineSearchFrameMetadata[];
}

export interface TranscriptSegment {
  start_seconds: number;
  end_seconds: number;
  timestamp_display: string;
  speaker?: string;
  text: string;
}

export interface VideoTranscript {
  full_text: string;
  language?: string;
  segments: TranscriptSegment[];
}

export interface AppConfig {
  model: string;
  segment_length_seconds: number;
  extract_transcript: boolean;
  gemini_api_key_configured: boolean;
  data_dir: string;
  external_output_dir?: string;
  fine_search_window_seconds: number;
  fine_search_interval_seconds: number;
  max_screenshots_per_candidate: number;
  fine_search_fallback: 'exact_timestamp' | 'skip';
  automatic_cleanup_enabled: boolean;
}

export interface JobConfigSnapshot {
  model: string;
  segment_length_seconds: number;
  extract_transcript: boolean;
  fine_search_window_seconds: number;
  fine_search_interval_seconds: number;
  max_screenshots_per_candidate: number;
  fine_search_fallback: 'exact_timestamp' | 'skip';
  automatic_cleanup_enabled: boolean;
}

type KnownJobEventType =
  | 'JOB_CREATED'
  | 'JOB_STARTED'
  | 'JOB_CANCELLED'
  | 'JOB_COMPLETED'
  | 'JOB_FAILED'
  | 'API_STARTED'
  | 'API_COMPLETED'
  | 'API_FAILED'
  | 'API_ABORTED'
  | 'FALLBACK_ATTEMPT'
  | 'RETRY_SCHEDULED'
  | 'SCREENSHOT_PHASE_STARTED'
  | 'SCREENSHOT_PHASE_COMPLETED'
  | 'SCREENSHOT_CANDIDATE_COMPLETED'
  | 'SCREENSHOT_FALLBACK'
  | 'SCREENSHOT_PARTIAL'
  | 'SCREENSHOT_FAILED'
  | 'EXTERNAL_COPY_COMPLETED'
  | 'EXTERNAL_COPY_FAILED'
  | 'RETENTION_PREVIEW'
  | 'RETENTION_CLEANUP_COMPLETED';

export type JobEventType = KnownJobEventType;

export type JobOperation =
  | 'YOUTUBE_OEMBED'
  | 'VIDEO_METADATA'
  | 'SEGMENT_ANALYSIS'
  | 'TRANSCRIPT_EXTRACTION'
  | 'INVENTORY_CONSOLIDATION'
  | 'SCREENSHOT_EXTRACTION'
  | 'SCREENSHOT_EVALUATION'
  | 'SCREENSHOT_STORAGE'
  | 'EXTERNAL_COPY'
  | 'RETENTION_CLEANUP';

export interface JobTokenUsage {
  prompt_tokens?: number;
  candidate_tokens?: number;
  total_tokens?: number;
}

export interface JobCostEstimate {
  currency: 'USD';
  input_usd: number;
  output_usd: number;
  estimated_usd: number;
  pricing_tier: 'standard';
  pricing_version: string;
  pricing_effective_period: string;
  price_basis: 'paid_standard_per_1m_tokens';
}

export interface JobEvent {
  event_id: string;
  job_id: string;
  timestamp: string;
  type: JobEventType;
  operation?: JobOperation;
  provider?: 'gemini' | 'youtube' | 'app';
  model?: string;
  status?: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  duration_ms?: number;
  usage?: JobTokenUsage;
  cost_estimate?: JobCostEstimate;
  details?: Record<string, string | number | boolean>;
}

export interface JobUsageSummary {
  prompt_tokens: number;
  candidate_tokens: number;
  total_tokens: number;
  reported_requests: number;
}

export interface JobCostSummary {
  input_usd: number;
  output_usd: number;
  estimated_usd: number;
  priced_requests: number;
  currency: 'USD';
}

export interface JobEventsResponse {
  events: JobEvent[];
  usage: JobUsageSummary;
  cost: JobCostSummary;
}

export interface JobResult {
  schema_version: string;
  job_id: string;
  correlation_id: string;
  status: JobStatus;
  phase: JobPhase;
  progress: ScreenshotProgress;
  external_storage: ScreenshotExternalStorage;
  config_snapshot: JobConfigSnapshot;
  output_directory?: string;
  source: {
    type: string;
    url: string;
    youtube_video_id?: string;
  };
  video: {
    title?: string;
    duration_seconds?: number;
    author?: string;
    thumbnail_url?: string;
  };
  analysis: {
    model: string;
    processing_mode: string;
    segment_duration_seconds: number;
    segments_total: number;
    segments_successful: number;
    segments_failed: number;
  };
  inventory: InventoryItem[];
  screenshot_candidates: ScreenshotCandidate[];
  transcript?: VideoTranscript;
  warnings: string[];
  errors: string[];
  created_at: string;
  completed_at?: string;
  failed_segments?: FailedSegment[];
}
