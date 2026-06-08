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
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    tryClaimLayer2Lease: jest.fn(),
    releaseLayer2Lease: jest.fn(),
  },
}))

import { getLayer2Input } from '@/lib/services/memory/layer2-input'
import { extractLayer2Operations } from '@/lib/services/memory/layer2-extract'
import { applyLayer2Operations } from '@/lib/services/memory/layer2-apply'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { layer2Service } from '@/lib/services/memory/layer2.service'

const getInput = getLayer2Input as jest.MockedFunction<typeof getLayer2Input>
const extract = extractLayer2Operations as jest.MockedFunction<
  typeof extractLayer2Operations
>
const apply = applyLayer2Operations as jest.MockedFunction<
  typeof applyLayer2Operations
>
const repo = memoryRepository as jest.Mocked<typeof memoryRepository>

function makeInput() {
  return {
    project: { id: 'proj_1', name: 'P', workspaceId: 'ws_1' },
    taskMemories: [],
    existingProjectMemories: [],
    constitution: { claudeMd: null, agentsMd: null },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  // Default: the lease is free, so the run proceeds. Tests that exercise
  // contention override this.
  repo.tryClaimLayer2Lease.mockResolvedValue(true)
  repo.releaseLayer2Lease.mockResolvedValue(undefined)
})

describe('layer2Service.runForProject', () => {
  it('skips without running the pipeline when the lease is held', async () => {
    // A concurrent run already holds the per-project lease. This run must not
    // read or promote anything — that's exactly the path that prevents
    // duplicate PROJECT-scope promotions.
    repo.tryClaimLayer2Lease.mockResolvedValue(false)

    const result = await layer2Service.runForProject('proj_1')

    expect(result).toBeNull()
    expect(getInput).not.toHaveBeenCalled()
    expect(extract).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(repo.releaseLayer2Lease).not.toHaveBeenCalled()
  })

  it('releases the lease after a successful run', async () => {
    getInput.mockResolvedValue(makeInput())
    extract.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue({ added: 0, updated: 0, superseded: 0, noop: 1, skipped: 0 })

    await layer2Service.runForProject('proj_1')

    expect(repo.releaseLayer2Lease).toHaveBeenCalledWith('proj_1')
  })

  it('releases the lease even when the pipeline throws', async () => {
    getInput.mockRejectedValue(new Error('boom'))

    await expect(layer2Service.runForProject('proj_1')).rejects.toThrow('boom')

    expect(repo.releaseLayer2Lease).toHaveBeenCalledWith('proj_1')
  })

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
    apply.mockResolvedValue({ added: 1, updated: 0, superseded: 0, noop: 0, skipped: 0 })

    const result = await layer2Service.runForProject('proj_1')

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj_1',
        workspaceId: 'ws_1',
      })
    )
    expect(result).toEqual({ added: 1, updated: 0, noop: 0, skipped: 0 })
  })

  it('forwards the input-window task memory ids as validSourceMemoryIds', async () => {
    getInput.mockResolvedValue({
      ...makeInput(),
      taskMemories: [
        { id: 'mem_a', taskId: 'task_a', category: 'TRAP', content: {} },
      ],
    })
    extract.mockResolvedValue([
      { type: 'ADD', category: 'TRAP', content: { trigger: 't', outcome: 'o' } },
    ])
    apply.mockResolvedValue({ added: 1, updated: 0, superseded: 0, noop: 0, skipped: 0 })

    await layer2Service.runForProject('proj_1', null)

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ validSourceMemoryIds: ['mem_a'] })
    )
  })
})

describe('layer2Service.triggerForTaskCompletion', () => {
  it("runs the pipeline for the task's project", async () => {
    getInput.mockResolvedValue(makeInput())
    extract.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue({ added: 0, updated: 0, superseded: 0, noop: 1, skipped: 0 })

    await layer2Service.triggerForTaskCompletion({
      taskId: 'task_1',
      projectId: 'proj_1',
    })

    expect(getInput).toHaveBeenCalledWith('proj_1')
    expect(apply).toHaveBeenCalled()
  })

  it('threads sourceSessionId through to applyLayer2Operations (LUM-165)', async () => {
    // Attribution: the session that marked the task done must be stamped on
    // the promoted PROJECT memories so the next session-start can review them.
    getInput.mockResolvedValue(makeInput())
    extract.mockResolvedValue([
      { type: 'ADD', category: 'TRAP', content: { trigger: 't', outcome: 'o' } },
    ])
    apply.mockResolvedValue({ added: 1, updated: 0, superseded: 0, noop: 0, skipped: 0 })

    await layer2Service.triggerForTaskCompletion({
      taskId: 'task_1',
      projectId: 'proj_1',
      sourceSessionId: 'sess_42',
    })

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSessionId: 'sess_42' })
    )
  })

  it('passes sourceSessionId=null when the trigger omits it (Web UI path)', async () => {
    getInput.mockResolvedValue(makeInput())
    extract.mockResolvedValue([
      { type: 'ADD', category: 'TRAP', content: { trigger: 't', outcome: 'o' } },
    ])
    apply.mockResolvedValue({ added: 1, updated: 0, superseded: 0, noop: 0, skipped: 0 })

    await layer2Service.triggerForTaskCompletion({
      taskId: 'task_1',
      projectId: 'proj_1',
    })

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSessionId: null })
    )
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
