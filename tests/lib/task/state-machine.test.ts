import {
  isValidTaskTransition,
  InvalidTaskTransitionError,
  transitionTaskStatus,
} from '@/lib/task/state-machine'
import type { TaskStatusValue } from '@/lib/task/state-machine'

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn(), update: jest.fn() },
  },
}))

jest.mock('@/lib/events/dispatcher', () => ({
  dispatchEvents: jest.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/db/prisma'
import { dispatchEvents } from '@/lib/events/dispatcher'

const mockFindUnique = prisma.task.findUnique as jest.Mock
const mockUpdate = prisma.task.update as jest.Mock
const mockDispatchEvents = dispatchEvents as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdate.mockResolvedValue({})
  mockDispatchEvents.mockResolvedValue(undefined)
})

// ── isValidTaskTransition ──────────────────────────────────────────────────

describe('isValidTaskTransition', () => {
  const allowed: [TaskStatusValue, TaskStatusValue][] = [
    ['TODO', 'IN_PROGRESS'],
    ['TODO', 'IN_REVIEW'],
    ['TODO', 'DONE'],
    ['IN_PROGRESS', 'TODO'],
    ['IN_PROGRESS', 'IN_REVIEW'],
    ['IN_PROGRESS', 'DONE'],
    ['IN_REVIEW', 'TODO'],
    ['IN_REVIEW', 'IN_PROGRESS'],
    ['IN_REVIEW', 'DONE'],
    ['DONE', 'TODO'],
    ['DONE', 'IN_PROGRESS'],
    // LUM-586: undo of acceptance verdict — the legitimate DONE → IN_REVIEW path.
    ['DONE', 'IN_REVIEW'],
  ]

  it.each(allowed)('%s → %s is valid', (from, to) => {
    expect(isValidTaskTransition(from, to)).toBe(true)
  })

  it('same status returns false (not in transition list)', () => {
    expect(isValidTaskTransition('TODO', 'TODO')).toBe(false)
    // LUM-586: verify DONE self-transition is also blocked.
    expect(isValidTaskTransition('DONE', 'DONE')).toBe(false)
  })
})

// ── InvalidTaskTransitionError ─────────────────────────────────────────────

describe('InvalidTaskTransitionError', () => {
  it('includes task ID and states in message', () => {
    const err = new InvalidTaskTransitionError('task-1', 'DONE', 'IN_REVIEW')
    expect(err.message).toContain('DONE')
    expect(err.message).toContain('IN_REVIEW')
    expect(err.message).toContain('task-1')
    expect(err.name).toBe('InvalidTaskTransitionError')
    expect(err.taskId).toBe('task-1')
    expect(err.from).toBe('DONE')
    expect(err.to).toBe('IN_REVIEW')
  })
})

// ── transitionTaskStatus ───────────────────────────────────────────────────

describe('transitionTaskStatus', () => {
  it('reads current status from DB when not provided', async () => {
    mockFindUnique.mockResolvedValue({ status: 'TODO' })

    await transitionTaskStatus('task-1', 'proj-1', 'IN_PROGRESS')

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      select: { status: true },
    })
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'IN_PROGRESS' },
    })
  })

  it('uses currentStatus option to skip DB read', async () => {
    await transitionTaskStatus('task-1', 'proj-1', 'DONE', {
      currentStatus: 'IN_REVIEW',
    })

    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      // LUM-1282: entering DONE stamps completedAt.
      data: { status: 'DONE', completedAt: expect.any(Date) },
    })
  })

  it('no-ops when current status equals target', async () => {
    const events = await transitionTaskStatus('task-1', 'proj-1', 'TODO', {
      currentStatus: 'TODO',
    })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockDispatchEvents).not.toHaveBeenCalled()
    expect(events).toHaveLength(0)
  })

  it('dispatches domain events by default', async () => {
    const events = await transitionTaskStatus(
      'task-1',
      'proj-1',
      'IN_PROGRESS',
      {
        currentStatus: 'TODO',
      }
    )

    expect(mockDispatchEvents).toHaveBeenCalledWith([
      {
        type: 'task:status_changed',
        taskId: 'task-1',
        projectId: 'proj-1',
        from: 'TODO',
        to: 'IN_PROGRESS',
      },
    ])
    expect(events).toHaveLength(1)
  })

  it('skips dispatch when skipDispatch is true', async () => {
    const events = await transitionTaskStatus(
      'task-1',
      'proj-1',
      'IN_PROGRESS',
      {
        currentStatus: 'TODO',
        skipDispatch: true,
      }
    )

    expect(mockUpdate).toHaveBeenCalled()
    expect(mockDispatchEvents).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'task:status_changed',
      taskId: 'task-1',
      from: 'TODO',
      to: 'IN_PROGRESS',
    })
  })

  it('throws InvalidTaskTransitionError on invalid transition', async () => {
    // After LUM-586 all cross-status pairs are valid and same-status hits the
    // no-op early-return. To exercise the real throw branch at line 98–100 in
    // state-machine.ts we supply a currentStatus value that isn't in the
    // TRANSITIONS map — isValidTaskTransition returns false for any unknown
    // `from`, which triggers the throw exactly as production would for a
    // genuinely invalid pair.  The cast to TaskStatusValue is only needed here
    // in the test; production callers always pass validated enum values.
    await expect(
      transitionTaskStatus('task-x', 'proj-x', 'DONE', {
        currentStatus: 'NONEXISTENT' as any as TaskStatusValue,
      })
    ).rejects.toThrow(InvalidTaskTransitionError)

    // The throw must happen before any DB write.
    expect(mockUpdate).not.toHaveBeenCalled()

    // Verify the error carries the right shape.
    const err = new InvalidTaskTransitionError('task-x', 'IN_REVIEW', 'DONE')
    expect(err.taskId).toBe('task-x')
    expect(err.from).toBe('IN_REVIEW')
    expect(err.to).toBe('DONE')
    expect(err.name).toBe('InvalidTaskTransitionError')
  })

  it('throws when task not found', async () => {
    mockFindUnique.mockResolvedValue(null)

    await expect(
      transitionTaskStatus('task-1', 'proj-1', 'IN_PROGRESS')
    ).rejects.toThrow('Task task-1 not found')
  })

  it('DONE → TODO is allowed (reopen)', async () => {
    await transitionTaskStatus('task-1', 'proj-1', 'TODO', {
      currentStatus: 'DONE',
    })

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      // LUM-1282: leaving DONE clears completedAt.
      data: { status: 'TODO', completedAt: null },
    })
  })

  it('DONE → IN_PROGRESS is allowed (reopen)', async () => {
    await transitionTaskStatus('task-1', 'proj-1', 'IN_PROGRESS', {
      currentStatus: 'DONE',
    })

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'IN_PROGRESS', completedAt: null },
    })
  })
})
