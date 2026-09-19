const GEMINI_KEY_PATTERN = /AIza[0-9A-Za-z_-]{20,}/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export function redactSecrets(value: unknown, secrets: readonly string[] = []): string {
  let text = typeof value === 'string' ? value : String(value ?? '');
  const configuredSecrets = secrets.filter(secret => typeof secret === 'string' && secret.length > 0);
  for (const secret of configuredSecrets) {
    text = text.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
  }
  return text.replace(GEMINI_KEY_PATTERN, '[REDACTED]');
}

export function safeErrorMessage(error: unknown, secrets: readonly string[] = []): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const redacted = redactSecrets(raw, secrets).trim();
  return redacted || 'Unknown error';
}
