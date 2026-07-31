export interface RendererDimLevel {
  value: number | 'NaN';
  label: string;
}

export interface RendererDimInfo {
  name: string;
  levels: RendererDimLevel[];
}

export interface RendererHit {
  dim_num: number;
  dim_type: 'inner' | 'outer';
  dim_info: RendererDimInfo;
  lvl_num: number;
  path: Path2D | undefined;
}

export interface DoughnutRendererOptions {
  canvas: HTMLCanvasElement;
  size: number;
  donutScale?: number;
  textSize?: number;
  onHover?: (hit: RendererHit | null, event: MouseEvent) => void;
  onSelect?: (hit: RendererHit | null) => void;
}

export class DoughnutRenderer {
  constructor(options: DoughnutRendererOptions);
  addDimension(
    type: 'inner' | 'outer',
    name: string,
    level: number | string,
    label?: string,
  ): void;
  clearDoughnut(): void;
  isEmptyDoughnut(): boolean;
  update(): void;
  destroy(): void;
  export(): string;
  import(text: string): number;
  getSelectedDimension(): {
    type: 'inner' | 'outer';
    name: string;
    level: number | 'NaN';
    label: string;
  } | null;
}
