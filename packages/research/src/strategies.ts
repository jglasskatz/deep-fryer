import { createHash } from 'node:crypto';
import type { ResearchCaps, ResearchModels, StrategyName } from '@deep-fryer/core';

/**
 * The research strategy registry. An entry is the complete set of settings
 * a run is planned with — which model researches, scouts, verifies and
 * reads fetched pages, and how many turns each kind of session may take —
 * under a name and a version. Entries never change once published: a
 * different setting is a new version of the same name, so "standard v1"
 * means the same thing on every run that names it, and two runs can be
 * compared by what they record. strategies.test.ts holds a fingerprint of
 * every published entry and fails when one is edited in place.
 *
 * Literal values on purpose: an entry must not follow a constant elsewhere,
 * or changing that constant would change every plan that names the entry.
 */
export interface StrategyModels extends ResearchModels {
  page_reader_model: string;
}

export interface StrategyEntry {
  readonly name: StrategyName;
  readonly version: number;
  readonly models: Readonly<StrategyModels>;
  readonly caps: Readonly<ResearchCaps>;
  /**
   * When true, this published version is available explicitly via `name@version`
   * (e.g. `standard@2`, `hybrid@2`, `deep@2`) while unversioned `latestStrategy(name)`
   * keeps the current default version until promoted after live bake-off.
   */
  readonly optIn?: boolean;
}

/** The page reader the deployment pinned when strategies were introduced (docker-compose.yml). */
const HAIKU_4_5_PAGE_READER = 'claude-haiku-4-5-20251001';
/** Claude 5.5 page reader / scout model for v2 opt-in strategies (P2.1). */
const HAIKU_5_5_FAST_MODEL = 'claude-haiku-5-5';

function frozen(entry: StrategyEntry): StrategyEntry {
  Object.freeze(entry.models);
  Object.freeze(entry.caps);
  return Object.freeze(entry);
}

export const STRATEGIES: readonly StrategyEntry[] = Object.freeze([
  frozen({
    name: 'standard',
    version: 1,
    models: {
      session_model: 'claude-sonnet-5',
      subagent_model: null,
      verifier_model: 'claude-opus-5',
      page_reader_model: HAIKU_4_5_PAGE_READER,
    },
    caps: { session_max_turns: 60, verifier_max_turns: 12, audit_max_turns: 16 },
  }),
  frozen({
    name: 'deep',
    version: 1,
    models: {
      session_model: 'claude-opus-5',
      subagent_model: 'claude-sonnet-5',
      verifier_model: 'claude-opus-5',
      page_reader_model: HAIKU_4_5_PAGE_READER,
    },
    caps: { session_max_turns: 60, verifier_max_turns: 12, audit_max_turns: 16 },
  }),
  // Tiered strategy (docs/strategy-findings.md): Sonnet researches first;
  // only indicators that end in a gap or fail independent verification
  // escalate to a bounded Opus deep-discovery pass with Sonnet scouts.
  frozen({
    name: 'hybrid',
    version: 1,
    models: {
      session_model: 'claude-sonnet-5',
      subagent_model: 'claude-sonnet-5',
      escalation_model: 'claude-opus-5',
      verifier_model: 'claude-opus-5',
      page_reader_model: HAIKU_4_5_PAGE_READER,
    },
    caps: { session_max_turns: 60, verifier_max_turns: 12, audit_max_turns: 16, escalation_max_turns: 40 },
  }),
  // What a plan records when nobody chose a strategy: these models are the
  // fallbacks, and the operator's settings at planning time replace them
  // (operatorDefaultModels). The resolved models are what the plan keeps.
  frozen({
    name: 'operator-defaults',
    version: 1,
    models: {
      session_model: 'claude-sonnet-5',
      subagent_model: null,
      verifier_model: 'claude-opus-5',
      page_reader_model: HAIKU_4_5_PAGE_READER,
    },
    caps: { session_max_turns: 60, verifier_max_turns: 12, audit_max_turns: 16 },
  }),
  // Claude 5.5 immutable v2 strategies (P2.1): opt-in via explicit `standard@2`,
  // `deep@2`, `hybrid@2` while unversioned names remain on v1 until promoted.
  // Pairs Sonnet 5.5 / Opus 5.5 with Haiku 5.5 scouts & page reader and the
  // direct zero-subprocess <= 4-turn verifier cap.
  frozen({
    name: 'standard',
    version: 2,
    models: {
      session_model: 'claude-sonnet-5-5',
      subagent_model: null,
      verifier_model: 'claude-opus-5-5',
      page_reader_model: HAIKU_5_5_FAST_MODEL,
    },
    caps: { session_max_turns: 60, verifier_max_turns: 4, audit_max_turns: 16 },
    optIn: true,
  }),
  frozen({
    name: 'deep',
    version: 2,
    models: {
      session_model: 'claude-opus-5-5',
      subagent_model: HAIKU_5_5_FAST_MODEL,
      verifier_model: 'claude-opus-5-5',
      page_reader_model: HAIKU_5_5_FAST_MODEL,
    },
    caps: { session_max_turns: 60, verifier_max_turns: 4, audit_max_turns: 16 },
    optIn: true,
  }),
  frozen({
    name: 'hybrid',
    version: 2,
    models: {
      session_model: 'claude-sonnet-5-5',
      subagent_model: HAIKU_5_5_FAST_MODEL,
      escalation_model: 'claude-opus-5-5',
      verifier_model: 'claude-opus-5-5',
      page_reader_model: HAIKU_5_5_FAST_MODEL,
    },
    caps: { session_max_turns: 60, verifier_max_turns: 4, audit_max_turns: 16, escalation_max_turns: 40 },
    optIn: true,
  }),
]);

