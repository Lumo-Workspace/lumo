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

jest.mock('@/lib/pusher/server', () => ({
  pushProjectEvent: jest.fn().mockReturnValue(Promise.resolve()),
}))

import { prisma } from '@/lib/db/prisma'
import { pushProjectEvent } from '@/lib/pusher/server'

const mockFindUnique = prisma.task.findUnique as jest.Mock
const mockUpdate = prisma.task.update as jest.Mock
const mockPushProjectEvent = pushProjectEvent as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdate.mockResolvedValue({})
  mockPushProjectEvent.mockReturnValue(Promise.resolve())
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
  ]

  it.each(allowed)('%s → %s is valid', (from, to) => {
    expect(isValidTaskTransition(from, to)).toBe(true)
  })

  const blocked: [TaskStatusValue, TaskStatusValue][] = [['DONE', 'IN_REVIEW']]

  it.each(blocked)('%s → %s is blocked', (from, to) => {
    expect(isValidTaskTransition(from, to)).toBe(false)
  })

  it('same status returns false (not in transition list)', () => {
    expect(isValidTaskTransition('TODO', 'TODO')).toBe(false)
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
      data: { status: 'DONE' },
    })
  })

  it('no-ops when current status equals target', async () => {
    await transitionTaskStatus('task-1', 'proj-1', 'TODO', {
      currentStatus: 'TODO',
    })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockPushProjectEvent).not.toHaveBeenCalled()
  })

  it('broadcasts project event by default', async () => {
    await transitionTaskStatus('task-1', 'proj-1', 'IN_PROGRESS', {
      currentStatus: 'TODO',
    })

    expect(mockPushProjectEvent).toHaveBeenCalledWith('proj-1', {
      type: 'task:updated',
      taskId: 'task-1',
      fields: ['status'],
      patch: { status: 'IN_PROGRESS' },
    })
  })

  it('skips broadcast when skipBroadcast is true', async () => {
    await transitionTaskStatus('task-1', 'proj-1', 'IN_PROGRESS', {
      currentStatus: 'TODO',
      skipBroadcast: true,
    })

    expect(mockUpdate).toHaveBeenCalled()
    expect(mockPushProjectEvent).not.toHaveBeenCalled()
  })

  it('throws InvalidTaskTransitionError on invalid transition', async () => {
    await expect(
      transitionTaskStatus('task-1', 'proj-1', 'IN_REVIEW', {
        currentStatus: 'DONE',
      })
    ).rejects.toThrow(InvalidTaskTransitionError)

    expect(mockUpdate).not.toHaveBeenCalled()
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
      data: { status: 'TODO' },
    })
  })

  it('DONE → IN_PROGRESS is allowed (reopen)', async () => {
    await transitionTaskStatus('task-1', 'proj-1', 'IN_PROGRESS', {
      currentStatus: 'DONE',
    })

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'IN_PROGRESS' },
    })
  })
})
