import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, safeErrorMessage } from '../src/backend/services/secretRedactor.ts';

test('redactSecrets ersetzt den konfigurierten Schlüssel und typische Gemini-Key-Muster', () => {
  const configured = `AIza${'configured-secret-'.repeat(3)}1234567890`;
  const genericGeminiKey = `AIza${'x'.repeat(32)}`;
  const message = `request failed with ${configured}; fallback=${genericGeminiKey}`;

  const redacted = redactSecrets(message, [configured]);

  assert.equal(redacted.includes(configured), false);
  assert.equal(redacted.includes(genericGeminiKey), false);
  assert.equal(redacted.includes('[REDACTED]'), true);
});

test('safeErrorMessage gibt nur eine redigierte, nichtleere Fehlermeldung zurück', () => {
  const configured = `AIza${'configured-secret-'.repeat(3)}1234567890`;
  const message = safeErrorMessage(new Error(`provider rejected ${configured}`), [configured]);

  assert.equal(message.includes(configured), false);
  assert.equal(message.includes('[REDACTED]'), true);
});
