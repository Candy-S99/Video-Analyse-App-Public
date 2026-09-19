export const GEMINI_MODEL_OPTIONS = [
  { id: 'gemini-3.8-flash', name: 'gemini-3.8-flash', tag: 'Neuestes Flash-Modell (Empfohlen / Höchste Quota)' },
  { id: 'gemini-3.7-flash', name: 'gemini-3.7-flash', tag: 'Schnell & hochpräzise' },
  { id: 'gemini-3.6-flash', name: 'gemini-3.6-flash', tag: 'Standard-Flash' },
  { id: 'gemini-3.5-flash', name: 'gemini-3.5-flash', tag: 'Solide Ausweich-Option' },
] as const;

export const SEGMENT_LENGTH_OPTIONS = [15, 30, 60, 90, 120, 180] as const;
