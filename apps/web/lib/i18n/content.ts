import type { PublishedDimension } from '@/lib/portrait';
import { en, type Messages } from './messages/en';

/**
 * Translating the framework's fixed vocabulary inside published content.
 * Research text (indicator names, findings, sources) stays as published;
 * what the framework itself names — the 21 dimensions, geographic scales,
 * the organization's word for its portraits — is translated when the
 * published text is the framework's own English, and left alone when a
 * portrait renamed it (then it is the city's content, not ours).
 */

export function dimensionLabel(m: Messages, slug: string, publishedName: string): string {
  const key = slug as keyof Messages['dimensions'];
  return en.dimensions[key] === publishedName ? m.dimensions[key] : publishedName;
}

/** The portrait list with framework dimension names in the reader's language. */
export function localizeDimensions(m: Messages, dims: PublishedDimension[]): PublishedDimension[] {
  if (m === en) return dims;
  return dims.map((d) => ({ ...d, data: { ...d.data, name: dimensionLabel(m, d.slug, d.data.name) } }));
}

export function scaleLabel(m: Messages, scale: string): string {
  return m.scales[scale as keyof Messages['scales']] ?? scale;
}

export function nounForms(m: Messages, noun: string): { singular: string; plural: string } {
  return m.nouns[noun as keyof Messages['nouns']] ?? { singular: noun, plural: `${noun}s` };
}
