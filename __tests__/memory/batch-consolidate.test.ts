/**
 * @jest-environment node
 *
 * LUM-541 (P5) — one-time batch consolidation sweep over the stock PROJECT-scope
 * memories. Two axes, both reviewable in one batch:
 *  - near-dup MERGE: cluster ACTIVE PROJECT memories at cosine >= floor, report
 *    the live cluster count, and propose a canonical-keep + supersede-set per
 *    multi-member cluster (canonical = the most judged-used row, so the proven
 *    entry survives). Pure/derived — no writes at compute time.
 *  - retire: reuse the LUM-540 retire-candidate computation, aggregated across
 *    all projects, alongside the merge proposals.
 */
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveProjectMemoryVectors: jest.fn(),
    archiveMemoriesInWorkspace: jest.fn(),
  },
}))
jest.mock('@/lib/services/lineage.service', () => ({
  lineageService: { fragmentTrustForMemories: jest.fn() },
}))
jest.mock('@/lib/services/memory/retire.service', () => ({
  computeProjectRetireCandidates: jest.fn(),
}))

import {
  computeProjectMergeProposals,
  computeBatchConsolidation,
} from '@/lib/services/memory/batch-consolidate.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageService } from '@/lib/services/lineage.service'
import { computeProjectRetireCandidates } from '@/lib/services/memory/retire.service'

const findVectors = memoryRepository.findActiveProjectMemoryVectors as jest.Mock
const archive = memoryRepository.archiveMemoriesInWorkspace as jest.Mock
const fragmentTrust = lineageService.fragmentTrustForMemories as jest.Mock
const retireCandidates = computeProjectRetireCandidates as jest.Mock

function verdict(judgedUsedTasks: number) {
  return {
    judgedUsedTasks,
    auditedTasks: 6,
    appearanceTasks: 6,
    usefulnessPct: 0,
    qualified: true,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

test('batch near-dup sweep clusters project memories and proposes canonical-keep with supersede-set per cluster', async () => {
  // a & b are near-duplicates (cosine ~1); c and d are distinct singletons.
  findVectors.mockResolvedValue([
    { id: 'a', vector: [1, 0] },
    { id: 'b', vector: [1, 0.01] },
    { id: 'c', vector: [0, 1] },
    { id: 'd', vector: [1, 1] },
  ])
  // b is the proven entry (judged-used more) → it must be kept as canonical.
  fragmentTrust.mockResolvedValue({ a: verdict(0), b: verdict(5) })

  const report = await computeProjectMergeProposals('proj1')

  expect(findVectors).toHaveBeenCalledWith('proj1')
  expect(report.nearDupClusterCount).toBe(1)
  expect(report.mergeProposals).toEqual([
    { canonicalId: 'b', supersededIds: ['a'] },
  ])
  // compute is read-only — no archive at proposal time
  expect(archive).not.toHaveBeenCalled()
})

test('batch sweep aggregates retire candidates across projects', async () => {
  // No near-dup vectors here — focus on the retire axis aggregating per project.
  findVectors.mockResolvedValue([])
  retireCandidates.mockImplementation(async (projectId: string) =>
    projectId === 'p1'
      ? [{ memoryId: 'm1', reasons: ['low-judged-used'] }]
      : [{ memoryId: 'm2', reasons: ['contradiction'] }]
  )

  const report = await computeBatchConsolidation(['p1', 'p2'])

  expect(retireCandidates).toHaveBeenCalledWith('p1')
  expect(retireCandidates).toHaveBeenCalledWith('p2')
  expect(report.projects.map(p => p.projectId)).toEqual(['p1', 'p2'])
  expect(report.projects[0]!.retireCandidates).toEqual([
    { memoryId: 'm1', reasons: ['low-judged-used'] },
  ])
  expect(report.projects[1]!.retireCandidates).toEqual([
    { memoryId: 'm2', reasons: ['contradiction'] },
  ])
})
