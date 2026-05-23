/**
 * @jest-environment node
 *
 * Black-box test for the Layer 2 orchestrator: verifies project enumeration,
 * per-project isolation (one failure does not block other projects), and
 * the skip / empty-extraction code paths.
 */
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findProjectIdsWithTaskScopeMemory: jest.fn(),
  },
}))
jest.mock('@/lib/services/memory/layer2-input', () => ({
  getLayer2Input: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer2-extract', () => ({
  extractLayer2Operations: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer2-apply', () => ({
  applyLayer2Operations: jest.fn(),
}))

import { memoryRepository } from '@/lib/repositories/memory.repository'
import { getLayer2Input } from '@/lib/services/memory/layer2-input'
import { extractLayer2Operations } from '@/lib/services/memory/layer2-extract'
import { applyLayer2Operations } from '@/lib/services/memory/layer2-apply'
import { layer2Service } from '@/lib/services/memory/layer2.service'

const findProjects =
  memoryRepository.findProjectIdsWithTaskScopeMemory as jest.MockedFunction<
    typeof memoryRepository.findProjectIdsWithTaskScopeMemory
  >
const getInput = getLayer2Input as jest.MockedFunction<typeof getLayer2Input>
const extract = extractLayer2Operations as jest.MockedFunction<
  typeof extractLayer2Operations
>
const apply = applyLayer2Operations as jest.MockedFunction<
  typeof applyLayer2Operations
>

function makeInput(overrides: { projectId: string }) {
  return {
    project: {
      id: overrides.projectId,
      name: 'P',
      workspaceId: 'ws_1',
    },
    taskMemories: [],
    existingProjectMemories: [],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('layer2Service.runConsolidation', () => {
  it('returns an empty run when no project has TASK-scope memory', async () => {
    findProjects.mockResolvedValue([])
    const result = await layer2Service.runConsolidation()
    expect(result).toEqual({ projects: [], skippedProjects: [] })
    expect(getInput).not.toHaveBeenCalled()
  })

  it('skips a project whose input is null (project gone or no TASK rows)', async () => {
    findProjects.mockResolvedValue(['proj_1'])
    getInput.mockResolvedValue(null)
    const result = await layer2Service.runConsolidation()
    expect(result.skippedProjects).toEqual(['proj_1'])
    expect(result.projects).toEqual([])
    expect(extract).not.toHaveBeenCalled()
  })

  it('records zero-result run when extraction returns empty ops', async () => {
    // Extraction degrades to empty list when the LLM call fails — we still
    // want a row in the result so monitoring can see "we tried" rather than
    // a silent skip.
    findProjects.mockResolvedValue(['proj_1'])
    getInput.mockResolvedValue(makeInput({ projectId: 'proj_1' }))
    extract.mockResolvedValue([])
    const result = await layer2Service.runConsolidation()
    expect(result.projects).toEqual([
      { projectId: 'proj_1', added: 0, updated: 0, noop: 0, skipped: 0 },
    ])
    expect(apply).not.toHaveBeenCalled()
  })

  it('runs the full pipeline per project on the happy path', async () => {
    findProjects.mockResolvedValue(['proj_1', 'proj_2'])
    getInput
      .mockResolvedValueOnce(makeInput({ projectId: 'proj_1' }))
      .mockResolvedValueOnce(makeInput({ projectId: 'proj_2' }))
    extract
      .mockResolvedValueOnce([
        {
          type: 'ADD',
          category: 'TRAP',
          content: { trigger: 't', outcome: 'o' },
        },
      ])
      .mockResolvedValueOnce([{ type: 'NOOP' }])
    apply
      .mockResolvedValueOnce({ added: 1, updated: 0, noop: 0, skipped: 0 })
      .mockResolvedValueOnce({ added: 0, updated: 0, noop: 1, skipped: 0 })

    const result = await layer2Service.runConsolidation()

    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        projectId: 'proj_1',
        workspaceId: 'ws_1',
      })
    )
    expect(result.projects).toEqual([
      { projectId: 'proj_1', added: 1, updated: 0, noop: 0, skipped: 0 },
      { projectId: 'proj_2', added: 0, updated: 0, noop: 1, skipped: 0 },
    ])
  })

  it('isolates per-project failures so one bad project does not block others', async () => {
    // proj_1 throws mid-pipeline; proj_2 must still get its turn and the
    // result list should record the failure so it shows up in cron logs.
    findProjects.mockResolvedValue(['proj_1', 'proj_2'])
    getInput
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(makeInput({ projectId: 'proj_2' }))
    extract.mockResolvedValueOnce([{ type: 'NOOP' }])
    apply.mockResolvedValueOnce({ added: 0, updated: 0, noop: 1, skipped: 0 })

    const result = await layer2Service.runConsolidation()

    expect(result.projects).toEqual([
      expect.objectContaining({ projectId: 'proj_1', error: 'db down' }),
      expect.objectContaining({ projectId: 'proj_2', noop: 1 }),
    ])
  })
})
