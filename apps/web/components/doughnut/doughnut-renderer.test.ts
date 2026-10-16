import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockPortrait } from '@/lib/mock-data';
import { DoughnutRenderer, type RendererHit } from './doughnut-renderer';

/*
 * Hit testing of the vendored renderer: a tap anywhere on a dimension's drawn
 * name, or in the middle of its wedge, selects that dimension (SPEC-v7 §2 —
 * selection fills the panel in place, so a wrong hit shows the wrong data).
 *
 * The real renderer runs on a geometric stub canvas: Path2D records its arcs
 * so isPointInPath can answer as the browser would for the renderer's annular
 * sectors, and fillText records where every label is drawn. Text widths
 * approximate Arial (about 0.56 em per character).
 */

class StubPath2D {
  arcs: { r: number; a0: number; a1: number }[] = [];
  arc(_x: number, _y: number, r: number, a0: number, a1: number) {
    this.arcs.push({ r, a0, a1 });
  }
  closePath() {}
}

interface Drawn {
  text: string;
  x: number;
  y: number;
}

/** The renderer's hit test (both pointer handlers call it) and the radii it is built from. */
interface Internals {
  _checkMouseOver(x: number, y: number): RendererHit | null;
  _middleX: number;
  _inInner: number;
  _midDonut: number;
  _outDonut: number;
  _textInner: number;
  _textSize: number;
}

const CSS_WIDTH = 300;

function stubCanvas() {
  const drawn: Drawn[] = [];
  const listeners: Record<string, (e: { clientX: number; clientY: number }) => void> = {};
  let textSize = 13;
  const ctx = new Proxy<Record<string | symbol, unknown>>(
    {
      createRadialGradient: () => ({ addColorStop() {} }),
      getLineDash: () => [],
      measureText: (s: string) => ({ width: s.length * textSize * 0.56 }),
      fillText: (text: string, x: number, y: number) => drawn.push({ text, x, y }),
      isPointInPath(path: StubPath2D, x: number, y: number) {
        // The renderer's hit path: the outer arc a0→a1, then the inner arc
        // back, about the centre of the canvas (which the renderer sizes).
        const [outer, inner] = path.arcs;
        if (!outer || !inner) return false;
        const centre = canvas.width / 2;
        const r = Math.hypot(x - centre, y - centre);
        let theta = Math.atan2(y - centre, x - centre);
        if (theta < 0) theta += 2 * Math.PI;
        return r >= inner.r && r <= outer.r && theta >= outer.a0 && theta < outer.a1;
      },
    },
    {
      get: (target, key) => (key in target ? target[key] : () => {}),
      set: (target, key, value) => {
        // font is "<n>px Arial": keep the size for measureText.
        if (key === 'font') textSize = parseFloat(String(value));
        target[key] = value;
        return true;
      },
    },
  );
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ctx,
    // The canvas shown 300 CSS px wide, as on a phone, whatever its backing size.
    getBoundingClientRect: () => ({ left: 0, top: 0, width: CSS_WIDTH, height: CSS_WIDTH }),
    addEventListener: (type: string, fn: (e: { clientX: number; clientY: number }) => void) => {
      listeners[type] = fn;
    },
    removeEventListener: () => {},
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, drawn, listeners };
}

/** The demo portrait's rings in display order, as PortraitDoughnut passes them. */
const ordered = [...mockPortrait.dimensions].sort((a, b) => a.display_order - b.display_order);
const SOCIAL = ordered.filter((d) => d.ring === 'social').map((d) => d.data.name);
const ECOLOGICAL = ordered.filter((d) => d.ring === 'ecological').map((d) => d.data.name);

function build(size = 720) {
  const stub = stubCanvas();
  const onSelect = vi.fn<(hit: RendererHit | null) => void>();
  const renderer = new DoughnutRenderer({
    canvas: stub.canvas,
    size,
    donutScale: 1,
    textSize: Math.round((size / 640) * 13),
    onSelect,
  });
  renderer.setColours(2, 1, '#883251', '#E096C6');
  stub.drawn.length = 0;
  // Shortfalls, overshoots, and bumps inside the boundaries, so every wedge shape is drawn.
  renderer.setLevels([
    ...SOCIAL.map((name, i) => ({ type: 'inner' as const, name, level: ((i * 37) % 160) - 40 })),
    ...ECOLOGICAL.map((name, i) => ({ type: 'outer' as const, name, level: ((i * 53) % 190) - 40 })),
  ]);
  return { internals: renderer as unknown as Internals, onSelect, ...stub };
}

