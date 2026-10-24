import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const framework = JSON.parse(readFileSync(new URL('../packages/contract/framework/framework.json', import.meta.url), 'utf8'));
const profileText = readFileSync(new URL('../site/profiles/local-extreme-heat-v1.json', import.meta.url), 'utf8');
const profile = JSON.parse(profileText);
const profileHash = createHash('sha256').update(profileText).digest('hex');
// Explicitly scoped migration: an arbitrary profile cannot change scoring.
if (profile.id !== 'local-extreme-heat-v1' || profile.replaces !== 'ozone-depletion' || profile.dimension.slug !== 'extreme-heat' || profile.dimension.ring !== 'ecological' || profile.dimension.indicators.length !== 1 || profile.dimension.indicators[0].slug !== 'extreme-heat-days' || profile.dimension.indicators[0].threshold_ref !== null || profile.dimension.indicators[0].scoring !== 'unscored') throw new Error('Invalid local heat profile');
export function portraitFramework(declared) {
  if (!declared.framework_profile) return { dimensions: framework.dimensions, profile: null, sha256: null };
  const allowed = (['carmel', 'monterey-county'].includes(declared.slug) && declared.status === 'research-preview') ||
    (['santa-cruz', 'santa-cruz-county', 'watsonville'].includes(declared.slug) && declared.status === 'legacy-source');
  if (!allowed || declared.framework_profile !== profile.id) throw new Error('Unauthorized portrait framework profile');
  return { dimensions: framework.dimensions.map(d => d.slug === profile.replaces ? profile.dimension : d), profile: profile.id, sha256: profileHash };
}
