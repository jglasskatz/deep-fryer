'use server';

import { formatIndicatorValue, type DimensionData } from '@deep-fryer/core';
import { action } from './action-result';
import { getPortrait } from './data';
import { requireTenantRoleWithFeature } from './features';
import { scaleLabel } from './i18n/content';
import { en } from './i18n/messages/en';
import type { PublishedDimension, PublishedPortrait } from './portrait';
import { safeHref } from './safe-url';

/**
 * A starting point for a new custom page: a title, an address and Markdown
 * that the editor fills into the "Create a page" form. Nothing is stored until
 * the editor saves it as a draft through saveCustomPage.
 */
export interface CustomPageTemplate {
  id: string;
  /** The template's name, as the button offering it reads. */
  name: string;
  title: string;
  slug: string;
  body: string;
  /** One plain sentence for the editor: where the figures came from. */
  note: string;
}

/** The words a template writes where a figure is missing. */
const NO_DATA = 'no data yet';

/**
 * Text from a portrait's data, made safe for the custom-page Markdown
 * (components/content/MarkdownContent.tsx): one line, so a line break inside
 * a source name cannot start a heading or a list item; square brackets
 * replaced, so it cannot open a link of its own.
 */
function plain(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .trim();
}

/** A paragraph of portrait text, which must not read as a heading, list or code block. */
function paragraph(text: string | null | undefined): string {
  return plain(text).replace(/^(?:#+|[-*]|```)\s*/, '');
}

/** "[name](url)" when the address is an http(s) link the renderer will keep, else the name alone. */
function link(name: string, url: string | null | undefined): string {
  const href = safeHref(url);
  const label = plain(name);
  if (!href || /\s/.test(href)) return label;
  return `[${label || href}](${href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
}

function sentence(text: string): string {
  const t = plain(text);
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * One list line per published indicator, then one per gap not already named
 * by an indicator: the figure as the public dimension page shows it
 * (formatIndicatorValue), its year, scale, target and source; or "no data
 * yet" with the gap's reason. A gap named by an indicator that has a value
 * is written on that figure's line as a data gap (the words the public
 * dimension page uses), never again as "no data yet".
 */
function figureLines(data: DimensionData): string[] {
  const gaps = data.gaps ?? [];
  // Gaps are matched to indicators by name; a nameless one matches nothing.
  const named = new Set(data.indicators.map((ind) => plain(ind.name)).filter(Boolean));
  const lines = data.indicators.map((ind) => {
    const name = plain(ind.name) || 'Unnamed figure';
    const reasons = gaps
      .filter((g) => named.has(plain(g.indicator)) && plain(g.indicator) === plain(ind.name))
      .map((g) => sentence(g.reason))
      .filter(Boolean)
      .join(' ');
    if (ind.value === null || ind.value === '') {
      return `- ${name}: ${NO_DATA}.${reasons ? ` ${reasons}` : ''}`;
    }
    const when = [ind.year ? String(ind.year) : '', ind.geographic_scale ? `${scaleLabel(en, ind.geographic_scale)} data` : '']
      .filter(Boolean)
      .join(', ');
    const parts = [`- ${name}: ${plain(formatIndicatorValue(ind.value, ind.unit))}${when ? ` (${when})` : ''}.`];
    if (ind.target !== null && ind.target !== '') parts.push(`Target: ${plain(formatIndicatorValue(ind.target, ind.unit))}.`);
    if (reasons) parts.push(`Data gap: ${reasons}`);
    if (plain(ind.source)) parts.push(`Source: ${link(ind.source, ind.source_url)}`);
    return parts.join(' ');
  });
  for (const gap of gaps) {
    if (named.has(plain(gap.indicator))) continue;
    lines.push(`- ${plain(gap.indicator) || 'A figure'}: ${NO_DATA}. ${sentence(gap.reason)}`.trimEnd());
  }
  return lines;
}

function actionLines(data: DimensionData): string[] {
  return data.actions
    .map((text) => {
      const source = data.action_sources?.find((s) => s.text === text);
      const words = plain(text);
      if (!words) return '';
      return source && safeHref(source.source_url) ? `- ${words} (${link('source', source.source_url)})` : `- ${words}`;
    })
    .filter(Boolean);
}

/**
 * A publication time written out as page text, such as "October 1, 2026",
 * in English like the rest of the template. The day is taken in UTC, the
 * zone the stored time is written in. Null when there is no valid time.
 */
function writtenDate(iso: string | null | undefined): string | null {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/** The portrait's Energy dimension: a framework Energy dimension first, else one whose address is "energy". */
function energyDimension(portrait: PublishedPortrait | null): PublishedDimension | undefined {
  const dims = portrait?.dimensions ?? [];
  return dims.find((d) => d.canonical_slug === 'energy') ?? dims.find((d) => d.slug === 'energy');
}

/**
 * "Energy deep-dive": the prototype's energy page (energy burden, renewable
 * share, local generation and storage, local programs) as Markdown, with the
 * published Energy figures, their sources and gaps written in, and an "Add
 * here" line wherever the group's own knowledge is needed.
 */
function energyDeepDive(portrait: PublishedPortrait | null): CustomPageTemplate {
  const dim = energyDimension(portrait);
  const place = plain(portrait?.tenant.name) || 'your area';
  const published = writtenDate(dim?.published_at);
  const intro = paragraph(dim?.data.context) || paragraph(dim?.data.description);

  const figures = dim ? figureLines(dim.data) : [];
  const actions = dim ? actionLines(dim.data) : [];

  const body = [
    intro || `Add here: a few sentences on what affordable, reliable and clean energy means for people in ${place}.`,
    dim
      ? `These are the Energy figures published for ${place}${published ? ` on ${published}` : ''}.`
      : `${place} has no published Energy figures yet, so this page says "${NO_DATA}" where they would go.`,
    '## The figures',
    figures.length ? figures.join('\n') : `- Energy: ${NO_DATA}. No Energy figures have been published for ${place}.`,
    '## Energy burden',
    'Add here: how much of their income households spend on energy, and how much more low-income households spend than others.',
    '## Clean and renewable energy',
    'Add here: how much of the electricity used here comes from renewable sources, and who supplies it.',
    '## Solar, batteries and local power',
    'Add here: rooftop solar, battery storage and community power projects, and how they help keep the power on during outages.',
    '## Help with energy bills',
    '- Add here: the name of a program, what it offers, who can use it and a link to its page.',
    '## What people can do',
    actions.length ? actions.join('\n') : '- Add here: one thing people can do, with a link where they can find out more.',
  ].join('\n\n');

  const note = dim
    ? `Filled in from the Energy figures published${published ? ` on ${published}` : ''}. Check the figures against the doughnut, replace every line that starts with "Add here", then save a draft.`
    : `No Energy figures are published yet, so the template says "${NO_DATA}". Replace every line that starts with "Add here", then save a draft.`;

  return { id: 'energy-deep-dive', name: 'Energy deep-dive', title: 'Energy deep-dive', slug: 'energy-deep-dive', body, note };
}

/**
 * The templates a new custom page can start from, filled from what the
 * portrait has published (lib/data.ts getPortrait: published versions only,
 * never a newer draft). Editors only, with custom pages switched on, as
 * saving the page requires.
 */
export const customPageTemplates = action(async (input: { tenantSlug: string }): Promise<CustomPageTemplate[]> => {
  const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'custom_pages');
  const portrait = await getPortrait(tenant.slug);
  return [energyDeepDive(portrait)];
});
