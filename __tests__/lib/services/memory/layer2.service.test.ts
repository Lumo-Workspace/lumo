/**
 * @jest-environment node
 *
 * Black-box tests for the Layer 2 service after LUM-72 moved the trigger
 * from a cron iterate-all-projects orchestrator to an event-driven
 * per-project entrypoint. Verifies:
 *   - triggerForTaskCompletion never throws (fire-and-forget contract)
 *   - runForProject skips cleanly when input is null
 *   - runForProject returns a zero-result row when the LLM returns []
 *   - runForProject runs the full pipeline on the happy path
 */
jest.mock('@/lib/services/memory/layer2-input', () => ({
  getLayer2Input: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer2-extract', () => ({
  extractLayer2Operations: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer2-apply', () => ({
  applyLayer2Operations: jest.fn(),
}))

import { getLayer2Input } from '@/lib/services/memory/layer2-input'
import { extractLayer2Operations } from '@/lib/services/memory/layer2-extract'
import { applyLayer2Operations } from '@/lib/services/memory/layer2-apply'
import { layer2Service } from '@/lib/services/memory/layer2.service'

const getInput = getLayer2Input as jest.MockedFunction<typeof getLayer2Input>
const extract = extractLayer2Operations as jest.MockedFunction<
  typeof extractLayer2Operations
>
const apply = applyLayer2Operations as jest.MockedFunction<
  typeof applyLayer2Operations
>

function makeInput() {
  return {
    project: { id: 'proj_1', name: 'P', workspaceId: 'ws_1' },
    taskMemories: [],
    existingProjectMemories: [],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('layer2Service.runForProject', () => {
  it('returns null when the project has no input to consolidate', async () => {
    getInput.mockResolvedValue(null)
    const result = await layer2Service.runForProject('proj_1')
    expect(result).toBeNull()
    expect(extract).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('returns a zero-result row when extraction yields no ops', async () => {
    // The LLM call can degrade to an empty list on failure. Returning a
    // structured zero-result (instead of null) lets the caller distinguish
    // "ran but produced nothing" from "had nothing to run on".
    getInput.mockResolvedValue(makeInput())
    extract.mockResolvedValue([])
    const result = await layer2Service.runForProject('proj_1')
    expect(result).toEqual({ added: 0, updated: 0, noop: 0, skipped: 0 })
    expect(apply).not.toHaveBeenCalled()
  })

  it('runs the full pipeline on the happy path', async () => {
    getInput.mockResolvedValue(makeInput())
    extract.mockResolvedValue([
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 't', outcome: 'o' },
      },
    ])
    apply.mockResolvedValue({ added: 1, updated: 0, noop: 0, skipped: 0 })

    const result = await layer2Service.runForProject('proj_1')

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj_1',
        workspaceId: 'ws_1',
      })
    )
    expect(result).toEqual({ added: 1, updated: 0, noop: 0, skipped: 0 })
  })
})

describe('layer2Service.triggerForTaskCompletion', () => {
  it("runs the pipeline for the task's project", async () => {
    getInput.mockResolvedValue(makeInput())
    extract.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue({ added: 0, updated: 0, noop: 1, skipped: 0 })

    await layer2Service.triggerForTaskCompletion({
      taskId: 'task_1',
      projectId: 'proj_1',
    })

    expect(getInput).toHaveBeenCalledWith('proj_1')
    expect(apply).toHaveBeenCalled()
  })

  it('swallows unexpected errors instead of throwing (fire-and-forget contract)', async () => {
    // The caller wraps this in waitUntil(), which means any thrown error
    // becomes an unhandled rejection in the serverless runtime. The
    // service must catch its own faults.
    getInput.mockRejectedValue(new Error('db down'))
    await expect(
      layer2Service.triggerForTaskCompletion({
        taskId: 'task_1',
        projectId: 'proj_1',
      })
    ).resolves.toBeUndefined()
  })
})
