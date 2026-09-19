import React from 'react';
import { AlertCircle, Download, File, FileText, Image as ImageIcon, Loader2, Video, X } from 'lucide-react';
import type { JobOutputArtifact, JobOutputListing } from '../../shared/types';

interface OutputArtifactsDialogProps {
  isOpen: boolean;
  jobId: string;
  jobTitle?: string;
  listing: JobOutputListing | null;
  loading: boolean;
  error: string;
  selectedArtifact: JobOutputArtifact | null;
  previewText: string;
  previewLoading: boolean;
  artifactUrl: (relativePath: string, download?: boolean) => string;
  onClose: () => void;
  onSelectArtifact: (artifact: JobOutputArtifact) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ArtifactIcon({ preview_kind, mime_type }: Pick<JobOutputArtifact, 'preview_kind' | 'mime_type'>) {
  if (preview_kind === 'image') return <ImageIcon className="w-4 h-4 text-indigo-500" />;
  if (mime_type === 'video/mp4') return <Video className="w-4 h-4 text-rose-500" />;
  if (preview_kind === 'text') return <FileText className="w-4 h-4 text-emerald-500" />;
  return <File className="w-4 h-4 text-stone-500" />;
}

export const OutputArtifactsDialog: React.FC<OutputArtifactsDialogProps> = ({
  isOpen,
  jobId,
  jobTitle,
  listing,
  loading,
  error,
  selectedArtifact,
  previewText,
  previewLoading,
  artifactUrl,
  onClose,
  onSelectArtifact,
}) => {
  if (!isOpen) return null;

  return (
    <div id="output-artifacts-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 backdrop-blur-sm p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="output-artifacts-title">
      <section className="w-full max-w-6xl h-[min(90vh,900px)] bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 shadow-2xl flex flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 p-4 border-b border-stone-200 dark:border-stone-800">
          <div className="min-w-0">
            <h2 id="output-artifacts-title" className="font-semibold text-stone-900 dark:text-stone-100 truncate">Output-Artefakte</h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 truncate">{jobTitle || jobId}</p>
          </div>
          <button id="output-close-button" type="button" onClick={onClose} className="p-2 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" aria-label="Output-Ansicht schließen">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(240px,0.35fr)_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-stone-200 dark:border-stone-800 p-3">
            {loading && <div className="flex items-center gap-2 p-3 text-sm text-stone-500"><Loader2 className="w-4 h-4 animate-spin" /> Output wird geladen …</div>}
            {error && !loading && <div className="flex items-start gap-2 p-3 text-sm text-red-600 dark:text-red-400"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}</div>}
            {!loading && !error && listing && (
              <div className="space-y-1">
                <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{listing.artifacts.length} Dateien</p>
                {listing.artifacts.map((artifact, index) => (
                  <button
                    key={artifact.relative_path}
                    id={`output-artifact-row-${jobId}-${index}`}
                    type="button"
                    onClick={() => onSelectArtifact(artifact)}
                    className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${selectedArtifact?.relative_path === artifact.relative_path ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200' : 'hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300'}`}
                    aria-label={`${artifact.relative_path}, ${formatBytes(artifact.size_bytes)}`}
                  >
                    <ArtifactIcon preview_kind={artifact.preview_kind} mime_type={artifact.mime_type} />
                    <span className="min-w-0 flex-1 truncate text-xs">{artifact.file_name}</span>
                    <span className="text-[10px] text-stone-400 shrink-0">{formatBytes(artifact.size_bytes)}</span>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="min-h-0 overflow-auto p-4 sm:p-6 bg-stone-50/60 dark:bg-stone-950/30">
            {!selectedArtifact && !loading && !error && <div className="h-full flex items-center justify-center text-sm text-stone-400">Wähle eine Datei zur Vorschau aus.</div>}
            {selectedArtifact?.preview_kind === 'image' && <img id={`output-preview-${jobId}`} src={artifactUrl(selectedArtifact.relative_path)} alt={selectedArtifact.file_name} className="max-w-full max-h-full mx-auto object-contain rounded-lg border border-stone-200 dark:border-stone-700" />}
            {selectedArtifact?.preview_kind === 'text' && (
              <div id={`output-preview-${jobId}`} className="h-full flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200 truncate">{selectedArtifact.relative_path}</h3>
                  <a className="inline-flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 text-xs text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-800" href={artifactUrl(selectedArtifact.relative_path, true)} download>
                    <Download className="w-3.5 h-3.5" /> Download
                  </a>
                </div>
                {previewLoading ? <div className="flex items-center gap-2 text-sm text-stone-500"><Loader2 className="w-4 h-4 animate-spin" /> Vorschau wird geladen …</div> : <pre className="flex-1 min-h-0 overflow-auto whitespace-pre-wrap rounded-xl bg-stone-900 text-stone-100 p-4 text-xs leading-relaxed">{previewText}</pre>}
              </div>
            )}
            {selectedArtifact?.preview_kind === 'none' && (
              <div id={`output-preview-${jobId}`} className="h-full flex flex-col items-center justify-center gap-3 text-center">
                <Video className="w-10 h-10 text-stone-300 dark:text-stone-600" />
                <p className="text-sm text-stone-500 dark:text-stone-400">Für diese Datei gibt es keine Inline-Vorschau.</p>
                <a className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold" href={artifactUrl(selectedArtifact.relative_path, true)} download>
                  <Download className="w-3.5 h-3.5" /> Datei herunterladen
                </a>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
};
