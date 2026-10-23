import { DoughnutRenderer } from './doughnut-renderer.js';
const collection = JSON.parse(document.getElementById('portrait-data').textContent);
const portraits = new Map(collection.portraits.map(p => [p.slug, p]));
const links = [...document.querySelectorAll('.portrait-switcher a')];
const content = document.getElementById('selected-portrait');
let renderer;
let selected;

function portraitUrl(slug) {
  const url = new URL(`../${collection.hub}/`, location.href);
  if (slug !== collection.hub) url.searchParams.set('area', slug);
  return url;
}

function selectPortrait(slug) {
  const portrait = portraits.get(slug);
  if (!portrait) return false;
  renderer?.destroy();
  content.replaceChildren(document.getElementById(`portrait-${slug}`).content.cloneNode(true));
  selected = slug;
  document.title = `${portrait.name} · deep-fryer`;
  for (const link of links) {
    if (link.dataset.portrait === slug) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const canvas = document.getElementById('doughnut');
  const label = document.getElementById('chart-hover');
  const dimensions = new Map(portrait.dimensions.map(d => [`${d.ring}:${d.name}`, d]));
  function resolve(hit) { return hit ? dimensions.get(`${hit.dim_type === 'inner' ? 'social' : 'ecological'}:${hit.dim_info.name}`) : null; }
  renderer = new DoughnutRenderer({ canvas, size: 800, donutScale: 1, textSize: 16,
    onHover: hit => { const d = resolve(hit); label.textContent = d ? `${d.name} · ${d.level === null ? 'Unknown / evidence incomplete' : 'Select to inspect all indicators'}` : 'Select a wedge or choose a dimension below.'; },
    onSelect: hit => { const d = resolve(hit); if (d) { const heading = document.getElementById(`dim-${d.slug}`); heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', `#dim-${d.slug}`); } },
  });
  renderer.setColours(2, 1, '#883251', '#E096C6');
  for (const d of portrait.dimensions) renderer.addDimension(d.ring === 'social' ? 'inner' : 'outer', d.name, d.level ?? 'NaN');
  return true;
}

const requested = new URL(location.href).searchParams.get('area');
selectPortrait(portraits.has(requested) ? requested : collection.initial);
const canonical = portraitUrl(selected);
canonical.hash = location.hash;
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
  selectPortrait(link.dataset.portrait);
  history.pushState(null, '', portraitUrl(selected));
});
window.addEventListener('popstate', () => {
  const slug = new URL(location.href).searchParams.get('area') || collection.hub;
  if (slug !== selected) selectPortrait(slug);
  restoreAnchor();
});
window.addEventListener('pagehide', () => renderer?.destroy(), { once: true });
