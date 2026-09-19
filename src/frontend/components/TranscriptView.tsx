import React, { useState } from 'react';
import { Copy, Check, FileText, AlignLeft, Clock } from 'lucide-react';
import { VideoTranscript } from '../../shared/types';

interface TranscriptViewProps {
  transcript?: VideoTranscript;
}

export const TranscriptView: React.FC<TranscriptViewProps> = ({ transcript }) => {
  const [copiedType, setCopiedType] = useState<'text' | 'json' | null>(null);
  const [viewMode, setViewMode] = useState<'segmented' | 'continuous'>('segmented');

  if (!transcript || (!transcript.full_text && (!transcript.segments || transcript.segments.length === 0))) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-stone-400 dark:text-stone-500">
        <FileText className="w-12 h-12 mb-3 text-stone-300 dark:text-stone-700" />
        <p className="text-sm font-medium text-stone-600 dark:text-stone-400">Kein Transkript vorhanden</p>
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-1 max-w-sm">
          Für diesen Job wurde noch kein Transkript generiert oder im Video wurde keine gesprochene Sprache erkannt.
        </p>
      </div>
    );
  }

  const handleCopyText = () => {
    navigator.clipboard.writeText(transcript.full_text || '');
    setCopiedType('text');
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(transcript, null, 2));
    setCopiedType('json');
    setTimeout(() => setCopiedType(null), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-stone-50 dark:bg-stone-800/40 rounded-xl border border-stone-200 dark:border-stone-800">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('segmented')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'segmented'
                ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs border border-stone-200 dark:border-stone-700'
                : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5 inline mr-1" />
            Mit Zeitstempeln ({transcript.segments?.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setViewMode('continuous')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'continuous'
                ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs border border-stone-200 dark:border-stone-700'
                : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
            }`}
          >
            <AlignLeft className="w-3.5 h-3.5 inline mr-1" />
            Fließtext
          </button>
          {transcript.language && (
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300 uppercase font-mono">
              {transcript.language}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyText}
            className="px-3 py-1.5 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 rounded-lg text-xs font-medium border border-stone-200 dark:border-stone-700 flex items-center gap-1.5 transition-colors shadow-xs"
          >
            {copiedType === 'text' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedType === 'text' ? 'Kopiert!' : 'Text kopieren'}
          </button>
          <button
            type="button"
            onClick={handleCopyJson}
            className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-medium border border-indigo-200 dark:border-indigo-800/60 flex items-center gap-1.5 transition-colors"
          >
            {copiedType === 'json' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedType === 'json' ? 'JSON kopiert!' : 'JSON für n8n'}
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'continuous' ? (
        <div className="p-4 bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 text-sm leading-relaxed text-stone-800 dark:text-stone-200 whitespace-pre-wrap font-serif">
          {transcript.full_text}
        </div>
      ) : (
        <div className="space-y-2">
          {transcript.segments && transcript.segments.length > 0 ? (
            transcript.segments.map((seg, idx) => (
              <div
                key={idx}
                className="p-3 bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700 transition-colors flex items-start gap-3 text-xs"
              >
                <div className="shrink-0 flex flex-col items-start gap-1">
                  <span className="px-2 py-0.5 rounded-md font-mono font-medium text-[11px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/50">
                    {seg.timestamp_display || `${Math.floor(seg.start_seconds / 60)}:${(seg.start_seconds % 60).toString().padStart(2, '0')}`}
                  </span>
                  {seg.speaker && (
                    <span className="text-[10px] text-stone-400 dark:text-stone-500 font-medium">
                      {seg.speaker}
                    </span>
                  )}
                </div>
                <div className="flex-1 text-stone-700 dark:text-stone-300 leading-normal text-xs sm:text-sm">
                  {seg.text}
                </div>
              </div>
            ))
          ) : (
            <div className="p-4 bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 text-sm text-stone-700 dark:text-stone-300">
              {transcript.full_text}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
