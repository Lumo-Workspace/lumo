/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findProgressContextForMember: jest.fn(),
    setLastMemoryReviewAt: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findBySourceSessionId: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    applyPlansAtomically: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
}))
jest.mock('@/lib/services/task.service', () => ({ taskService: {} }))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {},
}))

import { sessionService } from '@/lib/services/session.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'

const identity = {
  user: { id: 'ck1' },
  workspace: { id: 'w1', slug: 'lumo', name: 'Lumo' },
  apiKey: { id: 'ak1', name: 'test', prefix: 'test' },
} as never
const memberId = miscRepository.findMemberIdForHook as jest.Mock
const ctx = sessionRepository.findProgressContextForMember as jest.Mock
const findMem = memoryRepository.findBySourceSessionId as jest.Mock
const setWm = sessionRepository.setLastMemoryReviewAt as jest.Mock
const apply = memoryRepository.applyPlansAtomically as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  memberId.mockResolvedValue('m1')
})

describe('getSessionMemoryDraft', () => {
  it('returns empty payload when the session is missing/unowned', async () => {
    ctx.mockResolvedValue(null)
    const r = await sessionService.getSessionMemoryDraft({ identity, sessionId: 's1' })
    expect(r).toEqual({ taskIdentifier: null, memories: [], watermark: null })
    expect(findMem).not.toHaveBeenCalled()
  })

  it('lists session memories since the watermark and computes the new watermark', async () => {
    ctx.mockResolvedValue({
      taskId: 't1', taskIdentifier: 'LUM-42', taskTitle: 'T',
      lastProgressCommentAt: null,
      lastMemoryReviewAt: new Date('2026-06-01T09:00:00.000Z'),
    })
    findMem.mockResolvedValue([
      { id: 'm1', scope: 'TASK', category: 'TRAP', content: { trigger: 'x' }, createdByMemberId: null, createdAt: new Date('2026-06-01T10:00:00.000Z') },
      { id: 'm2', scope: 'TASK', category: 'DECISION', content: { what: 'y' }, createdByMemberId: null, createdAt: new Date('2026-06-01T11:00:00.000Z') },
    ])
    const r = await sessionService.getSessionMemoryDraft({ identity, sessionId: 's1' })
    expect(findMem).toHaveBeenCalledWith('s1', new Date('2026-06-01T09:00:00.000Z'))
    expect(r.taskIdentifier).toBe('LUM-42')
    expect(r.memories).toEqual([
      { id: 'm1', scope: 'TASK', category: 'TRAP', content: { trigger: 'x' }, createdByMemberId: null },
      { id: 'm2', scope: 'TASK', category: 'DECISION', content: { what: 'y' }, createdByMemberId: null },
    ])
    expect(r.watermark).toBe('2026-06-01T11:00:00.000Z')
  })

  it('null watermark when there are no new memories', async () => {
    ctx.mockResolvedValue({ taskId: 't1', taskIdentifier: 'LUM-42', taskTitle: 'T', lastProgressCommentAt: null, lastMemoryReviewAt: null })
    findMem.mockResolvedValue([])
    const r = await sessionService.getSessionMemoryDraft({ identity, sessionId: 's1' })
    expect(r.watermark).toBeNull()
    expect(r.memories).toEqual([])
  })
})

describe('applyMemoryReview', () => {
  it('throws 404 when the session is missing/unowned', async () => {
    ctx.mockResolvedValue(null)
    await expect(
      sessionService.applyMemoryReview({
        identity, sessionId: 's1',
        watermark: '2026-06-01T11:00:00.000Z',
        deleteIds: ['m1'], promoteIds: [],
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('drops ids not belonging to this session, runs the rest atomically, advances watermark', async () => {
    ctx.mockResolvedValue({ taskId: 't1', taskIdentifier: 'LUM-42', taskTitle: 'T', lastProgressCommentAt: null, lastMemoryReviewAt: null })
    findMem.mockResolvedValue([
      { id: 'm1', scope: 'TASK', category: 'TRAP', content: {}, createdByMemberId: null, createdAt: new Date('2026-06-01T10:00:00.000Z') },
      { id: 'm2', scope: 'TASK', category: 'DECISION', content: {}, createdByMemberId: null, createdAt: new Date('2026-06-01T11:00:00.000Z') },
    ])
    const tx = {} as never
    const del = memoryRepository.delete as jest.Mock
    const upd = memoryRepository.update as jest.Mock
    apply.mockImplementation(async (plans: Array<(tx: never) => Promise<void>>) => {
      for (const p of plans) await p(tx)
    })

    const r = await sessionService.applyMemoryReview({
      identity, sessionId: 's1',
      watermark: '2026-06-01T11:00:00.000Z',
      deleteIds: ['m1', 'm9'],
      promoteIds: ['m2'],
    })

    expect(r).toEqual({ deleted: 1, promoted: 1 })
    expect(del).toHaveBeenCalledWith('m1', tx)
    expect(del).not.toHaveBeenCalledWith('m9', tx)
    expect(upd).toHaveBeenCalledWith('m2', { scope: 'PROJECT' }, tx)
    expect(setWm).toHaveBeenCalledWith('s1', new Date('2026-06-01T11:00:00.000Z'))
    expect(apply.mock.invocationCallOrder[0]!).toBeLessThan(setWm.mock.invocationCallOrder[0]!)
  })

  it('advances the watermark even when nothing is deleted/promoted (keep-all)', async () => {
    ctx.mockResolvedValue({ taskId: 't1', taskIdentifier: 'LUM-42', taskTitle: 'T', lastProgressCommentAt: null, lastMemoryReviewAt: null })
    findMem.mockResolvedValue([
      { id: 'm1', scope: 'TASK', category: 'TRAP', content: {}, createdByMemberId: null, createdAt: new Date('2026-06-01T10:00:00.000Z') },
    ])
    const r = await sessionService.applyMemoryReview({
      identity, sessionId: 's1',
      watermark: '2026-06-01T10:00:00.000Z',
      deleteIds: [], promoteIds: [],
    })
    expect(r).toEqual({ deleted: 0, promoted: 0 })
    expect(apply).not.toHaveBeenCalled()
    expect(setWm).toHaveBeenCalledWith('s1', new Date('2026-06-01T10:00:00.000Z'))
  })
})
