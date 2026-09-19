import React, { useState, useEffect } from 'react';
import { X, Check, Save, Cpu, Clock, FileText, Key, Folder, AlertCircle, Eye, EyeOff, Trash2 } from 'lucide-react';
import { AppConfig } from '../../shared/types';
import { GEMINI_MODEL_OPTIONS, SEGMENT_LENGTH_OPTIONS } from '../config/quickSettings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AppConfig | null;
  onSave: (newConfig: Partial<AppConfig>) => Promise<boolean>;
  onSaveApiKey: (apiKey: string) => Promise<boolean>;
  onDeleteApiKey: () => Promise<boolean>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
  onSaveApiKey,
  onDeleteApiKey,
}) => {
  const [model, setModel] = useState(config?.model || 'gemini-3.8-flash');
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customModelName, setCustomModelName] = useState('');
  const [segmentLength, setSegmentLength] = useState<number>(config?.segment_length_seconds || 60);
  const [extractTranscript, setExtractTranscript] = useState<boolean>(config?.extract_transcript ?? true);
  const [fineWindow, setFineWindow] = useState(config?.fine_search_window_seconds ?? 2);
  const [fineInterval, setFineInterval] = useState(config?.fine_search_interval_seconds ?? 0.5);
  const [maxScreenshots, setMaxScreenshots] = useState(config?.max_screenshots_per_candidate ?? 4);
  const [fallback, setFallback] = useState<'exact_timestamp' | 'skip'>(config?.fine_search_fallback ?? 'exact_timestamp');
  const [automaticCleanup, setAutomaticCleanup] = useState(config?.automatic_cleanup_enabled ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [apiKeyMessage, setApiKeyMessage] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');

  useEffect(() => {
    if (config) {
      const match = GEMINI_MODEL_OPTIONS.find(m => m.id === config.model);
      if (match) {
        setModel(match.id);
        setIsCustomModel(false);
      } else {
        setModel('custom');
        setIsCustomModel(true);
        setCustomModelName(config.model);
      }
      setSegmentLength(config.segment_length_seconds || 60);
      setExtractTranscript(config.extract_transcript ?? true);
      setFineWindow(config.fine_search_window_seconds ?? 2); setFineInterval(config.fine_search_interval_seconds ?? .5); setMaxScreenshots(config.max_screenshots_per_candidate ?? 4); setFallback(config.fine_search_fallback ?? 'exact_timestamp'); setAutomaticCleanup(config.automatic_cleanup_enabled ?? true);
      setApiKey('');
      setShowApiKey(false);
      setApiKeyMessage(config.gemini_api_key_configured ? 'API Key gespeichert.' : 'Kein API Key gespeichert.');
      setApiKeyError('');
    }
  }, [config, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess(false);

    const finalModel = isCustomModel ? customModelName.trim() : model;
    if (!finalModel) {
      setSaveError('Bitte gib einen Modellnamen an.');
      setIsSaving(false);
      return;
    }

    const success = await onSave({
      model: finalModel,
      segment_length_seconds: segmentLength,
      extract_transcript: extractTranscript,
      fine_search_window_seconds: fineWindow, fine_search_interval_seconds: fineInterval, max_screenshots_per_candidate: maxScreenshots, fine_search_fallback: fallback, automatic_cleanup_enabled: automaticCleanup,
    });

    setIsSaving(false);
    if (success) {
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 900);
    } else {
      setSaveError('Fehler beim Speichern der Konfiguration.');
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      setApiKeyError('Bitte gib einen API Key ein.');
      return;
    }
    setIsSavingApiKey(true);
    setApiKeyError('');
    setApiKeyMessage('');
    const success = await onSaveApiKey(apiKey);
    setIsSavingApiKey(false);
    if (success) {
      setApiKey('');
      setShowApiKey(false);
      setApiKeyMessage('API Key gespeichert.');
    } else {
      setApiKeyError('API Key konnte nicht gespeichert werden.');
    }
  };

  const handleDeleteApiKey = async () => {
    if (!window.confirm('API Key wirklich entfernen? Neue Analysen benötigen danach erneut einen Key.')) return;
    setIsSavingApiKey(true);
    setApiKeyError('');
    const success = await onDeleteApiKey();
    setIsSavingApiKey(false);
    if (success) {
      setApiKey('');
      setApiKeyMessage('Kein API Key gespeichert.');
    } else {
      setApiKeyError('API Key konnte nicht entfernt werden.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs transition-opacity animate-in fade-in">
      <div 
        id="settings-modal-card"
        className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900 dark:text-stone-100">Service-Einstellungen</h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">Modell, Segmentierung & Transkript-Konfiguration</p>
            </div>
          </div>
          <button
            id="settings-close-button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          {/* Gemini Model Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-500" />
              Gemini LLM-Modell
            </label>
            <div className="grid grid-cols-1 gap-2">
              {GEMINI_MODEL_OPTIONS.map((item) => (
                <label
                  key={item.id}
                  className={`flex items-start justify-between p-3 rounded-xl border text-sm cursor-pointer transition-all ${
                    !isCustomModel && model === item.id
                      ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-900 dark:text-indigo-200 font-medium'
                      : 'border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/50 text-stone-700 dark:text-stone-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="gemini_model"
                      checked={!isCustomModel && model === item.id}
                      onChange={() => {
                        setModel(item.id);
                        setIsCustomModel(false);
                      }}
                      className="text-indigo-600 focus:ring-indigo-500 mt-0.5"
                    />
                    <div>
                      <div className="font-mono text-xs">{item.name}</div>
                      <div className="text-[11px] text-stone-500 dark:text-stone-400">{item.tag}</div>
                    </div>
                  </div>
                </label>
              ))}

              <label
                className={`flex items-center gap-2.5 p-3 rounded-xl border text-sm cursor-pointer transition-all ${
                  isCustomModel
                    ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-900 dark:text-indigo-200'
                    : 'border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/50 text-stone-700 dark:text-stone-300'
                }`}
              >
                <input
                  type="radio"
                  name="gemini_model"
                  checked={isCustomModel}
                  onChange={() => {
                    setIsCustomModel(true);
                    setModel('custom');
                  }}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs">Benutzerdefiniertes Modell angeben</span>
              </label>

              {isCustomModel && (
                <div className="pl-6 pt-1">
                  <input
                    type="text"
                    placeholder="z.B. gemini-3.8-flash oder experimental-model"
                    value={customModelName}
                    onChange={(e) => setCustomModelName(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-xl text-xs font-mono text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Segment Length */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-indigo-500" />
              Segmentlänge (Sekunden)
            </label>
            <div className="flex gap-2">
              {SEGMENT_LENGTH_OPTIONS.map((sec) => (
                <button
                  id={`settings-segment-option-${sec}`}
                  type="button"
                  key={sec}
                  onClick={() => setSegmentLength(sec)}
                  className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-medium border transition-all ${
                    segmentLength === sec
                      ? 'border-indigo-600 bg-indigo-600 text-white shadow-xs'
                      : 'border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              15s eignet sich für eine besonders feingranulare Analyse. 60s–120s bietet meist eine gute Balance aus Detailgrad und API-Quota-Schutz.
            </p>
          </div>

          {/* Extract Transcript Toggle */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-stone-100 dark:border-stone-800">
            <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Feinsuchfenster (s)<input type="number" min="0.1" step="0.1" value={fineWindow} onChange={e => setFineWindow(Number(e.target.value))} className="mt-1 w-full px-2 py-1.5 rounded-lg border dark:bg-stone-800" /></label>
            <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Intervall (s)<input type="number" min="0.1" step="0.1" value={fineInterval} onChange={e => setFineInterval(Number(e.target.value))} className="mt-1 w-full px-2 py-1.5 rounded-lg border dark:bg-stone-800" /></label>
            <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Max. Bilder/Kandidat<select value={maxScreenshots} onChange={e => setMaxScreenshots(Number(e.target.value))} className="mt-1 w-full px-2 py-1.5 rounded-lg border dark:bg-stone-800">{[1,2,3,4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">Fallback<select value={fallback} onChange={e => setFallback(e.target.value as 'exact_timestamp' | 'skip')} className="mt-1 w-full px-2 py-1.5 rounded-lg border dark:bg-stone-800"><option value="exact_timestamp">Exakter Zeitpunkt</option><option value="skip">Überspringen</option></select></label>
            <p className="col-span-2 text-[11px] text-stone-500 dark:text-stone-400 rounded-lg bg-stone-50 dark:bg-stone-800/50 px-3 py-2">
              Vollständige Analysejobs werden automatisch im Ordner „output“ neben dieser Installation gespeichert.
            </p>
            <label className="col-span-2 flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300"><input type="checkbox" checked={automaticCleanup} onChange={e => setAutomaticCleanup(e.target.checked)} />Automatische 60-Tage-Bereinigung aktivieren</label>
          </div>

          {/* Extract Transcript Toggle */}
          <div className="pt-2 border-t border-stone-100 dark:border-stone-800">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={extractTranscript}
                onChange={(e) => setExtractTranscript(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 border-stone-300 dark:border-stone-700"
              />
              <div>
                <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-indigo-500" />
                  Vollständiges Audio-Transkript extrahieren
                </span>
                <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
                  Extrahiert das gesprochene Wort mit Zeitstempeln und strukturiertem Volltext sowohl für die App-Ansicht als auch für n8n.
                </p>
              </div>
            </label>
          </div>

          <div className="pt-2 border-t border-stone-100 dark:border-stone-800 space-y-2">
            <label htmlFor="gemini-api-key-input" className="text-xs font-semibold text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-indigo-500" />
              Gemini API Key
            </label>
            <div className="flex gap-2">
              <input
                id="gemini-api-key-input"
                type={showApiKey ? 'text' : 'password'}
                autoComplete="new-password"
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
                placeholder="Neuen API Key eingeben"
                className="min-w-0 flex-1 px-3 py-2 bg-stone-50 dark:bg-stone-800/60 border border-stone-300 dark:border-stone-700 rounded-xl text-xs font-mono text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button type="button" onClick={() => setShowApiKey(value => !value)} title={showApiKey ? 'Key ausblenden' : 'Neue Eingabe anzeigen'} className="px-2.5 rounded-xl border border-stone-200 dark:border-stone-700 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className={`text-[11px] ${config?.gemini_api_key_configured ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {apiKeyMessage || (config?.gemini_api_key_configured ? 'API Key gespeichert.' : 'Kein API Key gespeichert.')}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleSaveApiKey} disabled={isSavingApiKey || !apiKey.trim()} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> API Key speichern
              </button>
              <button type="button" onClick={handleDeleteApiKey} disabled={isSavingApiKey || !config?.gemini_api_key_configured} className="px-3 py-1.5 border border-red-200 dark:border-red-900/70 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-40">
                <Trash2 className="w-3.5 h-3.5" /> API Key entfernen
              </button>
            </div>
            {apiKeyError && <p className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{apiKeyError}</p>}
          </div>

          {/* Environment Status Info */}
          <div className="p-3.5 bg-stone-50 dark:bg-stone-800/50 rounded-xl border border-stone-200 dark:border-stone-800 space-y-2 text-xs">
            <div className="flex items-center justify-between text-stone-600 dark:text-stone-400">
              <span className="flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-stone-400" />
                Gemini API Key:
              </span>
              <span className={`font-medium ${config?.gemini_api_key_configured ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {config?.gemini_api_key_configured ? 'Gespeichert' : 'Nicht hinterlegt'}
              </span>
            </div>
            <div className="flex items-center justify-between text-stone-600 dark:text-stone-400">
              <span className="flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-stone-400" />
                Datenverzeichnis:
              </span>
              <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400 truncate max-w-[200px]">
                {config?.data_dir || '/data/jobs'}
              </span>
            </div>
          </div>

          {saveError && (
            <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-xl transition-colors"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition-colors"
            >
              {saveSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  Gespeichert
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {isSaving ? 'Speichere...' : 'Einstellungen übernehmen'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
