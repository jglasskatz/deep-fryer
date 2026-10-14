import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * The worker image takes its browser from Playwright's base image, so the
 * image tag and the installed playwright-core must be the same release: a
 * playwright-core newer than the image's Chromium cannot launch it, and that
 * only shows up when the first research run tries to capture evidence.
 */
describe('worker image', () => {
  it('pins the Playwright base image to the installed playwright-core', () => {
    const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
    const tag = /^ARG PLAYWRIGHT_IMAGE=mcr\.microsoft\.com\/playwright:v([\d.]+)-/m.exec(dockerfile)?.[1];
    const require = createRequire(import.meta.url);
    const installed = (require('playwright-core/package.json') as { version: string }).version;
    const declared = (
      JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        dependencies: Record<string, string>;
      }
    ).dependencies['playwright-core'];
    expect(tag).toBe(installed);
    expect(declared).toBe(installed);
  });
});
