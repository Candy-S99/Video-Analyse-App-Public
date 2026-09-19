import { geminiService } from './geminiService';
import { secretStore } from './secretStore';
import { safeErrorMessage } from './secretRedactor';
import { JobEventContext } from './jobEventLogger';

export interface VideoInfo {
  title: string;
  duration: number; // in seconds
  id: string;
  author?: string;
  thumbnail_url?: string;
  canonical_url: string;
}

export class YouTubeService {
  public extractYouTubeId(url: string): string | null {
    if (!url) return null;
    const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/;
    const match = url.match(regExp);
    return match ? match[1] : null;
  }

  public getCanonicalUrl(url: string): string {
    const videoId = this.extractYouTubeId(url);
    if (videoId) {
      return `https://www.youtube.com/watch?v=${videoId}`;
    }
    return url;
  }

  public async getVideoInfo(rawUrl: string, abortSignal?: AbortSignal, eventContext?: JobEventContext): Promise<VideoInfo> {
    const canonicalUrl = this.getCanonicalUrl(rawUrl);
    const videoId = this.extractYouTubeId(rawUrl) || 'video';
    
    let title = 'YouTube Video';
    let duration = 60;
    let author: string | undefined = undefined;
    let thumbnailUrl: string | undefined = undefined;

    // 1. Try public YouTube oEmbed endpoint (instant, reliable, no bot block)
    const oembedStartedAt = Date.now();
    eventContext?.logger.append({
      job_id: eventContext.jobId,
      type: 'API_STARTED',
      operation: 'YOUTUBE_OEMBED',
      provider: 'youtube',
      details: eventContext.details,
    });
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`, { signal: abortSignal });
      if (oembedRes.ok) {
        const data: any = await oembedRes.json();
        if (data.title) title = data.title;
        if (data.author_name) author = data.author_name;
        if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
        eventContext?.logger.append({
          job_id: eventContext.jobId,
          type: 'API_COMPLETED',
          operation: 'YOUTUBE_OEMBED',
          provider: 'youtube',
          status: 'SUCCEEDED',
          duration_ms: Date.now() - oembedStartedAt,
          details: eventContext.details,
        });
      } else {
        eventContext?.logger.append({
          job_id: eventContext.jobId,
          type: 'API_FAILED',
          operation: 'YOUTUBE_OEMBED',
          provider: 'youtube',
          status: 'FAILED',
          duration_ms: Date.now() - oembedStartedAt,
          details: eventContext.details,
        });
      }
    } catch (e: any) {
      if (abortSignal?.aborted) {
        eventContext?.logger.append({
          job_id: eventContext.jobId,
          type: 'API_ABORTED',
          operation: 'YOUTUBE_OEMBED',
          provider: 'youtube',
          status: 'CANCELLED',
          duration_ms: Date.now() - oembedStartedAt,
          details: eventContext.details,
        });
        throw e;
      }
      eventContext?.logger.append({
        job_id: eventContext.jobId,
        type: 'API_FAILED',
        operation: 'YOUTUBE_OEMBED',
        provider: 'youtube',
        status: 'FAILED',
        duration_ms: Date.now() - oembedStartedAt,
        details: eventContext.details,
      });
      console.warn(`[YouTubeService] oEmbed lookup warning: ${safeErrorMessage(e, [secretStore.getGeminiApiKey() || ''])}`);
    }

    if (abortSignal?.aborted) {
      throw new Error('YouTube metadata request aborted.');
    }

    // 2. Query Gemini for precise duration (and fallback title)
    try {
      const meta = await geminiService.getVideoMetadata(canonicalUrl, undefined, abortSignal, eventContext && {
        ...eventContext,
        operation: 'VIDEO_METADATA',
        provider: 'gemini',
      });
      if (meta.duration_seconds && meta.duration_seconds > 0) {
        duration = meta.duration_seconds;
      }
      if (meta.title && title === 'YouTube Video') {
        title = meta.title;
      }
    } catch (e: any) {
      if (abortSignal?.aborted) throw e;
      console.warn(`[YouTubeService] Gemini duration lookup warning: ${safeErrorMessage(e, [secretStore.getGeminiApiKey() || ''])}`);
    }

    if (abortSignal?.aborted) {
      throw new Error('YouTube metadata request aborted.');
    }

    return {
      id: videoId,
      title,
      duration,
      author,
      thumbnail_url: thumbnailUrl,
      canonical_url: canonicalUrl
    };
  }
}

export const youtubeService = new YouTubeService();
