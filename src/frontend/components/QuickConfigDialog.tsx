import { useEffect, useState } from 'react';
import { Check, Clock, Cpu, Loader2, X } from 'lucide-react';
import { AppConfig } from '../../shared/types';
import { GEMINI_MODEL_OPTIONS, SEGMENT_LENGTH_OPTIONS } from '../config/quickSettings';

export type QuickConfigPanel = 'model' | 'segment';

interface QuickConfigDialogProps {
  panel: QuickConfigPanel;
  config: AppConfig;
  onClose: () => void;
  onSave: (patch: Partial<AppConfig>) => Promise<boolean>;
}

export function QuickConfigDialog({ panel, config, onClose, onSave }: QuickConfigDialogProps) {
  const [model, setModel] = useState(config.model);
  const [customModelName, setCustomModelName] = useState(config.model);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [segmentLength, setSegmentLength] = useState(config.segment_length_seconds);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const isPresetModel = GEMINI_MODEL_OPTIONS.some(option => option.id === config.model);
    setModel(config.model);
    setCustomModelName(isPresetModel ? '' : config.model);
    setIsCustomModel(!isPresetModel);
    setSegmentLength(config.segment_length_seconds);
    setSaveError('');
  }, [config, panel]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isSaving, onClose]);

  const handleSave = async () => {
    const selectedModel = isCustomModel ? customModelName.trim() : model;
    if (panel === 'model' && !selectedModel) {
      setSaveError('Bitte gib einen Modellnamen an.');
      return;
    }

    setIsSaving(true);
    setSaveError('');
    const saved = await onSave(
      panel === 'model'
        ? { model: selectedModel }
        : { segment_length_seconds: segmentLength },
    );
    setIsSaving(false);

    if (saved) {
      onClose();
    } else {
      setSaveError('Schnelleinstellung konnte nicht gespeichert werden.');
    }
  };

  const title = panel === 'model' ? 'Gemini-Modell auswählen' : 'Segmentlänge auswählen';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-stone-950/55 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <section
        id="quick-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-config-title"
        className="w-full max-w-md rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-700 dark:bg-stone-900"
      >
        <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-5 py-4 dark:border-stone-800">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-2 text-indigo-600 dark:border-indigo-900/50 dark:bg-indigo-950/50 dark:text-indigo-300">
              {panel === 'model' ? <Cpu className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            </div>
            <div>
              <h2 id="quick-config-title" className="text-sm font-bold text-stone-900 dark:text-stone-100">{title}</h2>
              <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">Die Änderung gilt für neu gestartete Analysen.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Schnelleinstellung schließen"
            className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          {panel === 'model' ? (
            <div className="space-y-2">
              {GEMINI_MODEL_OPTIONS.map(option => (
                <button
                  id={`quick-model-option-${option.id}`}
                  type="button"
                  key={option.id}
                  onClick={() => {
                    setModel(option.id);
                    setIsCustomModel(false);
                  }}
                  className={`flex w-full items-start justify-between rounded-xl border p-3 text-left transition-colors ${
                    !isCustomModel && model === option.id
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-950 dark:bg-indigo-950/40 dark:text-indigo-100'
                      : 'border-stone-200 text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
                  }`}
                >
                  <span>
                    <span className="block font-mono text-xs font-semibold">{option.name}</span>
                    <span className="mt-1 block text-[11px] text-stone-500 dark:text-stone-400">{option.tag}</span>
                  </span>
                  {!isCustomModel && model === option.id && <Check className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" />}
                </button>
              ))}
              <label className={`block rounded-xl border p-3 transition-colors ${isCustomModel ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-stone-200 dark:border-stone-700'}`}>
                <span className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-stone-200">
                  <input
                    type="radio"
                    name="quick-gemini-model"
                    checked={isCustomModel}
                    onChange={() => {
                      setIsCustomModel(true);
                      if (GEMINI_MODEL_OPTIONS.some(option => option.id === model)) setCustomModelName('');
                    }}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  Benutzerdefiniertes Modell
                </span>
                {isCustomModel && (
                  <input
                    id="quick-model-custom-input"
                    type="text"
                    value={customModelName}
                    onChange={event => setCustomModelName(event.target.value)}
                    placeholder="z. B. gemini-3.8-flash"
                    className="mt-3 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                  />
                )}
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {SEGMENT_LENGTH_OPTIONS.map(option => (
                <button
                  id={`quick-segment-option-${option}`}
                  type="button"
                  key={option}
                  onClick={() => setSegmentLength(option)}
                  className={`rounded-xl border px-3 py-3 text-sm font-semibold transition-colors ${
                    segmentLength === option
                      ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                      : 'border-stone-200 text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
                  }`}
                >
                  {option}s
                </button>
              ))}
            </div>
          )}

          {saveError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{saveError}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-stone-100 px-5 py-4 dark:border-stone-800">
          <button
            id="quick-config-cancel"
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-xl px-3 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 disabled:opacity-50 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            Abbrechen
          </button>
          <button
            id="quick-config-save"
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {isSaving ? 'Speichere …' : 'Speichern'}
          </button>
        </div>
      </section>
    </div>
  );
}
