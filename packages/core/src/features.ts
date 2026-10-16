/**
 * Feature flags (SPEC-v7 §3). The core product — the portrait view, dimension
 * pages with their evidence, building and publishing a portrait, progress,
 * accounts and billing — is always on. Everything else is a feature: off for
 * a new portrait unless its owners turn it on, and switchable off for a whole
 * deployment by the operator. One registry, so the settings page, the page
 * guards, the navigation, the worker, and the tests all read the same list.
 */

/** Features a portrait's owners switch on or off (tenant config key `features`). */
export const PORTRAIT_FEATURES = [
  'emergency',
  'policy_analysis',
  'involvement',
  'discussion',
  'translation',
  'family_compare',
  'request_research',
] as const;
export type PortraitFeature = (typeof PORTRAIT_FEATURES)[number];

/** Features that are one setting for the whole deployment (no portrait context). */
export const DEPLOYMENT_FEATURES = ['deep_fry'] as const;
export type DeploymentFeature = (typeof DEPLOYMENT_FEATURES)[number];

export type Feature = PortraitFeature | DeploymentFeature;

export interface FeatureInfo {
  /** Staff-facing name (the settings page is English-only, like the rest of the staff plane). */
  label: string;
  /** What turning it on adds, in one sentence. */
  description: string;
  /** Value for a new portrait (or the deployment) when nothing is stored. */
  defaultOn: boolean;
}

export const FEATURE_REGISTRY: Record<Feature, FeatureInfo> = {
  emergency: {
    label: 'Emergency view',
    description:
      'Official weather alerts, threats rated by risk, adopted plans, and help listings at /{portrait}/emergency; the worker checks alerts for this portrait.',
    defaultOn: false,
  },
  policy_analysis: {
    label: 'Policy analysis',
    description: 'Staff paste a policy brief and get projected impacts on the doughnut. Each analysis uses one research session.',
    defaultOn: false,
  },
  involvement: {
    label: 'Getting involved',
    description:
      'Listings of programs and organizations on each dimension, and a form organizations use to put themselves forward for staff review.',
    defaultOn: false,
  },
  discussion: {
    label: 'Discussion',
    description: 'Residents comment on each dimension; moderators approve first posts.',
    defaultOn: false,
  },
  translation: {
    label: 'Translation',
    description:
      'The portrait’s pages in the eleven Local Law 30 languages. When off, pages are English with a button readers use to request a translation.',
    defaultOn: false,
  },
  family_compare: {
    label: 'Compare and insights',
    description: 'Side-by-side comparison and insights across the organization’s portraits.',
    defaultOn: false,
  },
  request_research: {
    label: 'Research requests from Insights',
    description: 'Editors may request an additional research run for a dimension from the Insights page.',
    defaultOn: false,
  },
  deep_fry: {
    label: 'Deep fry',
    description: 'The "Deep fry this page" item in the theme menu.',
    defaultOn: true,
  },
};

/** Every portrait feature switched on — what migration 0011 gives portraits that existed before flags. */
export const ALL_PORTRAIT_FEATURES_ON: Record<PortraitFeature, boolean> = Object.fromEntries(
  PORTRAIT_FEATURES.map((f) => [f, true]),
) as Record<PortraitFeature, boolean>;

/** A portrait's stored settings: any subset of the portrait features. */
export type PortraitFeatureSettings = Partial<Record<PortraitFeature, boolean>>;

const KNOWN = new Set<string>([...PORTRAIT_FEATURES, ...DEPLOYMENT_FEATURES]);

/**
 * The deployment's kill switch (`DF_DISABLED_FEATURES=emergency,policy_analysis`):
 * a comma- or space-separated list, case-insensitive. Unknown names are
 * ignored rather than fatal — an operator's typo must not take the site down —
 * and reported so the preflight can warn about them.
 */
export function parseDisabledFeatures(raw: string | undefined | null): {
  disabled: ReadonlySet<Feature>;
  unknown: string[];
} {
  const disabled = new Set<Feature>();
  const unknown: string[] = [];
  for (const part of (raw ?? '').split(/[\s,]+/)) {
    const name = part.trim().toLowerCase();
    if (!name) continue;
    if (KNOWN.has(name)) disabled.add(name as Feature);
    else unknown.push(name);
  }
  return { disabled, unknown };
}

/**
 * The features in effect for one portrait: off if the deployment disables it;
 * otherwise the portrait's stored setting, or the registry default when the
 * portrait never set it. Non-boolean stored values count as unset.
 */
export function resolvePortraitFeatures(
  settings: PortraitFeatureSettings | Record<string, unknown> | null | undefined,
  disabled: ReadonlySet<Feature> = new Set(),
): Record<PortraitFeature, boolean> {
  const out = {} as Record<PortraitFeature, boolean>;
  for (const f of PORTRAIT_FEATURES) {
    const stored = (settings as Record<string, unknown> | null | undefined)?.[f];
    const value = typeof stored === 'boolean' ? stored : FEATURE_REGISTRY[f].defaultOn;
    out[f] = value && !disabled.has(f);
  }
  return out;
}

/** A deployment-wide feature: its default, unless the operator disabled it. */
export function deploymentFeatureEnabled(feature: DeploymentFeature, disabled: ReadonlySet<Feature> = new Set()): boolean {
  return FEATURE_REGISTRY[feature].defaultOn && !disabled.has(feature);
}
