import { JobCostEstimate, JobTokenUsage } from '../../shared/types';

export const GEMINI_PRICING_SOURCE = 'https://ai.google.dev/gemini-api/docs/pricing';
export const GEMINI_PRICING_VERSION = '2026-09-13';

export interface GeminiPriceTier {
  input_usd_per_million: number;
  output_usd_per_million: number;
  cache_usd_per_million?: number;
  storage_usd_per_million_per_hour?: number;
}

export interface GeminiPricingPeriod {
  effective_from: string;
  effective_until?: string;
  standard: GeminiPriceTier;
  batch?: GeminiPriceTier;
  flex?: GeminiPriceTier;
  priority?: GeminiPriceTier;
}

export interface GeminiModelPricing {
  model: string;
  periods: GeminiPricingPeriod[];
  grounding_usd_per_1000_requests_after_free?: number;
  grounding_free_requests_per_month?: number;
  source_url: string;
}

const grounding = {
  grounding_usd_per_1000_requests_after_free: 14,
  grounding_free_requests_per_month: 5000,
};

const flashIntroPeriods = (model: string): GeminiPricingPeriod[] => [
  {
    effective_from: '2026-01-01',
    effective_until: '2026-12-31',
    standard: { input_usd_per_million: 0.75, output_usd_per_million: 3.75, cache_usd_per_million: 0.075, storage_usd_per_million_per_hour: 0.5 },
    batch: { input_usd_per_million: 0.375, output_usd_per_million: 1.875, cache_usd_per_million: 0.0375, storage_usd_per_million_per_hour: 0.5 },
    flex: { input_usd_per_million: 0.375, output_usd_per_million: 1.875, cache_usd_per_million: 0.0375, storage_usd_per_million_per_hour: 0.5 },
    priority: { input_usd_per_million: 1.35, output_usd_per_million: 6.75, cache_usd_per_million: 0.135, storage_usd_per_million_per_hour: 0.5 },
  },
  {
    effective_from: '2027-01-01',
    standard: { input_usd_per_million: 1.5, output_usd_per_million: 7.5, cache_usd_per_million: 0.15, storage_usd_per_million_per_hour: 1 },
    batch: { input_usd_per_million: 0.75, output_usd_per_million: 3.75, cache_usd_per_million: 0.075, storage_usd_per_million_per_hour: 1 },
    flex: { input_usd_per_million: 0.75, output_usd_per_million: 3.75, cache_usd_per_million: 0.075, storage_usd_per_million_per_hour: 1 },
    priority: { input_usd_per_million: 2.7, output_usd_per_million: 13.5, cache_usd_per_million: 0.27, storage_usd_per_million_per_hour: 1 },
  },
];

const fixedPeriods = (standard: GeminiPriceTier, batch: GeminiPriceTier, flex: GeminiPriceTier, priority: GeminiPriceTier): GeminiPricingPeriod[] => [{
  effective_from: '2026-01-01',
  standard,
  batch,
  flex,
  priority,
}];

