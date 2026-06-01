/**
 * @jest-environment node
 */
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: { buildMemorySectionForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findProgressContextForMember: jest.fn(),
    setLastProgressCommentAt: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findTurnSummariesBySession: jest.fn() },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
}))

import { sessionService } from '@/lib/services/session.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'

const identity = { user: { id: 'u1' }, workspace: { id: 'w1' } } as never
const memberId = miscRepository.findMemberIdForHook as jest.Mock
const ctx = sessionRepository.findProgressContextForMember as jest.Mock
const summaries = hookEventRepository.findTurnSummariesBySession as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  memberId.mockResolvedValue('m1')
})

describe('getSessionProgressDraft', () => {
  it('returns empty payload when session is missing/not owned', async () => {
    ctx.mockResolvedValue(null)
    const r = await sessionService.getSessionProgressDraft({ identity, sessionId: 's1' })
    expect(r).toEqual({ taskIdentifier: null, taskTitle: null, summaries: [], watermark: null })
    expect(summaries).not.toHaveBeenCalled()
  })

  it('passes the watermark as the since filter and computes a new watermark', async () => {
    const since = new Date('2026-06-01T09:00:00Z')
    ctx.mockResolvedValue({ taskId: 't1', taskIdentifier: 'LUM-42', taskTitle: 'T', lastProgressCommentAt: since })
    const newest = new Date('2026-06-01T11:00:00Z')
    summaries.mockResolvedValue([
      { id: 'e1', turnSummary: 'A', createdAt: new Date('2026-06-01T10:00:00Z') },
      { id: 'e2', turnSummary: 'B', createdAt: newest },
    ])
    const r = await sessionService.getSessionProgressDraft({ identity, sessionId: 's1' })
    expect(summaries).toHaveBeenCalledWith('s1', since)
    expect(r.taskIdentifier).toBe('LUM-42')
    expect(r.summaries.map(s => s.turnSummary)).toEqual(['A', 'B'])
    expect(r.summaries[0].createdAt).toBe('2026-06-01T10:00:00.000Z') // ISO string
    expect(r.watermark).toBe(newest.toISOString())
  })

  it('returns null watermark when there are no unposted summaries', async () => {
    ctx.mockResolvedValue({ taskId: 't1', taskIdentifier: 'LUM-42', taskTitle: 'T', lastProgressCommentAt: null })
    summaries.mockResolvedValue([])
    const r = await sessionService.getSessionProgressDraft({ identity, sessionId: 's1' })
    expect(summaries).toHaveBeenCalledWith('s1', undefined)
    expect(r.watermark).toBeNull()
    expect(r.summaries).toEqual([])
  })
})
