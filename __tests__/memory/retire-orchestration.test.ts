/**
 * @jest-environment node
 *
 * LUM-540 (P4a) — orchestration: assemble a project's retire candidates from the
 * live judged-used track record (lineageService.fragmentTrustForMemories) over
 * its ACTIVE PROJECT memories, plus an injected contradiction set (curation-judge
 * clearly-wrong). Pure selection lives in selectRetireCandidates; this wires the
 * two reads. No writes.
 */
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    listForProject: jest.fn(),
    archiveMemories: jest.fn(),
  },
}))
jest.mock('@/lib/services/lineage.service', () => ({
  lineageService: { fragmentTrustForMemories: jest.fn() },
}))

import { computeProjectRetireCandidates } from '@/lib/services/memory/retire.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageService } from '@/lib/services/lineage.service'

const listForProject = memoryRepository.listForProject as jest.Mock
const archive = memoryRepository.archiveMemories as jest.Mock
const fragmentTrust = lineageService.fragmentTrustForMemories as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

test('assembles project candidates from live judged-used trust without writing', async () => {
  listForProject.mockResolvedValue([
    { id: 'low' },
    { id: 'proven' },
    { id: 'cold' },
  ])
  fragmentTrust.mockResolvedValue({
    low: {
      judgedUsedTasks: 0,
      auditedTasks: 5,
      appearanceTasks: 5,
      usefulnessPct: 0,
      qualified: false,
    },
    proven: {
      judgedUsedTasks: 4,
      auditedTasks: 6,
      appearanceTasks: 6,
      usefulnessPct: 67,
      qualified: true,
    },
    // 'cold' omitted by fragmentTrustForMemories (below cold-start grace)
  })

  const candidates = await computeProjectRetireCandidates('proj1')

  expect(listForProject).toHaveBeenCalledWith('proj1')
  expect(candidates).toEqual([
    { memoryId: 'low', reasons: ['low-judged-used'] },
  ])
  // orchestration is read-only
  expect(archive).not.toHaveBeenCalled()
})

test('folds an injected contradiction set into the same candidate list', async () => {
  listForProject.mockResolvedValue([{ id: 'wrong' }, { id: 'fine' }])
  fragmentTrust.mockResolvedValue({})

  const candidates = await computeProjectRetireCandidates('proj1', {
    contradictionMemoryIds: new Set(['wrong']),
  })

  expect(candidates).toEqual([
    { memoryId: 'wrong', reasons: ['contradiction'] },
  ])
})

test('empty project yields no candidates and skips the trust read', async () => {
  listForProject.mockResolvedValue([])

  const candidates = await computeProjectRetireCandidates('proj1')

  expect(candidates).toEqual([])
  expect(fragmentTrust).not.toHaveBeenCalled()
})
