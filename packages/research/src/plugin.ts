import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The vendored open-doughnut plugin is the research runtime (SPEC.md §5).
 * Resolution order: OPEN_DOUGHNUT_PLUGIN_DIR env (the worker image sets it),
 * then the monorepo vendor directory.
 */
export function pluginDir(): string {
  if (process.env.OPEN_DOUGHNUT_PLUGIN_DIR) return process.env.OPEN_DOUGHNUT_PLUGIN_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', 'vendor', 'open-doughnut', 'plugin');
}

// The vendored files are immutable within a process; cache reads (renderPlan
// hits the researcher template once per dimension, on the web request path).
const fileCache = new Map<string, string>();

function readCached(filePath: string): string {
  let content = fileCache.get(filePath);
  if (content === undefined) {
    content = readFileSync(filePath, 'utf8');
    fileCache.set(filePath, content);
  }
  return content;
}

export function pluginVersion(): string {
  const manifest = JSON.parse(readCached(path.join(pluginDir(), 'plugin.json'))) as {
    version: string;
  };
  return manifest.version;
}

export function agentTemplate(name: 'region-context' | 'dimension-researcher' | 'verifier'): string {
  return readCached(path.join(pluginDir(), 'agents', `${name}.md`));
}

export function skill(name: 'methodology' | 'source-evaluation' | 'evidence-capture'): string {
  return readCached(path.join(pluginDir(), 'skills', `${name}.md`));
}

/** Fill {{placeholders}}; unknown placeholders are left intact (e.g. {{region_brief}} until apply). */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? (values[key] as string) : match,
  );
}
