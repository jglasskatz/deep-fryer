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

export function pluginVersion(): string {
  const manifest = JSON.parse(readFileSync(path.join(pluginDir(), 'plugin.json'), 'utf8')) as {
    version: string;
  };
  return manifest.version;
}

export function agentTemplate(name: 'region-context' | 'dimension-researcher' | 'verifier'): string {
  return readFileSync(path.join(pluginDir(), 'agents', `${name}.md`), 'utf8');
}

export function skill(name: 'methodology' | 'source-evaluation' | 'evidence-capture'): string {
  return readFileSync(path.join(pluginDir(), 'skills', `${name}.md`), 'utf8');
}

/** Fill {{placeholders}}; unknown placeholders are left intact (e.g. {{region_brief}} until apply). */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? (values[key] as string) : match,
  );
}
