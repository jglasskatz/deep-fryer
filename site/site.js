import { DoughnutRenderer } from './doughnut-renderer.js';
const portrait = JSON.parse(document.getElementById('portrait-data').textContent);
const canvas = document.getElementById('doughnut');
const label = document.getElementById('chart-hover');
const dimensions = new Map(portrait.dimensions.map(d => [`${d.ring}:${d.name}`, d]));
function resolve(hit) { return hit ? dimensions.get(`${hit.dim_type === 'inner' ? 'social' : 'ecological'}:${hit.dim_info.name}`) : null; }
const renderer = new DoughnutRenderer({ canvas, size: 800, donutScale: 1, textSize: 16,
  onHover: hit => { const d = resolve(hit); label.textContent = d ? `${d.name} · ${d.level === null ? 'Unknown / evidence incomplete' : 'Select to inspect all indicators'}` : 'Select a wedge or choose a dimension below.'; },
  onSelect: hit => { const d = resolve(hit); if (d) { const heading = document.getElementById(`dim-${d.slug}`); heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', `#dim-${d.slug}`); } },
});
renderer.setColours(2, 1, '#883251', '#E096C6');
for (const d of portrait.dimensions) renderer.addDimension(d.ring === 'social' ? 'inner' : 'outer', d.name, d.level ?? 'NaN');
window.addEventListener('pagehide', () => renderer.destroy(), { once: true });
