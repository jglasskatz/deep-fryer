import type { DimensionData, Ring } from './types.js';

export function deriveVizLevel(ring: Ring, data: DimensionData): number | null {
  const key = ring === 'social' ? 'shortfall_pct' : 'overshoot_pct';

  const pcts = data.indicators
    .map((i) => i[key])
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));

  if (pcts.length === 0) return null;

  const maxPct = Math.max(...pcts);
  return pctToVizLevel(maxPct);
}

function pctToVizLevel(pct: number): number {
  if (pct <= 0) return Math.max(-100, pct * 2);
  if (pct <= 50) return (pct / 50) * 100;
  if (pct <= 100) return 100 + ((pct - 50) / 50) * 50;
  return 150;
}
