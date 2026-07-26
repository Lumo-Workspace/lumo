/**
 * LUM-705: task ↔ sprint membership is gated on the sprint's calendar window,
 * not on the DB `status` enum. A sprint closed early (all its work landed) is
 * still the window the team is living in, so it must stay writable; the guard
 * only freezes sprints that ended before the most recent one.
 */
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { DAY_MS } from '@/lib/services/sprint-date'

const mockSprintCount = jest.fn()
const mockSprintFindUnique = jest.fn()
const mockTaskFindUnique = jest.fn()
const mockTaskUpdateMany = jest.fn()
const mockQueryRaw = jest.fn()
const mockActivityCreateMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    sprint: {
      count: (...args: any[]) => mockSprintCount(...args),
      findUnique: (...args: any[]) => mockSprintFindUnique(...args),
    },
    task: {
      findUnique: (...args: any[]) => mockTaskFindUnique(...args),
      updateMany: (...args: any[]) => mockTaskUpdateMany(...args),
    },
    taskActivity: {
      create: (...args: any[]) => mockActivityCreateMany(...args),
    },
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
    $transaction: async (fn: any) =>
      fn({
        $queryRaw: (...args: any[]) => mockQueryRaw(...args),
        task: { updateMany: (...args: any[]) => mockTaskUpdateMany(...args) },
        taskActivity: {
          create: (...args: any[]) => mockActivityCreateMany(...args),
        },
      }),
  },
}))

/** UTC-midnight calendar day `offset` days from today — how sprints are stored. */
function dayFromToday(offset: number): Date {
  const t = new Date()
  return new Date(
    Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) +
      offset * DAY_MS
  )
}

function sprintRow(
  id: string,
  startOffset: number,
  endOffset: number,
  status: string
) {
  return {
    id,
    teamId: 'team-1',
    status,
    startDate: dayFromToday(startOffset),
    endDate: dayFromToday(endOffset),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQueryRaw.mockResolvedValue([{ id: 'sp-current', status: 'CLOSED' }])
  mockTaskUpdateMany.mockResolvedValue({ count: 1 })
  mockActivityCreateMany.mockResolvedValue({})
})

describe('sprintRepository.isOpenForTaskMembership', () => {
  it('keeps a CLOSED sprint writable while its window still covers today', async () => {
    const open = await sprintRepository.isOpenForTaskMembership(
      sprintRow('sp-current', -13, 0, 'CLOSED')
    )
    expect(open).toBe(true)
    // In-window sprints never need the "did anything end later" lookup.
    expect(mockSprintCount).not.toHaveBeenCalled()
  })

  it('keeps an upcoming sprint writable', async () => {
    const open = await sprintRepository.isOpenForTaskMembership(
      sprintRow('sp-next', 1, 14, 'DRAFT')
    )
    expect(open).toBe(true)
  })

  it('keeps the most recently ended sprint writable as the spillover target', async () => {
    mockSprintCount.mockResolvedValueOnce(0)
    const open = await sprintRepository.isOpenForTaskMembership(
      sprintRow('sp-just-ended', -14, -1, 'CLOSED')
    )
    expect(open).toBe(true)
  })

  it('freezes a sprint that ended before a more recent one', async () => {
    mockSprintCount.mockResolvedValueOnce(2)
    const open = await sprintRepository.isOpenForTaskMembership(
      sprintRow('sp-old', -41, -28, 'CLOSED')
    )
    expect(open).toBe(false)
  })
})

describe('sprintRepository.addTaskAtomically', () => {
  it('adds a task to a CLOSED sprint whose window is still current', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: 'task-1',
      teamId: 'team-1',
      sprintId: null,
    })
    mockSprintFindUnique.mockResolvedValueOnce(
      sprintRow('sp-current', -13, 0, 'CLOSED')
    )

    await expect(
      sprintRepository.addTaskAtomically('task-1', 'sp-current', 'actor-1')
    ).resolves.toEqual({ taskId: 'task-1', sprintId: 'sp-current' })
  })

  it('rejects a sprint that ended before a more recent one with 409', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: 'task-1',
      teamId: 'team-1',
      sprintId: null,
    })
    mockSprintFindUnique.mockResolvedValueOnce(
      sprintRow('sp-old', -41, -28, 'CLOSED')
    )
    mockSprintCount.mockResolvedValueOnce(1)

    await expect(
      sprintRepository.addTaskAtomically('task-1', 'sp-old', 'actor-1')
    ).rejects.toMatchObject({ status: 409 })
    expect(mockTaskUpdateMany).not.toHaveBeenCalled()
  })
})

describe('sprintRepository.removeTaskAtomically', () => {
  it('removes a task from a CLOSED sprint whose window is still current', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: 'task-1',
      teamId: 'team-1',
      sprintId: 'sp-current',
    })
    mockSprintFindUnique.mockResolvedValueOnce(
      sprintRow('sp-current', -13, 0, 'CLOSED')
    )

    await expect(
      sprintRepository.removeTaskAtomically('task-1', 'actor-1')
    ).resolves.toEqual({ taskId: 'task-1', sprintId: null })
  })

  it('rejects removing a task from a sprint that already ended with 409', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: 'task-1',
      teamId: 'team-1',
      sprintId: 'sp-old',
    })
    mockSprintFindUnique.mockResolvedValueOnce(
      sprintRow('sp-old', -41, -28, 'CLOSED')
    )
    mockSprintCount.mockResolvedValueOnce(1)

    await expect(
      sprintRepository.removeTaskAtomically('task-1', 'actor-1')
    ).rejects.toMatchObject({ status: 409 })
    expect(mockTaskUpdateMany).not.toHaveBeenCalled()
  })
})
