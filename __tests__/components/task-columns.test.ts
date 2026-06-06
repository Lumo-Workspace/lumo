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
jest.mock('@/app/workspace/[workspaceUrl]/components/fields/StatusSelect', () => ({ StatusSelect: () => null }))
jest.mock('@/app/workspace/[workspaceUrl]/components/fields/PrioritySelect', () => ({ PrioritySelect: () => null }))
jest.mock('@/app/workspace/[workspaceUrl]/components/fields/AssigneeSelect', () => ({ AssigneeSelect: () => null }))
jest.mock('@/app/workspace/[workspaceUrl]/components/fields/DueDatePicker', () => ({ DueDatePicker: () => null }))
jest.mock('@/app/workspace/[workspaceUrl]/components/fields/ProjectSelect', () => ({ ProjectSelect: () => null }))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTableSort', () => ({
  cmpStatus: () => 0,
  cmpPriority: () => 0,
}))

import { createTaskColumns } from '@/app/workspace/[workspaceUrl]/components/data-table/task-columns'
import type { ColumnDef } from '@tanstack/react-table'
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
      visibleColumns: ['select','identifier','title','status','priority','dueDate','assignee','updatedAt','actions'],
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
      visibleColumns: ['select','identifier','title','project','status','priority','dueDate','assignee','updatedAt','actions'],
    })
    expect(cols.map(colId)).toContain('project')
  })

  it('emits columns in canonical order regardless of input order', () => {
    const cols = createTaskColumns({
      onTaskClick: noop,
      onDeleteTask: asyncNoop,
      members: [],
      visibleColumns: ['actions','title','select'],
    })
    expect(cols.map(colId)).toEqual(['select','title','actions'])
  })
})
