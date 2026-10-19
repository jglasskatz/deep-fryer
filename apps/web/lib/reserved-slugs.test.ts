import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS, SLUG_RE, slugError } from '@deep-fryer/core';

/**
 * Every top-level route the app serves, and every top-level public file,
 * is a reserved slug (core RESERVED_SLUGS). Next's static routes win over
 * `/[tenant]`, so a portrait whose slug matched one — /accessibility, added
 * without being reserved — would have its front page, sitemap entry and
 * directory link show that page instead. Read from the app's own folders,
 * so a new top-level page cannot be added without reserving its name.
 */
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The first path segment each entry of app/ or public/ answers at, or null for a file that is no route. */
function topLevelSegment(dir: 'app' | 'public', entry: { name: string; isDirectory(): boolean }): string | null {
  if (dir === 'public') return entry.name;
  if (entry.isDirectory()) {
    // Dynamic segments, route groups and private folders take no address of their own.
    return /^[[(_@]/.test(entry.name) ? null : entry.name;
  }
  // Metadata routes: app/robots.ts is /robots.txt, and so on.
  const metadata: Record<string, string> = {
    'robots.ts': 'robots.txt',
    'sitemap.ts': 'sitemap.xml',
    'manifest.ts': 'manifest.webmanifest',
  };
  return metadata[entry.name] ?? null;
}

describe('reserved slugs', () => {
  it('reserves every top-level route and public file a slug could collide with', () => {
    const segments = (['app', 'public'] as const).flatMap((dir) =>
      readdirSync(path.join(WEB, dir), { withFileTypes: true })
        .map((e) => topLevelSegment(dir, e))
        .filter((s): s is string => s !== null),
    );
    expect(segments).toContain('accessibility');
    expect(segments).toContain('privacy');
    // A name that cannot be a slug (social-preview.png) cannot collide; every other must be reserved.
    const unreserved = segments.filter((s) => (SLUG_RE.test(s) || !s.includes('.')) && !RESERVED_SLUGS.has(s));
    expect(unreserved).toEqual([]);
    for (const s of segments.filter((x) => RESERVED_SLUGS.has(x))) expect(slugError(s)).not.toBeNull();
  });

  it('refuses "accessibility" as a portrait or organization slug', () => {
    expect(slugError('accessibility')).toMatch(/reserved/);
  });
});
