import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockPortrait } from '@/lib/mock-data';
import { DoughnutRenderer, type RendererHit } from './doughnut-renderer';
import { LabelAwareDoughnutRenderer, doughnutGeometry, socialLabelPoint } from './doughnut-hit';

/*
 * The real vendored renderer on a geometric stub canvas: Path2D records its
 * arcs so isPointInPath can answer as the browser would for the renderer's
 * annular sectors, and fillText records where every label is drawn. Text
 * widths approximate Arial (about 0.56 em per character).
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

/** What the renderer exposes to its own handlers: the hit test the subclass overrides, and its radii. */
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
  // The doughnut's centre in canvas pixels (half the renderer's size).
  let centre = 0;
  const ctx = new Proxy<Record<string | symbol, unknown>>(
    {
      createRadialGradient: () => ({ addColorStop() {} }),
      getLineDash: () => [],
      measureText: (s: string) => ({ width: s.length * textSize * 0.56 }),
      fillText: (text: string, x: number, y: number) => drawn.push({ text, x, y }),
      isPointInPath(path: StubPath2D, x: number, y: number) {
        // The renderer's hit path: the outer arc a0→a1, then the inner arc back.
        const [outer, inner] = path.arcs;
        if (!outer || !inner) return false;
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
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    drawn,
    listeners,
    setCentre: (c: number) => {
      centre = c;
    },
  };
}

/** The demo portrait's rings in display order, as PortraitDoughnut passes them. */
const ordered = [...mockPortrait.dimensions].sort((a, b) => a.display_order - b.display_order);
const SOCIAL = ordered.filter((d) => d.ring === 'social').map((d) => d.data.name);
const ECOLOGICAL = ordered.filter((d) => d.ring === 'ecological').map((d) => d.data.name);

function build(Renderer: typeof DoughnutRenderer, size = 720) {
  const stub = stubCanvas();
  stub.setCentre(size / 2);
  const onSelect = vi.fn<(hit: RendererHit | null) => void>();
  const renderer = new Renderer({
    canvas: stub.canvas,
    size,
    donutScale: 1,
    textSize: Math.round((size / 640) * 13),
    onSelect,
  });
  renderer.setColours(2, 1, '#883251', '#E096C6');
  stub.drawn.length = 0;
  renderer.setLevels([
    ...SOCIAL.map((name, i) => ({ type: 'inner' as const, name, level: (i * 37) % 160 - 40 })),
    ...ECOLOGICAL.map((name, i) => ({ type: 'outer' as const, name, level: (i * 53) % 190 - 40 })),
  ]);
  return { renderer, internals: renderer as unknown as Internals, onSelect, ...stub };
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

describe('doughnutGeometry', () => {
  it("matches the renderer's own radii at every size and scale", () => {
    for (const size of [300, 640, 720, 1000]) {
      for (const scale of [0.8, 1, 1.2]) {
        const stub = stubCanvas();
        const r = new DoughnutRenderer({ canvas: stub.canvas, size, donutScale: scale }) as unknown as Internals;
        const g = doughnutGeometry(size, scale);
        expect(g.middle).toBe(r._middleX);
        expect(g.inInner).toBeCloseTo(r._inInner, 9);
        expect(g.midDonut).toBeCloseTo(r._midDonut, 9);
        expect(g.outDonut).toBeCloseTo(r._outDonut, 9);
      }
    }
  });

  it('puts the social labels on the hit boundary (the cause of the bug)', () => {
    const { internals } = build(DoughnutRenderer);
    expect(internals._textInner).toBeCloseTo(internals._midDonut, 9);
  });
});

describe('socialLabelPoint', () => {
  const g = doughnutGeometry(720);

  it('leaves points the renderer already resolves correctly alone', () => {
    expect(socialLabelPoint(g, g.middle, g.middle)).toBeNull();
    expect(socialLabelPoint(g, g.middle + g.midDonut - 1, g.middle)).toBeNull();
    expect(socialLabelPoint(g, g.middle, g.middle - g.outDonut - 1)).toBeNull();
  });

  it("moves a point in the green ring's outer half into the social band, on the same angle", () => {
    const r = (g.midDonut + g.outDonut) / 2;
    for (const angle of [0, 1, 2.5, 4, 5.9]) {
      const x = g.middle + r * Math.cos(angle);
      const y = g.middle + r * Math.sin(angle);
      const p = socialLabelPoint(g, x, y);
      expect(p).not.toBeNull();
      const moved = Math.hypot(p!.x - g.middle, p!.y - g.middle);
      expect(moved).toBeGreaterThan(g.inInner);
      expect(moved).toBeLessThan(g.midDonut);
      expect(Math.atan2(p!.y - g.middle, p!.x - g.middle)).toBeCloseTo(Math.atan2(y - g.middle, x - g.middle), 9);
    }
  });
});

describe('LabelAwareDoughnutRenderer', () => {
  it('the vendored renderer alone sends a tap on a top-half social label to the ecological ring', () => {
    // The harness reproduces the reported bug, so the next test is not vacuous.
    const { internals, drawn } = build(DoughnutRenderer);
    const housing = labels(drawn).find((l) => l.name === 'Housing')!;
    const line = housing.lines[0]!;
    expect(describeHit(internals._checkMouseOver(line.x, line.y - 0.35 * internals._textSize))).toBe(
      'outer:Land Conversion',
    );
  });

  it('resolves a tap anywhere on every drawn label to that dimension', () => {
    const { internals, drawn } = build(LabelAwareDoughnutRenderer);
    const wrong: string[] = [];
    for (const label of labels(drawn)) {
      for (const line of label.lines) {
        for (const { x, y } of pointsOn(line, internals._textSize)) {
          const got = describeHit(internals._checkMouseOver(x, y));
          if (got !== `${label.ring}:${label.name}`) wrong.push(`"${line.text}" (${label.name}) -> ${got}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('resolves the middle of every wedge as the renderer alone does', () => {
    const plain = build(DoughnutRenderer).internals;
    const aware = build(LabelAwareDoughnutRenderer).internals;
    const g = doughnutGeometry(720);
    const centres = [
      ...SOCIAL.map((_, i) => ({ r: (g.inInner + g.midDonut) / 2, angle: ((i + 0.5) * 2 * Math.PI) / SOCIAL.length })),
      ...ECOLOGICAL.map((_, i) => ({ r: g.outDonut + 30, angle: ((i + 0.5) * 2 * Math.PI) / ECOLOGICAL.length })),
      // Past the outer ring: the renderer's label band for ecological names.
      { r: 340, angle: 1 },
    ];
    for (const { r, angle } of centres) {
      const x = g.middle + r * Math.cos(angle);
      const y = g.middle + r * Math.sin(angle);
      expect(describeHit(aware._checkMouseOver(x, y))).toBe(describeHit(plain._checkMouseOver(x, y)));
    }
  });

  it("is what the renderer's click handler uses, through the CSS-to-canvas scaling", () => {
    const { listeners, onSelect, drawn, internals } = build(LabelAwareDoughnutRenderer);
    const line = labels(drawn).find((l) => l.name === 'Networks')!.lines[0]!;
    const scale = CSS_WIDTH / 720;
    listeners.click!({ clientX: line.x * scale, clientY: (line.y - 0.35 * internals._textSize) * scale });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(describeHit(onSelect.mock.calls[0]![0])).toBe('inner:Networks');
  });

  it('keeps the green ring for the ecological ring when there are no social dimensions', () => {
    const stub = stubCanvas();
    stub.setCentre(360);
    const renderer = new LabelAwareDoughnutRenderer({ canvas: stub.canvas, size: 720 });
    renderer.setLevels(ECOLOGICAL.map((name) => ({ type: 'outer' as const, name, level: 50 })));
    const g = doughnutGeometry(720);
    const r = (g.midDonut + g.outDonut) / 2;
    const hit = (renderer as unknown as Internals)._checkMouseOver(g.middle + r * Math.cos(0.1), g.middle + r * Math.sin(0.1));
    expect(describeHit(hit)).toBe(`outer:${ECOLOGICAL[0]}`);
  });
});
