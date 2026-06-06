// app/workspace/[workspaceUrl]/components/data-table/columnTemplate.ts
export type ColumnId =
  | 'select'
  | 'identifier'
  | 'title'
  | 'project'
  | 'status'
  | 'priority'
  | 'dueDate'
  | 'assignee'
  | 'updatedAt'
  | 'actions'

/** Canonical left-to-right order. Column visibility is a subset of this. */
export const ALL_COLUMN_IDS: ColumnId[] = [
  'select',
  'identifier',
  'title',
  'project',
  'status',
  'priority',
  'dueDate',
  'assignee',
  'updatedAt',
  'actions',
]

/** One CSS grid track per column. `title` flexes; the rest are fixed. */
export const COLUMN_GRID_WIDTH: Record<ColumnId, string> = {
  select: '40px',
  identifier: '110px',
  title: 'minmax(280px, 1fr)',
  project: '160px',
  status: '144px',
  priority: '112px',
  dueDate: '112px',
  assignee: '120px',
  updatedAt: '132px',
  actions: '48px',
}

/** Reorder an arbitrary id list into canonical order and drop unknown ids. */
export function orderColumns(ids: ColumnId[]): ColumnId[] {
  const set = new Set(ids)
  return ALL_COLUMN_IDS.filter(id => set.has(id))
}

/** CSS `grid-template-columns` for the given visible columns. */
export function buildColumnTemplate(visible: ColumnId[]): string {
  return orderColumns(visible)
    .map(id => COLUMN_GRID_WIDTH[id])
    .join(' ')
}
