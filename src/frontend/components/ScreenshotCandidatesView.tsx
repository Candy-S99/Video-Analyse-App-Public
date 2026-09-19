import React from 'react';
import { ScreenshotCandidate } from '../../shared/types';
import { Camera, CheckCircle2, Eye, Image as ImageIcon } from 'lucide-react';

interface ScreenshotCandidatesViewProps {
  candidates?: ScreenshotCandidate[];
}

export const ScreenshotCandidatesView: React.FC<ScreenshotCandidatesViewProps> = ({ candidates }) => {
  if (!candidates || candidates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-stone-400 dark:text-stone-500">
        <Camera className="w-12 h-12 mb-3 text-stone-300 dark:text-stone-700" />
        <p className="text-sm font-medium text-stone-600 dark:text-stone-400">Keine Screenshot-Kandidaten</p>
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-1 max-w-sm">
          Sobald Stufe 2 der Analyse abgeschlossen ist, werden hier die konsolidierten Screenshot-Zustände gelistet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400 px-1">
        <span>{candidates.length} konsolidierte Schlüsselmomente identifiziert</span>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        {candidates.map((cand) => (
          <div
            key={cand.candidate_id}
            className="p-3.5 bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 hover:border-indigo-200 dark:hover:border-indigo-900 transition-all flex flex-col gap-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md font-mono text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/50">
                  {cand.timestamp_display}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 font-medium">
                  {cand.category}
                </span>
                {cand.visual_only && (
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 font-medium flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    Visual-Only
                  </span>
                )}
                {cand.screenshot_recommended && (
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Empfohlen
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0 text-xs font-mono">
                <span className="text-stone-400 dark:text-stone-500 text-[10px]">Score:</span>
                <span className={`px-1.5 py-0.5 rounded-md font-bold text-xs ${
                  cand.information_score >= 80 
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' 
                    : cand.information_score >= 50
                    ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400'
                }`}>
                  {cand.information_score}
                </span>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-stone-800 dark:text-stone-200 leading-relaxed">
              {cand.visual_description}
            </p>

            {!!cand.screenshots?.length && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1" aria-label={`Screenshots für ${cand.timestamp_display}`}>
                {cand.screenshots.map((shot) => (
                  <a key={shot.screenshot_id} href={shot.api_url} target="_blank" rel="noreferrer" className="group rounded-lg overflow-hidden border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800">
                    {shot.retention_status === 'PURGED' ? <div className="aspect-video grid place-items-center text-[10px] text-stone-500"><ImageIcon className="w-4 h-4" />Bereinigt</div> : <img src={shot.api_url} alt={`Originalframe ${cand.timestamp_display}`} className="w-full aspect-video object-cover group-hover:scale-[1.02] transition-transform" />}
                    <div className="px-1.5 py-1 text-[10px] font-medium text-stone-600 dark:text-stone-300">{shot.role === 'PRIMARY' ? 'Primärframe' : 'Variante'} · {shot.extraction_timestamp_seconds.toFixed(1)}s</div>
                  </a>
                ))}
              </div>
            )}

            <div className="text-[10px] text-stone-400 dark:text-stone-500 font-mono flex items-center gap-3 pt-1 border-t border-stone-100 dark:border-stone-800/60">
              <span>Segment #{cand.source_segment}</span>
              {cand.duplicate_group && <span>Gruppe: {cand.duplicate_group}</span>}
              <span>Sekunde {cand.timestamp_seconds}s</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
