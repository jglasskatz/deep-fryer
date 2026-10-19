import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The portrait panel's "N more ways to get involved" link lands on this
 * page's #get-involved. Next scrolls a hash target to the very top of the
 * window, under the sticky site header (56 px, plus the family bar and the
 * language notice), so the target needs the same scroll margin as the
 * panel's own anchor or its heading lands hidden. Read from the source: the
 * page itself needs a request, a database, and a portrait to render.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

describe('dimension page anchors', () => {
  it('keeps the get-involved heading clear of the sticky header when the panel links to it', () => {
    const page = readFileSync(path.join(here, 'page.tsx'), 'utf8');
    const target = page.match(/<\w+ id="get-involved" className="([^"]*)"/);
    expect(target, 'an element with id="get-involved"').not.toBeNull();
    expect(target![1]!.split(' ')).toEqual(expect.arrayContaining(['scroll-mt-48', 'sm:scroll-mt-36']));
    const panel = readFileSync(path.join(here, '../../../../components/portrait/PortraitPanel.tsx'), 'utf8');
    expect(panel).toContain('#get-involved');
  });
});
