import { isGridShow, isGridSortKey, type GridShow, type GridSort, type GridSortKey } from '@/lib/grid-data';

/*
 * The data table's view (search, "Show" filter, dimension, sort) and how it
 * is written in the page address, so a filtered view survives a reload and
 * can be sent to another member. Plain functions, read by the server page
 * and the table alike.
 */

export interface DataGridState {
  search: string;
  show: GridShow;
  /** A dimension slug, or empty for every dimension. */
  dimension: string;
  sort: GridSort | null;
}

export const EMPTY_GRID_STATE: DataGridState = { search: '', show: 'all', dimension: '', sort: null };

/** The table's state from the page address (unknown values fall back to the defaults). */
export function gridStateFromParams(params: Record<string, string | string[] | undefined>): DataGridState {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const show = one(params.show);
  const sort = one(params.sort);
  return {
    search: one(params.q).slice(0, 200),
    show: isGridShow(show) ? show : 'all',
    dimension: /^[a-z0-9][a-z0-9-]*$/.test(one(params.dim)) ? one(params.dim) : '',
    sort: isGridSortKey(sort) ? { key: sort, direction: one(params.order) === 'desc' ? 'descending' : 'ascending' } : null,
  };
}

/** The page address's query for a state: only what differs from the defaults. */
export function gridStateQuery(state: DataGridState): string {
  const params = new URLSearchParams();
  if (state.search.trim()) params.set('q', state.search);
  if (state.show !== 'all') params.set('show', state.show);
  if (state.dimension) params.set('dim', state.dimension);
  if (state.sort) {
    params.set('sort', state.sort.key);
    if (state.sort.direction === 'descending') params.set('order', 'desc');
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** A sort header's next state: ascending, then descending, then back to the table's own order. */
export function nextSort(current: GridSort | null, key: GridSortKey): GridSort | null {
  if (current?.key !== key) return { key, direction: 'ascending' };
  return current.direction === 'ascending' ? { key, direction: 'descending' } : null;
}

/** The table's id for a row, so a link can open the table at it (…/admin/data#row-housing/homelessness-rate). */
export function rowAnchor(rowId: string): string {
  return `row-${rowId}`;
}

