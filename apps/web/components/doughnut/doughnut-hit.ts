import { DoughnutRenderer, type DoughnutRendererOptions, type RendererHit } from './doughnut-renderer';

/**
 * Hit-testing of the social ring's labels, on top of the vendored renderer.
 *
 * The bug (found by review, after a phone audit: a tap on "Housing" opened
 * another dimension): the renderer draws each social dimension's name on the
 * green ring, centred on its middle circle (`_textInner` equals `_midDonut`),
 * but splits its hit areas on that same circle — social wedges answer from
 * the inner edge out to `_midDonut`, ecological ones from `_midDonut` out.
 * Canvas text sits on an alphabetic baseline, so a label's glyphs (and the
 * second line of a two-word name) reach past the middle circle: in the top
 * half of the doughnut a tap on the word "Housing" lands in Land Conversion's
 * hit area, "Networks" in Freshwater Withdrawals', "Gender" in Biodiversity
 * Loss'. It is not a scaling bug: the renderer already maps CSS pixels to
 * canvas pixels, and the canvas is not scaled by devicePixelRatio.
 *
 * The fix: nothing ecological is drawn inside the green ring's outer edge
 * (`_outDonut`) — every ecological wedge and bump starts there — so a point
 * between the middle circle and that edge belongs to the social dimension
 * whose label is drawn there. Such a point is moved inward along its own
 * angle into the social ring before the renderer tests it, so the renderer's
 * own sector paths still decide which wedge it is (the angle is unchanged).
 *
 * The renderer itself is vendored and stays as it is; its hit areas could be
 * split at `_outDonut` instead (two values in `_drawDimensions`), which would
 * also fix ImpactDoughnut, but that is a change to the vendored file.
 */

/** The radii the renderer derives from its size, in canvas pixels. */
export interface DoughnutGeometry {
  /** The doughnut's centre (the canvas is square). */
  middle: number;
  /** The inner edge of the social ring: the hit areas begin here. */
  inInner: number;
  /** The green ring's middle circle: the renderer's social/ecological hit boundary, and the social labels' radius. */
  midDonut: number;
  /** The green ring's outer edge, where every ecological wedge starts. */
  outDonut: number;
}

/**
 * The renderer's geometry for a size, by the same arithmetic as its
 * constructor (doughnut-renderer.js), so the two cannot disagree; the test
 * checks it against a real renderer at several sizes.
 */
export function doughnutGeometry(size: number, donutScale = 1): DoughnutGeometry {
  // The renderer ignores a scale outside 0.5–1.5 and uses 1.
  const scale = donutScale >= 0.5 && donutScale <= 1.5 ? donutScale : 1;
  const fudge = size / 640;
  const margin = Math.round(100 * fudge);
  const section = (size - margin) / 8;
  const ringSize = section * scale;
  const overlap = (ringSize - section) / 2;
  const inInner = section;
  const inDonut = inInner + section - overlap;
  const outDonut = inDonut + ringSize;
  return { middle: size / 2, inInner, midDonut: inDonut + (outDonut - inDonut) / 2, outDonut };
}

/**
 * Where the renderer should test a point that may be on a social label: for a
 * point in the green ring's outer half (past the middle circle, up to the
 * ring's outer edge), the same angle moved into the middle of the social
 * hit band; for any other point, null (the renderer's own test is right).
 */
export function socialLabelPoint(g: DoughnutGeometry, x: number, y: number): { x: number; y: number } | null {
  const dx = x - g.middle;
  const dy = y - g.middle;
  const r = Math.hypot(dx, dy);
  if (r <= g.midDonut || r > g.outDonut) return null;
  const target = (g.inInner + g.midDonut) / 2;
  return { x: g.middle + (dx * target) / r, y: g.middle + (dy * target) / r };
}

/** The renderer's hit test, which its mousemove and click handlers call with canvas coordinates. */
type HitTest = (this: DoughnutRenderer, x: number, y: number) => RendererHit | null;
const rendererHitTest = (DoughnutRenderer.prototype as unknown as { _checkMouseOver?: HitTest })._checkMouseOver;

/**
 * The vendored renderer with social-label taps resolved to their own
 * dimension (see the top of this file). Only the point it tests changes:
 * hover reporting, the click toggle, the cursor and the selection outline
 * are the renderer's own, so each now follows the corrected hit.
 *
 * It overrides `_checkMouseOver`, the one method both of the renderer's
 * pointer handlers call (the test drives those handlers, so a renamed method
 * fails there rather than silently restoring the bug). When the moved point
 * hits nothing (a doughnut with no social dimensions), the original point is
 * tested, exactly as the renderer alone would.
 */
export class LabelAwareDoughnutRenderer extends DoughnutRenderer {
  private readonly geometry: DoughnutGeometry;

  constructor(options: DoughnutRendererOptions) {
    super(options);
    this.geometry = doughnutGeometry(options.size, options.donutScale);
  }

  _checkMouseOver(x: number, y: number): RendererHit | null {
    if (!rendererHitTest) throw new Error('doughnut-renderer: _checkMouseOver is missing');
    const label = socialLabelPoint(this.geometry, x, y);
    return (label && rendererHitTest.call(this, label.x, label.y)) ?? rendererHitTest.call(this, x, y);
  }
}
