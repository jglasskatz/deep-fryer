import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PortraitFeature } from '@deep-fryer/core';

/**
 * SPEC-v7 §3.3 says a feature that is off is gone: its pages are a 404 and
 * its server actions refuse. The behaviour is tested per feature elsewhere
 * (features.test.ts, the *-actions tests, the status route's test); this
 * test makes sure nothing new slips past the rule. It reads the source:
 *
 * - every page and route handler under a feature's folders calls that
 *   feature's guard;
 * - every server action exported from a feature's action module checks that
 *   feature before doing anything.
 *
 * A new page or action behind a feature fails here until it is guarded, and
 * a new feature folder or module is added to the lists below.
 */
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FEATURE_FOLDERS: { folder: string; feature: PortraitFeature; organization?: boolean }[] = [
  { folder: 'app/[tenant]/emergency', feature: 'emergency' },
  { folder: 'app/[tenant]/admin/emergency', feature: 'emergency' },
  { folder: 'app/[tenant]/admin/policy', feature: 'policy_analysis' },
  { folder: 'app/[tenant]/admin/involvement', feature: 'involvement' },
  { folder: 'app/[tenant]/admin/discussion', feature: 'discussion' },
  { folder: 'app/[tenant]/pages', feature: 'custom_pages' },
  { folder: 'app/[tenant]/admin/pages', feature: 'custom_pages' },
  { folder: 'app/o/[org]/compare', feature: 'family_compare', organization: true },
  { folder: 'app/o/[org]/insights', feature: 'family_compare', organization: true },
];

const ACTION_MODULES: { file: string; feature: PortraitFeature }[] = [
  { file: 'lib/emergency-actions.ts', feature: 'emergency' },
  { file: 'lib/involvement-actions.ts', feature: 'involvement' },
  { file: 'lib/involvement-admin-actions.ts', feature: 'involvement' },
  { file: 'lib/discussion-actions.ts', feature: 'discussion' },
  { file: 'lib/policy-actions.ts', feature: 'policy_analysis' },
  { file: 'lib/insight-actions.ts', feature: 'request_research' },
  { file: 'lib/custom-page-actions.ts', feature: 'custom_pages' },
];

function entryFiles(dir: string): string[] {
  return readdirSync(path.join(WEB, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = path.join(dir, d.name);
    if (d.isDirectory()) return entryFiles(rel);
    return /^(page\.tsx|route\.ts)$/.test(d.name) ? [rel] : [];
  });
}

/** The ways a page, route, or action may check a feature (lib/features.ts). */
function guardPattern(feature: PortraitFeature, organization = false): RegExp {
  const f = `'${feature}'`;
  return organization
    ? new RegExp(`requireOrganizationFeature\\([^)]*${f}\\)`)
    : new RegExp(
        [
          `requireFeature\\([^)]*${f}\\)`,
          `requireTenantRoleWithFeature\\([^)]*${f}\\)`,
          `assertFeatureForTenant\\([^)]*${f}`,
          `portraitFeatures(ById|In)?\\([^)]*\\)\\)\\.${feature}\\b`,
          `features\\.${feature}\\b`,
        ].join('|'),
      );
}

/**
 * Each server action a 'use server' module exports — `export const name =
 * action(…)` or `export async function name(…)` — with its source up to the
 * next one.
 */
function exportedActions(source: string): { name: string; body: string }[] {
  const starts = [...source.matchAll(/^export (?:const (\w+) = action\(|async function (\w+)\()/gm)];
  return starts.map((m, i) => ({
    name: (m[1] ?? m[2])!,
    body: source.slice(m.index!, i + 1 < starts.length ? starts[i + 1]!.index : undefined),
  }));
}

describe('feature guards (SPEC-v7 §3.3)', () => {
  it.each(FEATURE_FOLDERS)('guards every page and route under $folder with $feature', ({ folder, feature, organization }) => {
    const files = entryFiles(folder);
    expect(files.length).toBeGreaterThan(0);
    const unguarded = files.filter((f) => !guardPattern(feature, organization).test(readFileSync(path.join(WEB, f), 'utf8')));
    expect(unguarded).toEqual([]);
  });

  it.each(ACTION_MODULES)('checks $feature in every action exported from $file', ({ file, feature }) => {
    const actions = exportedActions(readFileSync(path.join(WEB, file), 'utf8'));
    expect(actions.length).toBeGreaterThan(0);
    const unguarded = actions.filter((a) => !guardPattern(feature).test(a.body)).map((a) => a.name);
    expect(unguarded).toEqual([]);
  });
});
