/** @jest-environment jsdom */
const en: Record<string, string> = {}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => en[id] ?? defaultMessage ?? id,
  }),
}))

const useVirtualizerMock = jest.fn((_opts: unknown): any => ({
  getTotalSize: () => 0,
  getVirtualItems: () => [],
}))
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: unknown) => useVirtualizerMock(opts),
}))

import { render } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TaskListTable } from '@/app/workspace/[workspaceUrl]/components/task-list/TaskListTable'
import { LIST_VIRTUALIZE_THRESHOLD } from '@/lib/utils/shouldVirtualize'
import type { MyTask } from '@/app/workspace/[workspaceUrl]/types'

function makeTasks(n: number): MyTask[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `Task ${i}`,
    status: 'TODO',
    priority: 'MEDIUM',
    projectId: 'p1',
    project: { id: 'p1', name: 'Proj', ownerActorId: null },
    assigneeActorId: null,
    assignee: null,
    updatedAt: new Date('2026-01-01').toISOString(),
  })) as unknown as MyTask[]
}

function renderTable(count: number) {
  return render(
    <TooltipProvider>
      <TaskListTable
        tasks={makeTasks(count)}
        setTasks={jest.fn()}
        members={[]}
        projects={[]}
        onTaskClick={jest.fn()}
        onRetry={jest.fn()}
        selected={new Set()}
        setSelected={jest.fn()}
      />
    </TooltipProvider>
  )
}

describe('TaskListTable virtualization', () => {
  beforeEach(() => useVirtualizerMock.mockClear())

  it('enables the virtualizer above the threshold with the full row count', () => {
    renderTable(LIST_VIRTUALIZE_THRESHOLD + 5)
    const calls = useVirtualizerMock.mock.calls as Array<[unknown]>
    const firstCall = calls[0]
    const opts = (firstCall != null ? firstCall[0] : undefined) as
      | { count: number; enabled: boolean }
      | undefined
    expect(opts?.enabled).toBe(true)
    expect(opts?.count).toBe(LIST_VIRTUALIZE_THRESHOLD + 5)
  })

  it('disables the virtualizer at or below the threshold', () => {
    renderTable(LIST_VIRTUALIZE_THRESHOLD)
    const calls = useVirtualizerMock.mock.calls as Array<[unknown]>
    const firstCall = calls[0]
    const opts = (firstCall != null ? firstCall[0] : undefined) as
      | { enabled: boolean }
      | undefined
    expect(opts?.enabled).toBe(false)
  })
})