export const OPERATOR_DEFAULTS: StrategyName = 'operator-defaults';

/** `name@version`, the form the measurement script and the run records use. */
export function strategyRef(entry: Pick<StrategyEntry, 'name' | 'version'>): string {
  return `${entry.name}@${entry.version}`;
}

/**
 * The newest active version of a name, or undefined for a name the registry does
 * not hold. Opt-in versions (`optIn: true`, e.g. v2 5.5 strategies) are skipped
 * unless `includeOptIn: true` is passed (or every entry for that name is opt-in),
 * and are always selectable explicitly via `resolveStrategy('standard@2')`.
 */
export function latestStrategy(
  name: string,
  options: { includeOptIn?: boolean } = {},
): StrategyEntry | undefined {
  const all = STRATEGIES.filter((e) => e.name === name);
  const candidates = options.includeOptIn ? all : all.filter((e) => !e.optIn);
  const pool = candidates.length > 0 ? candidates : all;
  return pool.reduce<StrategyEntry | undefined>(
    (best, e) => (!best || e.version > best.version ? e : best),
    undefined,
  );
}

/** One exact entry. */
export function strategyEntry(name: string, version: number): StrategyEntry | undefined {
  return STRATEGIES.find((e) => e.name === name && e.version === version);
}

/**
 * Pure: the entry a reference names — `deep` for the newest deep, `deep@1`
 * for that version exactly. Throws, naming what exists, for anything else.
 */
export function resolveStrategy(ref: string): StrategyEntry {
  const match = /^([a-z][a-z-]*)(?:@([1-9]\d*))?$/.exec(ref.trim());
  const entry = match
    ? match[2] ? strategyEntry(match[1]!, Number(match[2])) : latestStrategy(match[1]!)
    : undefined;
  if (!entry) {
    throw new Error(`unknown research strategy "${ref}"; known: ${STRATEGIES.map(strategyRef).join(', ')}`);
  }
  return entry;
}

/**
 * Pure: the models a plan with no chosen strategy records — the operator's
 * settings where given (blank counts as not given), the entry's fallbacks
 * otherwise. A scout is only on when a scout model is set.
 */
export function operatorDefaultModels(
  entry: StrategyEntry,
  settings: Partial<Record<keyof StrategyModels, string | null | undefined>> = {},
): StrategyModels {
  const set = (value: string | null | undefined) => (value?.trim() ? value.trim() : undefined);
  return {
    session_model: set(settings.session_model) ?? entry.models.session_model,
    subagent_model: set(settings.subagent_model) ?? entry.models.subagent_model,
    verifier_model: set(settings.verifier_model) ?? entry.models.verifier_model,
    page_reader_model: set(settings.page_reader_model) ?? entry.models.page_reader_model,
  };
}

/**
 * A stable digest of everything an entry fixes. Keys are sorted so the
 * digest depends on values only, never on the order fields were written in.
 */
export function strategyFingerprint(entry: StrategyEntry): string {
  const canonical = (value: unknown): unknown =>
    value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]))
      : value;
  return createHash('sha256').update(JSON.stringify(canonical(entry))).digest('hex').slice(0, 16);
}

/**
 * Pure: how a registry differs from a lock of published fingerprints. An
 * entry whose fingerprint changed was edited in place; a locked entry that
 * is gone was removed (runs still name it); an entry with no fingerprint is
 * new and needs one recorded. Two entries with one name and version are a
 * conflict. Empty when the registry keeps every published entry as it was.
 */
export function registryDrift(entries: readonly StrategyEntry[], lock: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const ref = strategyRef(entry);
    if (seen.has(ref)) problems.push(`${ref} is defined twice`);
    seen.add(ref);
    const locked = lock[ref];
    const actual = strategyFingerprint(entry);
    if (locked === undefined) problems.push(`${ref} is new: record its fingerprint ${actual}`);
    else if (locked !== actual) {
      problems.push(`${ref} was changed after it was published; leave it as it was and add ${entry.name}@${nextVersion(entries, entry.name)} instead`);
    }
  }
  for (const ref of Object.keys(lock)) {
    if (!seen.has(ref)) problems.push(`${ref} was removed, but runs planned with it still name it`);
  }
  return problems;
}

function nextVersion(entries: readonly StrategyEntry[], name: string): number {
  return Math.max(0, ...entries.filter((e) => e.name === name).map((e) => e.version)) + 1;
}
