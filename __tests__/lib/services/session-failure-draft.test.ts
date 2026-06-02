/**
 * @jest-environment node
 */
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: { buildMemorySectionForTask: jest.fn() },
}))
jest.mock('@/lib/services/comment.service', () => ({
  commentService: { createCommentWithSideEffects: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findProgressContextForMember: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findFailuresBySession: jest.fn() },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByTask: jest.fn(),
    findOrCreateMany: jest.fn(),
    addTaskTags: jest.fn(),
  },
}))

import { sessionService } from '@/lib/services/session.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'

const identity = { user: { id: 'u1' }, workspace: { id: 'w1' } } as never
const memberId = miscRepository.findMemberIdForHook as jest.Mock
const ctx = sessionRepository.findProgressContextForMember as jest.Mock
const failures = hookEventRepository.findFailuresBySession as jest.Mock
const findByTask = tagRepository.findByTask as jest.Mock
const findOrCreate = tagRepository.findOrCreateMany as jest.Mock
const addTaskTags = tagRepository.addTaskTags as jest.Mock

const boundCtx = {
  taskId: 't1',
  taskIdentifier: 'LUM-42',
  taskTitle: 'T',
  lastProgressCommentAt: null,
  lastMemoryReviewAt: null,
}

function bashFails(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'POST_TOOL_USE_FAILURE' as const,
    toolName: 'Bash',
    turnSummary: null,
    payload: { tool_response: { stderr: `err ${i}` } },
    createdAt: new Date(`2026-06-01T10:0${i}:00.000Z`),
  }))
}

beforeEach(() => {
  jest.clearAllMocks()
  memberId.mockResolvedValue('m1')
  findByTask.mockResolvedValue([])
})

describe('getSessionFailureDraft', () => {
  it('returns no-prompt when session is missing/not owned', async () => {
    ctx.mockResolvedValue(null)
    const r = await sessionService.getSessionFailureDraft({ identity, sessionId: 's1' })
    expect(r.shouldPrompt).toBe(false)
    expect(failures).not.toHaveBeenCalled()
  })

  it('returns no-prompt when the session has no bound task', async () => {
    ctx.mockResolvedValue({ ...boundCtx, taskId: null, taskIdentifier: null, taskTitle: null })
    const r = await sessionService.getSessionFailureDraft({ identity, sessionId: 's1' })
    expect(r.shouldPrompt).toBe(false)
    expect(failures).not.toHaveBeenCalled()
  })

  it('prompts when same tool failed ≥3 times and task is not already blocked', async () => {
    ctx.mockResolvedValue(boundCtx)
    failures.mockResolvedValue(bashFails(3))
    const r = await sessionService.getSessionFailureDraft({ identity, sessionId: 's1' })
    expect(r.shouldPrompt).toBe(true)
    expect(r.taskIdentifier).toBe('LUM-42')
    expect(r.topFailure!.label).toBe('Bash')
    expect(r.topFailure!.count).toBe(3)
    expect(r.alreadyBlocked).toBe(false)
  })

  it('does NOT prompt below the threshold', async () => {
    ctx.mockResolvedValue(boundCtx)
    failures.mockResolvedValue(bashFails(2))
    const r = await sessionService.getSessionFailureDraft({ identity, sessionId: 's1' })
    expect(r.shouldPrompt).toBe(false)
  })

  it('does NOT prompt when the task already carries a blocked tag (idempotent gate)', async () => {
    ctx.mockResolvedValue(boundCtx)
    failures.mockResolvedValue(bashFails(5))
    findByTask.mockResolvedValue([{ id: 'tag1', name: 'blocked' }])
    const r = await sessionService.getSessionFailureDraft({ identity, sessionId: 's1' })
    expect(r.alreadyBlocked).toBe(true)
    expect(r.shouldPrompt).toBe(false)
  })
})

describe('markBoundTaskBlocked', () => {
  it('finds-or-creates the blocked tag and attaches it to the bound task', async () => {
    ctx.mockResolvedValue(boundCtx)
    findOrCreate.mockResolvedValue([{ id: 'tagB', name: 'blocked' }])
    const r = await sessionService.markBoundTaskBlocked({ identity, sessionId: 's1' })
    expect(findOrCreate).toHaveBeenCalledWith('w1', ['blocked'])
    expect(addTaskTags).toHaveBeenCalledWith('t1', ['tagB'])
    expect(r).toEqual({ taskIdentifier: 'LUM-42', tag: 'blocked' })
  })

  it('throws 409 when the session has no bound task', async () => {
    ctx.mockResolvedValue({ ...boundCtx, taskId: null, taskIdentifier: null })
    await expect(
      sessionService.markBoundTaskBlocked({ identity, sessionId: 's1' })
    ).rejects.toMatchObject({ status: 409 })
    expect(addTaskTags).not.toHaveBeenCalled()
  })

  it('throws 404 when the session is missing/not owned', async () => {
    ctx.mockResolvedValue(null)
    await expect(
      sessionService.markBoundTaskBlocked({ identity, sessionId: 's1' })
    ).rejects.toMatchObject({ status: 404 })
  })
})
