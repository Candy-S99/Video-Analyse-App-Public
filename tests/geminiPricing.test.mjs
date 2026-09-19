import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateGeminiCost, getGeminiPricing } from '../src/backend/services/geminiPricing.ts';

test('Gemini pricing uses the dated introductory Standard price for current Flash models', () => {
  const resolved = getGeminiPricing('models/gemini-3.8-flash', new Date('2026-09-13T12:00:00Z'));
  assert.equal(resolved?.period.standard.input_usd_per_million, 0.75);
  assert.equal(resolved?.period.standard.output_usd_per_million, 3.75);

  const cost = estimateGeminiCost('gemini-3.8-flash', { prompt_tokens: 120, candidate_tokens: 25, total_tokens: 145 }, new Date('2026-09-13T12:00:00Z'));
  assert.deepEqual(cost, {
    currency: 'USD',
    input_usd: 0.00009,
    output_usd: 0.00009375,
    estimated_usd: 0.00018375,
    pricing_tier: 'standard',
    pricing_version: '2026-09-13',
    pricing_effective_period: '2026-01-01_through_2026-12-31',
    price_basis: 'paid_standard_per_1m_tokens',
  });
});

test('Gemini pricing switches to the regular price after the introductory period', () => {
  const resolved = getGeminiPricing('gemini-3.8-flash', new Date('2027-01-01T00:00:00Z'));
  assert.equal(resolved?.period.standard.input_usd_per_million, 1.5);
  assert.equal(resolved?.period.standard.output_usd_per_million, 7.5);
});

test('Gemini cost estimate stays unavailable when token components or model pricing are unknown', () => {
  assert.equal(estimateGeminiCost('gemini-3.8-flash', { total_tokens: 145 }), undefined);
  assert.equal(estimateGeminiCost('gemini-unknown', { prompt_tokens: 120, candidate_tokens: 25, total_tokens: 145 }), undefined);
});