/**
 * Each dimension's drawn label: the renderer writes the social names, then
 * the ecological ones, one fillText per line of a name, then the centre's
 * "Doughnut Economics".
 */
function labels(drawn: Drawn[]) {
  const out: { ring: 'inner' | 'outer'; name: string; lines: Drawn[] }[] = [];
  let i = 0;
  for (const [ring, names] of [
    ['inner', SOCIAL],
    ['outer', ECOLOGICAL],
  ] as const) {
    for (const name of names) {
      const lines: Drawn[] = [];
      while (lines.map((l) => l.text).join(' ') !== name) {
        const next = drawn[i++];
        if (!next) throw new Error(`no drawn label for ${name}`);
        lines.push(next);
      }
      out.push({ ring, name, lines });
    }
  }
  return out;
}

/** Points on a drawn line of text (centred, alphabetic baseline): across the word, from cap height to descender. */
function pointsOn(line: Drawn, textSize: number) {
  const width = line.text.length * textSize * 0.56;
  const xs = [0.1, 0.5, 0.9].map((f) => line.x - width / 2 + f * width);
  const ys = [-0.65, -0.35, -0.05, 0.15].map((f) => line.y + f * textSize);
  return xs.flatMap((x) => ys.map((y) => ({ x, y })));
}

const describeHit = (hit: RendererHit | null) => (hit ? `${hit.dim_type}:${hit.dim_info.name}` : 'nothing');

beforeAll(() => {
  vi.stubGlobal('Path2D', StubPath2D);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('doughnut renderer hit testing', () => {
  it('draws the social names on the green ring, inside the social hit areas', () => {
    // The names sit on the ring's middle circle; the social hit areas reach the ring's outer edge, so the
    // whole of each name (whose glyphs rise above that circle in the top half) belongs to its dimension.
    const { internals } = build();
    expect(internals._textInner).toBeCloseTo(internals._midDonut, 9);
  });

  it('resolves a tap anywhere on every drawn name to that dimension, at every size in use', () => {
    // 720: the portrait page; 640: the embed; 320: the family comparison.
    for (const size of [320, 640, 720]) {
      const { internals, drawn } = build(size);
      const c = internals._middleX;
      const wrong: string[] = [];
      for (const label of labels(drawn)) {
        for (const line of label.lines) {
          for (const { x, y } of pointsOn(line, internals._textSize)) {
            // At 320 the text size rounds up (6.5 to 7 px) and the corner of a two-line social name's last line
            // can reach past the green ring, onto the ecological wedge drawn there: genuinely ambiguous, so not a
            // point a social name owns.
            if (label.ring === 'inner' && Math.hypot(x - c, y - c) > internals._outDonut) continue;
            const got = describeHit(internals._checkMouseOver(x, y));
            if (got !== `${label.ring}:${label.name}`) wrong.push(`"${line.text}" (${label.name}) -> ${got}`);
          }
        }
      }
      expect(wrong, `size ${size}`).toEqual([]);
    }
  });

  it('resolves the middle of every wedge, and the ecological label band, to its own dimension', () => {
    const { internals } = build();
    const c = internals._middleX;
    const at = (r: number, angle: number) => describeHit(internals._checkMouseOver(c + r * Math.cos(angle), c + r * Math.sin(angle)));
    SOCIAL.forEach((name, i) => {
      const angle = ((i + 0.5) * 2 * Math.PI) / SOCIAL.length;
      expect(at((internals._inInner + internals._midDonut) / 2, angle)).toBe(`inner:${name}`);
    });
    ECOLOGICAL.forEach((name, i) => {
      const angle = ((i + 0.5) * 2 * Math.PI) / ECOLOGICAL.length;
      expect(at(internals._outDonut + 30, angle)).toBe(`outer:${name}`);
      // Past the outer ring, where the ecological names are drawn: the renderer's fallback by angle.
      expect(at(340, angle)).toBe(`outer:${name}`);
    });
  });

  it("is what the renderer's click handler resolves, through the CSS-to-canvas scaling of a phone-width canvas", () => {
    const { listeners, onSelect, drawn, internals } = build();
    const line = labels(drawn).find((l) => l.name === 'Networks')!.lines[0]!;
    const scale = CSS_WIDTH / 720;
    listeners.click!({ clientX: line.x * scale, clientY: (line.y - 0.35 * internals._textSize) * scale });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(describeHit(onSelect.mock.calls[0]![0])).toBe('inner:Networks');
  });
});
