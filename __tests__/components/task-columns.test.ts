// Mock UI components and libraries that use ESM or browser APIs
jest.mock('@/components/ui/checkbox', () => ({ Checkbox: () => null }))
jest.mock('@/components/ui/button', () => ({ Button: () => null }))
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: () => null,
  TooltipContent: () => null,
  TooltipTrigger: () => null,
}))
jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: () => null,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: () => null,
}))
jest.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: () => null,
  AlertDialogAction: () => null,
  AlertDialogCancel: () => null,
  AlertDialogContent: () => null,
  AlertDialogDescription: () => null,
  AlertDialogFooter: () => null,
  AlertDialogHeader: () => null,
  AlertDialogMedia: () => null,
  AlertDialogTitle: () => null,
}))
jest.mock('@/components/ui/spinner', () => ({ Spinner: () => null }))
jest.mock('@/app/workspace/[workspaceUrl]/components/StatusBadge', () => ({
  StatusBadge: () => null,
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/PriorityBadge', () => ({
  PriorityBadge: () => null,
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/fields/StatusSelect',
  () => ({ StatusSelect: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/fields/PrioritySelect',
  () => ({ PrioritySelect: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/fields/AssigneeSelect',
  () => ({ AssigneeSelect: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/fields/DueDatePicker',
  () => ({ DueDatePicker: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/fields/ProjectSelect',
  () => ({ ProjectSelect: () => null })
)
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTableSort', () => ({
  ...jest.requireActual('@/app/workspace/[workspaceUrl]/hooks/useTableSort'),
  cmpStatus: () => 0,
}))

import { createTaskColumns } from '@/app/workspace/[workspaceUrl]/components/data-table/task-columns'
import {
  createTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
} from '@tanstack/react-table'
import type { ApiTask } from '@/app/workspace/[workspaceUrl]/types'

const colId = (c: ColumnDef<ApiTask>) =>
  c.id ?? ('accessorKey' in c ? String(c.accessorKey) : '')

const noop = () => {}
const asyncNoop = async () => {}

describe('createTaskColumns', () => {
  it('project context omits the project column but keeps identifier/dueDate/actions', () => {
    const cols = createTaskColumns({
      onTaskClick: noop,
      onDeleteTask: asyncNoop,
      members: [],
      visibleColumns: [
        'select',
        'identifier',
        'title',
        'status',
        'priority',
        'dueDate',
        'assignee',
        'updatedAt',
        'actions',
      ],
    })
    const ids = cols.map(colId)
    expect(ids).not.toContain('project')
    expect(ids).toContain('identifier')
    expect(ids).toContain('dueDate')
    expect(ids).toContain('actions')
  })

  it('my-tasks context includes the project column', () => {
    const cols = createTaskColumns({
      onTaskClick: noop,
      onDeleteTask: asyncNoop,
      members: [],
      projects: [],
      visibleColumns: [
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
      ],
    })
    expect(cols.map(colId)).toContain('project')
  })

  it('emits columns in canonical order regardless of input order', () => {
    const cols = createTaskColumns({
      onTaskClick: noop,
      onDeleteTask: asyncNoop,
      members: [],
      visibleColumns: ['actions', 'title', 'select'],
    })
    expect(cols.map(colId)).toEqual(['select', 'title', 'actions'])
  })
})

describe('select column alignment', () => {
  // The select grid track is 40px; the checkbox is 16px. Using px-4 (16px each
  // side = 32px) leaves only 8px of content box, so the checkbox overflows and
  // gets left-anchored off-center. The fix centers it within the track instead.
  it('centers the checkbox in its narrow track instead of left-padding it', () => {
    const cols = createTaskColumns({
      onTaskClick: noop,
      onDeleteTask: asyncNoop,
      members: [],
      visibleColumns: ['select'],
    })
    const select = cols.find(c => colId(c) === 'select')
    expect(select?.meta?.cellClassName).toContain('justify-center')
    expect(select?.meta?.headerClassName).toContain('justify-center')
    expect(select?.meta?.cellClassName ?? '').not.toContain('px-4')
    expect(select?.meta?.headerClassName ?? '').not.toContain('px-4')
  })
})

// sortingFn only reads `.original`, so a `{ original }` stub is enough to drive it.
const row = (original: Partial<ApiTask>) => ({ original }) as never

const buildCols = (members: unknown[] = []) =>
  createTaskColumns({
    onTaskClick: noop,
    onDeleteTask: asyncNoop,
    members: members as never,
    visibleColumns: ['identifier', 'assignee'],
  })

const getSortFn = (id: string, members: unknown[] = []) => {
  const col = buildCols(members).find(c => colId(c) === id)
  const fn = col?.sortingFn
  if (typeof fn !== 'function') throw new Error(`no sortingFn for ${id}`)
  return (a: unknown, b: unknown) =>
    (fn as (a: never, b: never, id: string) => number)(
      a as never,
      b as never,
      id
    )
}

describe('identifier sorting', () => {
  it('sorts by task number numerically, not lexicographically', () => {
    const fn = getSortFn('identifier')
    const a = row({ teamIdentifier: 'LUM', number: 9 })
    const b = row({ teamIdentifier: 'LUM', number: 10 })
    // Lexicographic on "LUM-9" vs "LUM-10" would put 10 first ('1' < '9');
    // numeric sort must keep 9 before 10.
    expect(fn(a, b)).toBeLessThan(0)
    expect(fn(b, a)).toBeGreaterThan(0)
  })

  it('orders by team identifier first, task number second', () => {
    const fn = getSortFn('identifier')
    // ABC-100 must come before LUM-1: team is the primary key, so the larger
    // number under an earlier team still sorts first.
    const abc = row({ teamIdentifier: 'ABC', number: 100 })
    const lum = row({ teamIdentifier: 'LUM', number: 1 })
    expect(fn(abc, lum)).toBeLessThan(0)
  })
})

describe('assignee sorting', () => {
  const members = [
    { actorId: 'u1', name: 'Alice' },
    { actorId: 'u2', name: 'Bob' },
  ]

  it('is sortable (enableSorting not disabled)', () => {
    const col = buildCols(members).find(c => colId(c) === 'assignee')
    expect(col?.enableSorting).not.toBe(false)
  })

  it('sorts by assignee display name', () => {
    const fn = getSortFn('assignee', members)
    const alice = row({ assignee: { id: 'u1' } } as Partial<ApiTask>)
    const bob = row({ assignee: { id: 'u2' } } as Partial<ApiTask>)
    expect(fn(alice, bob)).toBeLessThan(0)
    expect(fn(bob, alice)).toBeGreaterThan(0)
  })

  it('collates unassigned rows before assigned ones', () => {
    const fn = getSortFn('assignee', members)
    const none = row({ assignee: null } as Partial<ApiTask>)
    const alice = row({ assignee: { id: 'u1' } } as Partial<ApiTask>)
    expect(fn(none, alice)).toBeLessThan(0)
  })
})

describe('priority sorting (LUM-1284)', () => {
  const PRIORITIES = ['NONE', 'LOW', 'URGENT', 'NONE', 'MEDIUM', 'HIGH']

  // Drives the real priority column through TanStack's sorted row model, so
  // the desc negation and `sortUndefined` are exercised, not re-implemented.
  const sortedPriorities = (desc: boolean) => {
    const columns = createTaskColumns({
      onTaskClick: noop,
      onDeleteTask: asyncNoop,
      members: [],
      visibleColumns: ['priority'],
    })
    const data = PRIORITIES.map(
      (priority, i) => ({ id: `t${i}`, priority }) as unknown as ApiTask
    )
    const table = createTable<ApiTask>({
      data,
      columns,
      state: { sorting: [{ id: 'priority', desc }] },
      onStateChange: noop,
      renderFallbackValue: null,
      getCoreRowModel: getCoreRowModel(),
      getSortedRowModel: getSortedRowModel(),
    })
    return table.getRowModel().rows.map(r => r.original.priority)
  }

  it('ascending: URGENT > HIGH > MEDIUM > LOW, NONE last', () => {
    expect(sortedPriorities(false)).toEqual([
      'URGENT',
      'HIGH',
      'MEDIUM',
      'LOW',
      'NONE',
      'NONE',
    ])
  })

  it('descending flips the assessed levels but keeps NONE last', () => {
    expect(sortedPriorities(true)).toEqual([
      'LOW',
      'MEDIUM',
      'HIGH',
      'URGENT',
      'NONE',
      'NONE',
    ])
  })
})
