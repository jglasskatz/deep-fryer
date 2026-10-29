const fields = new Set(['id', 'portrait_slug', 'dimension_slugs', 'name', 'kind', 'description', 'url', 'source_url', 'checked_at', 'geography', 'participation_note']);
const kinds = new Set(['volunteer', 'services', 'civic', 'organize', 'other']);
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Explicit public fields only. This directory never accepts staff contact or accounting records. */
export function validatePublicInvolvement(raw, portraits) {
  if (!raw || raw.schema_version !== 1 || !Array.isArray(raw.listings)
      || Object.keys(raw).some(key => !['schema_version', 'listings'].includes(key))) {
    throw new Error('Invalid public involvement directory');
  }
  const scope = new Map(portraits.map(p => [p.slug, new Set(p.dimensions.map(d => d.slug))]));
  const ids = new Set();
  for (const item of raw.listings) {
    if (!item || Object.keys(item).some(key => !fields.has(key))) throw new Error('Unexpected public involvement field');
    for (const field of fields) {
      if (field === 'dimension_slugs') continue;
      if (typeof item[field] !== 'string' || !item[field].trim() || item[field].length > 700) throw new Error(`Invalid involvement ${field}`);
    }
    if (!slug.test(item.id) || ids.has(item.id)) throw new Error('Duplicate or invalid involvement id');
    ids.add(item.id);
    const dimensions = scope.get(item.portrait_slug);
    if (!dimensions || !Array.isArray(item.dimension_slugs) || !item.dimension_slugs.length
        || new Set(item.dimension_slugs).size !== item.dimension_slugs.length
        || item.dimension_slugs.some(dim => !dimensions.has(dim))) throw new Error('Involvement dimension must belong to its portrait');
    if (!kinds.has(item.kind)) throw new Error('Unknown involvement kind');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.checked_at)
        || Number.isNaN(Date.parse(item.checked_at))
        || new Date(item.checked_at).toISOString().slice(0, 10) !== item.checked_at) throw new Error('Invalid involvement checked date');
    for (const field of ['url', 'source_url']) {
      let url;
      try { url = new URL(item[field]); } catch { throw new Error('Invalid involvement URL'); }
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')
          || /[\u0000-\u0020]/.test(item[field])) throw new Error('Public involvement URLs require HTTPS without credentials');
    }
  }
  return raw.listings;
}