export const GEMINI_PRICING_CATALOG: Record<string, GeminiModelPricing> = {
  'gemini-3.8-flash': { model: 'gemini-3.8-flash', periods: flashIntroPeriods('gemini-3.8-flash'), ...grounding, source_url: GEMINI_PRICING_SOURCE },
  'gemini-3.7-flash': { model: 'gemini-3.7-flash', periods: flashIntroPeriods('gemini-3.7-flash'), ...grounding, source_url: GEMINI_PRICING_SOURCE },
  'gemini-3.6-flash': { model: 'gemini-3.6-flash', periods: flashIntroPeriods('gemini-3.6-flash'), ...grounding, source_url: GEMINI_PRICING_SOURCE },
  'gemini-3.5-flash': {
    model: 'gemini-3.5-flash',
    periods: fixedPeriods(
      { input_usd_per_million: 1.5, output_usd_per_million: 9, cache_usd_per_million: 0.15, storage_usd_per_million_per_hour: 1 },
      { input_usd_per_million: 0.75, output_usd_per_million: 4.5, cache_usd_per_million: 0.075, storage_usd_per_million_per_hour: 1 },
      { input_usd_per_million: 0.75, output_usd_per_million: 4.5, cache_usd_per_million: 0.08, storage_usd_per_million_per_hour: 1 },
      { input_usd_per_million: 2.7, output_usd_per_million: 16.2, cache_usd_per_million: 0.27, storage_usd_per_million_per_hour: 1 },
    ),
    ...grounding,
    source_url: GEMINI_PRICING_SOURCE,
  },
  'gemini-3.5-flash-lite': {
    model: 'gemini-3.5-flash-lite',
    periods: fixedPeriods(
      { input_usd_per_million: 0.3, output_usd_per_million: 2.5, cache_usd_per_million: 0.03, storage_usd_per_million_per_hour: 1 },
      { input_usd_per_million: 0.15, output_usd_per_million: 1.25, cache_usd_per_million: 0.02, storage_usd_per_million_per_hour: 1 },
      { input_usd_per_million: 0.15, output_usd_per_million: 1.25, cache_usd_per_million: 0.02, storage_usd_per_million_per_hour: 1 },
      { input_usd_per_million: 0.54, output_usd_per_million: 4.5, cache_usd_per_million: 0.05, storage_usd_per_million_per_hour: 1 },
    ),
    ...grounding,
    source_url: GEMINI_PRICING_SOURCE,
  },
  'gemini-3.1-flash-lite': {
    model: 'gemini-3.1-flash-lite',
    periods: fixedPeriods(
      { input_usd_per_million: 0.25, output_usd_per_million: 1.5, cache_usd_per_million: 0.025, storage_usd_per_million_per_hour: 1 },
      { input_usd_per_million: 0.125, output_usd_per_million: 0.75, cache_usd_per_million: 0.0125, storage_usd_per_million_per_hour: 0.5 },
      { input_usd_per_million: 0.125, output_usd_per_million: 0.75, cache_usd_per_million: 0.0125, storage_usd_per_million_per_hour: 0.5 },
      { input_usd_per_million: 0.45, output_usd_per_million: 2.7, cache_usd_per_million: 0.045, storage_usd_per_million_per_hour: 1.8 },
    ),
    ...grounding,
    source_url: GEMINI_PRICING_SOURCE,
  },
};

function normalizeModel(model: string): string {
  return model.trim().replace(/^models\//, '');
}

export function getGeminiPricing(model: string, at: Date = new Date()): { catalog: GeminiModelPricing; period: GeminiPricingPeriod } | undefined {
  const catalog = GEMINI_PRICING_CATALOG[normalizeModel(model)];
  if (!catalog) return undefined;
  const date = at.toISOString().slice(0, 10);
  const period = [...catalog.periods]
    .reverse()
    .find(candidate => candidate.effective_from <= date && (!candidate.effective_until || date <= candidate.effective_until));
  return period ? { catalog, period } : undefined;
}

export function estimateGeminiCost(model: string, usage: JobTokenUsage, at: Date = new Date()): JobCostEstimate | undefined {
  if (typeof usage.prompt_tokens !== 'number' || typeof usage.candidate_tokens !== 'number') return undefined;
  const resolved = getGeminiPricing(model, at);
  if (!resolved) return undefined;

  const inputUsd = usage.prompt_tokens / 1_000_000 * resolved.period.standard.input_usd_per_million;
  const outputUsd = usage.candidate_tokens / 1_000_000 * resolved.period.standard.output_usd_per_million;
  return {
    currency: 'USD',
    input_usd: inputUsd,
    output_usd: outputUsd,
    estimated_usd: inputUsd + outputUsd,
    pricing_tier: 'standard',
    pricing_version: GEMINI_PRICING_VERSION,
    pricing_effective_period: resolved.period.effective_until ? `${resolved.period.effective_from}_through_${resolved.period.effective_until}` : `${resolved.period.effective_from}_onward`,
    price_basis: 'paid_standard_per_1m_tokens',
  };
}
