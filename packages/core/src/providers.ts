/**
 * Supported research/model providers and model-to-provider resolution.
 *
 * Pure module with zero runtime dependencies so core, db, research, worker,
 * web (both server and client components), and preflight scripts all agree
 * on the exact set of supported providers, display names, env vars, and
 * model-id prefixes.
 */

export const RESEARCH_PROVIDERS = ['anthropic', 'openai', 'google'] as const;
export type ResearchProvider = (typeof RESEARCH_PROVIDERS)[number];

export interface ProviderMeta {
  readonly id: ResearchProvider;
  readonly displayName: string;
  /** Deployment environment variable names checked in priority order. */
  readonly envKeys: readonly string[];
  /** Prefix displayed next to a stored 4-char key hint (e.g. "sk-ant-…Ab12"). */
  readonly keyHintPrefix: string;
  /** Example placeholder for key input forms. */
  readonly keyPlaceholder: string;
  /** Human-readable name of the provider's developer console. */
  readonly consoleName: string;
  /** Default first-party API host name for run provenance. */
  readonly firstPartyHost: string;
  /** Default model id when no explicit model is configured for this provider. */
  readonly defaultModel: string;
  /** Default fast/lightweight model id (e.g. for ask_portrait or triage). */
  readonly defaultFastModel: string;
}

export const PROVIDER_META: Readonly<Record<ResearchProvider, ProviderMeta>> = Object.freeze({
  anthropic: Object.freeze({
    id: 'anthropic',
    displayName: 'Anthropic',
    envKeys: ['ANTHROPIC_API_KEY'],
    keyHintPrefix: 'sk-ant-…',
    keyPlaceholder: 'sk-ant-…',
    consoleName: 'Anthropic Console',
    firstPartyHost: 'api.anthropic.com',
    defaultModel: 'claude-sonnet-5',
    defaultFastModel: 'claude-haiku-4-5-20251001',
  }),
  openai: Object.freeze({
    id: 'openai',
    displayName: 'OpenAI',
    envKeys: ['OPENAI_API_KEY'],
    keyHintPrefix: 'sk-…',
    keyPlaceholder: 'sk-…',
    consoleName: 'OpenAI Platform',
    firstPartyHost: 'api.openai.com',
    defaultModel: 'gpt-5',
    defaultFastModel: 'gpt-4.1-mini',
  }),
  google: Object.freeze({
    id: 'google',
    displayName: 'Google Gemini',
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    keyHintPrefix: 'AIza…',
    keyPlaceholder: 'AIza…',
    consoleName: 'Google AI Studio',
    firstPartyHost: 'generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-pro',
    defaultFastModel: 'gemini-2.5-flash',
  }),
});

export function isResearchProvider(value: unknown): value is ResearchProvider {
  return typeof value === 'string' && (RESEARCH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Parse an explicit provider setting (e.g. `RESEARCH_PROVIDER`,
 * `VERIFIER_PROVIDER`, `ASK_PORTRAIT_PROVIDER`), accepting `'gemini'` as an
 * ergonomic alias for `'google'`. Returns `null` when unset or unrecognized.
 */
export function parseResearchProvider(value: string | null | undefined): ResearchProvider | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'gemini') return 'google';
  return isResearchProvider(normalized) ? normalized : null;
}

/**
 * Infer the provider from a model ID:
 * - `claude-*` (and bare Claude aliases `sonnet`, `opus`, `haiku`) -> `'anthropic'`
 * - `gpt-*`, `o1*`, `o3*`, `o4*`, `chatgpt-*` -> `'openai'`
 * - `gemini-*` (with optional leading `models/`) -> `'google'`
 * Falls back to `fallback` (default `'anthropic'`) when unrecognized or empty.
 */
export function providerForModel(
  modelId: string | null | undefined,
  fallback: ResearchProvider = 'anthropic',
): ResearchProvider {
  const raw = modelId?.trim().toLowerCase();
  if (!raw) return fallback;
  const cleaned = raw.replace(/^models\//, '');
  if (
    cleaned.startsWith('claude-') ||
    cleaned === 'sonnet' ||
    cleaned === 'opus' ||
    cleaned === 'haiku'
  ) {
    return 'anthropic';
  }
  if (
    cleaned.startsWith('gpt-') ||
    cleaned.startsWith('chatgpt-') ||
    /^o[134](?:$|-)/.test(cleaned)
  ) {
    return 'openai';
  }
  if (cleaned.startsWith('gemini-')) {
    return 'google';
  }
  return fallback;
}

/**
 * Resolve the first non-empty deployment API key for `provider` from `env`.
 */
export function resolveProviderEnvKey(
  provider: ResearchProvider,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  for (const keyName of PROVIDER_META[provider].envKeys) {
    const val = env[keyName]?.trim();
    if (val) return val;
  }
  return null;
}

/**
 * Return all providers that have a non-empty deployment API key in `env`,
 * in canonical `RESEARCH_PROVIDERS` order.
 */
export function configuredDeploymentProviders(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResearchProvider[] {
  return RESEARCH_PROVIDERS.filter((p) => resolveProviderEnvKey(p, env) !== null);
}
