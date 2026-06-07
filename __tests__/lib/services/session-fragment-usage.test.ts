/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findProgressContextForMember: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findContentByIds: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    findSessionFragmentEdges: jest.fn(),
    applyUsageVote: jest.fn(),
  },
}))
jest.mock('@/lib/services/task.service', () => ({ taskService: {} }))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {},
}))

import { sessionService } from '@/lib/services/session.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

const identity = {
  user: { id: 'ck1' },
  workspace: { id: 'w1', slug: 'lumo', name: 'Lumo' },
  apiKey: { id: 'ak1', name: 'test', prefix: 'test' },
} as never
const memberId = miscRepository.findMemberIdForHook as jest.Mock
const ctx = sessionRepository.findProgressContextForMember as jest.Mock
const findEdges = lineageEdgeRepository.findSessionFragmentEdges as jest.Mock
const findContent = memoryRepository.findContentByIds as jest.Mock
const applyVote = lineageEdgeRepository.applyUsageVote as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  memberId.mockResolvedValue('m1')
})

describe('getFragmentUsageDraft', () => {
  it('returns empty payload when the session is missing/unowned', async () => {
    ctx.mockResolvedValue(null)
    const r = await sessionService.getFragmentUsageDraft({ identity, sessionId: 's1' })
    expect(r).toEqual({ taskIdentifier: null, candidates: [], alreadyVoted: false })
    expect(findEdges).not.toHaveBeenCalled()
  })

  it('builds labelled candidates with alreadyVoted=false when none voted', async () => {
    ctx.mockResolvedValue({ taskId: 't1', taskIdentifier: 'LUM-42', taskTitle: 'T' })
    findEdges.mockResolvedValue([
      { fragmentType: 'MEMORY', fragmentId: 'mem-1', used: null, usedAt: null },
      { fragmentType: 'WEB_LINK', fragmentId: 'weblink12345678', used: null, usedAt: null },
    ])
    findContent.mockResolvedValue(new Map([['mem-1', '{"trigger":"avoid hsl"}']]))

    const r = await sessionService.getFragmentUsageDraft({ identity, sessionId: 's1' })

    expect(findContent).toHaveBeenCalledWith(['mem-1'])
    expect(r.taskIdentifier).toBe('LUM-42')
    expect(r.alreadyVoted).toBe(false)
    expect(r.candidates).toEqual([
      { fragmentType: 'MEMORY', fragmentId: 'mem-1', label: '[MEMORY] "{"trigger":"avoid hsl"}"', used: null },
      { fragmentType: 'WEB_LINK', fragmentId: 'weblink12345678', label: '[WEB_LINK] weblink1', used: null },
    ])
  })

  it('sets alreadyVoted=true when any edge has usedAt', async () => {
    ctx.mockResolvedValue({ taskId: 't1', taskIdentifier: 'LUM-42', taskTitle: 'T' })
    findEdges.mockResolvedValue([
      { fragmentType: 'MEMORY', fragmentId: 'mem-1', used: true, usedAt: new Date() },
    ])
    findContent.mockResolvedValue(new Map())
    const r = await sessionService.getFragmentUsageDraft({ identity, sessionId: 's1' })
    expect(r.alreadyVoted).toBe(true)
  })
})

describe('applyFragmentUsage', () => {
  it('is a no-op when the session is missing/unowned', async () => {
    ctx.mockResolvedValue(null)
    const r = await sessionService.applyFragmentUsage({
      identity,
      sessionId: 's1',
      usedRefs: [{ fragmentType: 'MEMORY', fragmentId: 'mem-1' }],
    })
    expect(r).toEqual({ used: 0, unused: 0 })
    expect(applyVote).not.toHaveBeenCalled()
  })

  it('delegates to applyUsageVote scoped to the session when owned', async () => {
    ctx.mockResolvedValue({ taskId: 't1', taskIdentifier: 'LUM-42', taskTitle: 'T' })
    applyVote.mockResolvedValue({ used: 1, unused: 2 })
    const r = await sessionService.applyFragmentUsage({
      identity,
      sessionId: 's1',
      usedRefs: [{ fragmentType: 'MEMORY', fragmentId: 'mem-1' }],
    })
    expect(applyVote).toHaveBeenCalledWith('s1', [
      { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
    ])
    expect(r).toEqual({ used: 1, unused: 2 })
  })
})
