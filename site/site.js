import { DoughnutRenderer } from './doughnut-renderer.js';
import { formatIndicatorValue } from './format.js';
import { dimensionState, dimensionStatus } from './portrait-presentation.js';
const collection = JSON.parse(document.getElementById('portrait-data').textContent);
const portraits = new Map(collection.portraits.map(p => [p.slug, p]));
const links = [...document.querySelectorAll('.portrait-switcher a')];
const content = document.getElementById('selected-portrait');
let renderer;
let selected;
let selectionEvents;

function portraitUrl(slug) {
  const url = new URL(`../${collection.hub}/`, location.href);
  if (slug !== collection.hub) url.searchParams.set('area', slug);
  return url;
}

function selectPortrait(slug, restoreDimension = true) {
  const portrait = portraits.get(slug);
  if (!portrait) return false;
  renderer?.destroy();
  selectionEvents?.abort();
  selectionEvents = new AbortController();
  content.replaceChildren(document.getElementById(`portrait-${slug}`).content.cloneNode(true));
  selected = slug;
  document.title = `${portrait.name} · deep-fryer`;
  for (const link of links) {
    if (link.dataset.portrait === slug) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const canvas = document.getElementById('doughnut');
  const label = document.getElementById('chart-hover');
  const tooltip = document.getElementById('chart-tooltip');
  const panel = document.getElementById('detail-panel');
  const empty = document.getElementById('panel-empty');
  const mobilePanel = matchMedia('(max-width: 850px)');
  const canHover = matchMedia('(hover: hover) and (pointer: fine)');
  const idleCopy = () => canHover.matches ? 'Hover for a summary. Select a segment or dimension to read its evidence.' : 'Tap a segment or choose a dimension below to read its evidence.';
  label.textContent = idleCopy();
  let selectedDimension = null;
  let returnFocus = canvas;
  const dimensions = new Map(portrait.dimensions.map(d => [`${d.ring}:${d.name}`, d]));
  function resolve(hit) { return hit ? dimensions.get(`${hit.dim_type === 'inner' ? 'social' : 'ecological'}:${hit.dim_info.name}`) : null; }
  function hoverSummary(d, event) {
    tooltip.hidden = true;
    if (!d || event.type === 'click') return;
    tooltip.replaceChildren();
    const add = (tag, text) => { const node = document.createElement(tag); node.textContent = text; tooltip.append(node); };
    add('strong', d.name);
    add('p', `${d.ring === 'social' ? 'Social foundation' : 'Ecological ceiling'} · ${dimensionStatus(d)}`);
    for (const indicator of d.indicators.slice(0, 2)) {
      add('p', `${indicator.name}: ${formatIndicatorValue(indicator.kind === 'observation' && indicator.value !== null ? Number(indicator.value.toFixed(1)) : indicator.value, indicator.unit)} ${indicator.year ? `(${indicator.year})` : ''}`);
      add('small', `${collection.statuses[indicator.status]} · ${indicator.geography || 'See source context'}`);
      if (indicator.quality_flags?.length) add('small', indicator.quality_flags.join(' · '));
      if (indicator.source) add('small', `Source: ${indicator.source}`);
    }
    if (d.indicators.length > 2) add('p', `${d.indicators.length - 2} more measures in the evidence panel.`);
    if (!d.indicators.length) add('p', 'No acceptable measurement available.');
    add('p', mobilePanel.matches ? 'Select to open the evidence.' : 'Select to keep the evidence beside the chart.');
    tooltip.hidden = false;
    const rect = canvas.getBoundingClientRect();
    const left = Math.max(0, Math.min(event.clientX - rect.left + 14, rect.width - tooltip.offsetWidth));
    const top = Math.max(0, Math.min(event.clientY - rect.top + 14, rect.height - tooltip.offsetHeight));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  function showDimension(d, focus = false, trigger = null) {
    if (trigger) returnFocus = trigger;
    tooltip.hidden = true;
    selectedDimension = d?.slug ?? null;
    for (const link of content.querySelectorAll('.dimension-links a')) {
      const active = d && link.hash === `#dim-${d.slug}`;
      link.setAttribute('aria-expanded', String(Boolean(active)));
      if (active) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
    }
    const url = new URL(location.href);
    if (d) url.searchParams.set('dim', d.slug); else url.searchParams.delete('dim');
    url.hash = '';
    history.replaceState(null, '', url);
    if (!d) {
      const restoreFocus = panel.contains(document.activeElement);
      panel.close();
      if (restoreFocus) returnFocus?.focus({ preventScroll: true });
      empty.hidden = false;
      label.textContent = idleCopy();
      return;
    }
    const article = document.getElementById(`dim-${d.slug}`).cloneNode(true);
    article.removeAttribute('id');
    article.className = 'panel-dimension';
    const heading = article.querySelector('h2');
    heading.id = 'panel-heading';
    heading.tabIndex = -1;
    panel.querySelector('.panel-content').replaceChildren(article);
    empty.hidden = true;
    const before = window.scrollY;
    if (!panel.open) {
      if (mobilePanel.matches) panel.showModal();
      else panel.show();
    }
    panel.scrollTop = 0;
    if (focus || mobilePanel.matches) heading.focus({ preventScroll: true });
    window.scrollTo({ top: before, behavior: 'instant' });
    label.textContent = `${d.name} evidence is open.${canHover.matches ? ' Hover other segments to compare.' : ' Close the evidence to choose another dimension.'}`;
  }
  function drawChart() {
    renderer?.destroy();
    renderer = new DoughnutRenderer({ canvas, size: 800, pixelRatio: Math.min(3, window.devicePixelRatio || 1), donutScale: 1, textSize: 16,
      onHover: (hit, event) => hoverSummary(resolve(hit), event),
      onSelect: hit => { const dimension = resolve(hit); if (dimension) { showDimension(dimension, false, canvas); queueMicrotask(drawChart); } },
    });
    renderer.setColours(2, 1, '#883251', '#E096C6');
    renderer.setLevels(portrait.dimensions.map(d => ({ type: d.ring === 'social' ? 'inner' : 'outer', name: d.name, level: d.level ?? 'NaN', colour: d.slug === selectedDimension ? '#0066cc' : dimensionState(d) === 'unscored' ? '#6d7188' : null })));
  }
  canvas.parentElement.addEventListener('mouseleave', () => { tooltip.hidden = true; });
  panel.querySelector('.panel-close').addEventListener('click', () => { showDimension(null); drawChart(); });
  panel.addEventListener('cancel', event => { event.preventDefault(); showDimension(null); drawChart(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !tooltip.hidden) { event.preventDefault(); tooltip.hidden = true; }
    else if (event.key === 'Escape' && panel.open) { event.preventDefault(); showDimension(null); drawChart(); }
  }, { signal: selectionEvents.signal });
  mobilePanel.addEventListener('change', () => {
    if (!panel.open) return;
    const before = window.scrollY;
    const panelScroll = panel.scrollTop;
    const focused = document.activeElement;
    panel.close();
    if (mobilePanel.matches) panel.showModal(); else panel.show();
    panel.scrollTop = panelScroll;
    if (panel.contains(focused)) focused.focus({ preventScroll: true });
    window.scrollTo({ top: before, behavior: 'instant' });
  }, { signal: selectionEvents.signal });
  for (const link of content.querySelectorAll('.dimension-links a')) link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    showDimension(portrait.dimensions.find(d => `#dim-${d.slug}` === link.hash), true, link);
    drawChart();
  });
  const dimension = new URL(location.href).searchParams.get('dim');
  if (restoreDimension && dimension) showDimension(portrait.dimensions.find(d => d.slug === dimension));
  drawChart();
  return true;
}

const requested = new URL(location.href).searchParams.get('area');
selectPortrait(portraits.has(requested) ? requested : collection.initial);
const canonical = portraitUrl(selected);
canonical.hash = location.hash;
const initialDimension = new URL(location.href).searchParams.get('dim');
if (initialDimension) canonical.searchParams.set('dim', initialDimension);
history.replaceState(null, '', canonical);
function restoreAnchor() {
  if (!location.hash) return;
  let id;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' }));
}
restoreAnchor();
window.addEventListener('load', restoreAnchor, { once: true });
for (const link of links) link.addEventListener('click', event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (link.dataset.portrait === selected) return;
  selectPortrait(link.dataset.portrait, false);
  history.pushState(null, '', portraitUrl(selected));
});
window.addEventListener('popstate', () => {
  const slug = new URL(location.href).searchParams.get('area') || collection.hub;
  selectPortrait(portraits.has(slug) ? slug : collection.hub);
  restoreAnchor();
});
window.addEventListener('pagehide', () => renderer?.destroy(), { once: true });
