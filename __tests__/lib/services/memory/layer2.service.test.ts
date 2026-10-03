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
  extractLayer2Candidates: jest.fn(),
  reconcileLayer2Candidates: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer2-apply', () => ({
  applyLayer2Operations: jest.fn(),
}))
jest.mock('@/lib/services/memory/ground-candidates', () => ({
  groundCandidates: jest.fn(),
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    tryClaimLayer2Lease: jest.fn(),
    releaseLayer2Lease: jest.fn(),
  },
}))

const embedTextsMock = jest.fn().mockResolvedValue([])
jest.mock('@/lib/ai/embedding', () => ({
  embedTexts: (...a: unknown[]) => embedTextsMock(...a),
  EMBEDDING_DIM: 1024,
}))

jest.mock('@/lib/services/memory/embedding-neighbor-retriever', () => ({
  compositeNeighborRetriever: { retrieve: jest.fn().mockResolvedValue([]) },
}))

import { getLayer2Input } from '@/lib/services/memory/layer2-input'
import {
  extractLayer2Candidates,
  reconcileLayer2Candidates,
} from '@/lib/services/memory/layer2-extract'
import { applyLayer2Operations } from '@/lib/services/memory/layer2-apply'
import { groundCandidates } from '@/lib/services/memory/ground-candidates'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { compositeNeighborRetriever } from '@/lib/services/memory/embedding-neighbor-retriever'
import { layer2Service } from '@/lib/services/memory/layer2.service'

// LUM-917: the AI-derived content switch (on unless a test turns it off).
const mockAiDerivedEnabled = jest.fn()
jest.mock('@/lib/services/ai-derived-content.service', () => ({
  aiDerivedContentService: {
    isEnabled: (...args: unknown[]) => mockAiDerivedEnabled(...args),
  },
}))

const retrieveMock = compositeNeighborRetriever.retrieve as jest.MockedFunction<
  typeof compositeNeighborRetriever.retrieve
>

const getInput = getLayer2Input as jest.MockedFunction<typeof getLayer2Input>
const extract = extractLayer2Candidates as jest.MockedFunction<
  typeof extractLayer2Candidates
>
const reconcile = reconcileLayer2Candidates as jest.MockedFunction<
  typeof reconcileLayer2Candidates
>
const apply = applyLayer2Operations as jest.MockedFunction<
  typeof applyLayer2Operations
>
const repo = memoryRepository as jest.Mocked<typeof memoryRepository>
const ground = groundCandidates as jest.MockedFunction<typeof groundCandidates>

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
  mockAiDerivedEnabled.mockResolvedValue(true)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  // Default: the lease is free, so the run proceeds. Tests that exercise
  // contention override this.
  repo.tryClaimLayer2Lease.mockResolvedValue(true)
  repo.releaseLayer2Lease.mockResolvedValue(undefined)
  // Default: the grounding gate passes every candidate through.
  ground.mockImplementation(async ({ candidates }) => ({
    kept: candidates,
    discardedCount: 0,
  }))
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
    expect(reconcile).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(repo.releaseLayer2Lease).not.toHaveBeenCalled()
  })

  it('releases the lease after a successful run', async () => {
    getInput.mockResolvedValue(makeInput())
    extract.mockResolvedValue([
      { category: 'TRAP', content: { trigger: 't', outcome: 'o' } },
    ])
    reconcile.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue({
      added: 0,
      updated: 0,
      superseded: 0,
      noop: 1,
      skipped: 0,
    })

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
    expect(reconcile).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('returns a zero-result row when extraction yields no candidates', async () => {
    // The LLM call can degrade to an empty list on failure. Returning a
    // structured zero-result (instead of null) lets the caller distinguish
    // "ran but produced nothing" from "had nothing to run on".
    getInput.mockResolvedValue(makeInput())
    extract.mockResolvedValue([])
    const result = await layer2Service.runForProject('proj_1')
    expect(result).toEqual({
      added: 0,
      updated: 0,
      superseded: 0,
      noop: 0,
      skipped: 0,
    })
    expect(reconcile).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('runs the full pipeline on the happy path', async () => {
    getInput.mockResolvedValue(makeInput())
    extract.mockResolvedValue([
      { category: 'TRAP', content: { trigger: 't', outcome: 'o' } },
    ])
    reconcile.mockResolvedValue([
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 't', outcome: 'o' },
      },
    ])
    apply.mockResolvedValue({
      added: 1,
      updated: 0,
      superseded: 0,
      noop: 0,
      skipped: 0,
    })

    const result = await layer2Service.runForProject('proj_1')

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj_1',
        workspaceId: 'ws_1',
      })
    )
    expect(result).toEqual({
      added: 1,
      updated: 0,
      superseded: 0,
      noop: 0,
      skipped: 0,
    })
  })

  it('forwards the input-window task memory ids as validSourceMemoryIds', async () => {
    getInput.mockResolvedValue({
      ...makeInput(),
      taskMemories: [
        { id: 'mem_a', taskId: 'task_a', category: 'TRAP', content: {} },
      ],
    })
    extract.mockResolvedValue([
      { category: 'TRAP', content: { trigger: 't', outcome: 'o' } },
    ])
    reconcile.mockResolvedValue([
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 't', outcome: 'o' },
      },
    ])
    apply.mockResolvedValue({
      added: 1,
      updated: 0,
      superseded: 0,
      noop: 0,
      skipped: 0,
    })

    await layer2Service.runForProject('proj_1', null)

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ validSourceMemoryIds: ['mem_a'] })
    )
  })

  it('runs extract → reconcile → apply and feeds neighbors per candidate', async () => {
    // getLayer2Input → input with one existing PROJECT memory in the pool + one task memory
    getInput.mockResolvedValue({
      project: { id: 'proj_1', name: 'P', workspaceId: 'ws_1' },
      taskMemories: [
        {
          id: 'tm_1',
          taskId: 't1',
          category: 'TRAP',
          content: { trigger: 'a', outcome: 'b' },
        },
      ],
      existingProjectMemories: [
        {
          id: 'pm_1',
          category: 'TRAP',
          content: { trigger: 'a', outcome: 'b' },
        },
      ],
      constitution: { claudeMd: null, agentsMd: null },
    })
    extract.mockResolvedValue([
      {
        category: 'TRAP',
        content: { trigger: 'a2', outcome: 'b2' },
        sourceMemoryIds: ['tm_1'],
      },
    ])
    reconcile.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue({
      added: 0,
      updated: 0,
      superseded: 0,
      noop: 1,
      skipped: 0,
    })
    embedTextsMock.mockResolvedValue([[0.1, 0.2]])

    await layer2Service.runForProject('proj_1')

    const reconcileArg = reconcile.mock.calls[0]![0]
    expect(reconcileArg.candidates).toHaveLength(1)
    expect(reconcileArg.neighborsByCandidate).toHaveLength(1)
    // Retriever was called once (per candidate) with a RetrieveContext with PROJECT scope
    expect(retrieveMock).toHaveBeenCalledTimes(1)
    expect(retrieveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: 'PROJECT', projectId: 'proj_1' },
      })
    )
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ validSourceMemoryIds: ['tm_1'] })
    )
  })

  it('degrades to lexical (vector undefined) when embedTexts rejects, still completes', async () => {
    getInput.mockResolvedValue({
      project: { id: 'proj_1', name: 'P', workspaceId: 'ws_1' },
      taskMemories: [
        {
          id: 'tm_1',
          taskId: 't1',
          category: 'TRAP',
          content: { trigger: 'a', outcome: 'b' },
        },
      ],
      existingProjectMemories: [],
      constitution: { claudeMd: null, agentsMd: null },
    })
    extract.mockResolvedValue([
      { category: 'TRAP', content: { trigger: 'a', outcome: 'b' } },
    ])
    reconcile.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue({
      added: 0,
      updated: 0,
      superseded: 0,
      noop: 1,
      skipped: 0,
    })
    embedTextsMock.mockRejectedValue(new Error('no key'))

    // Must not throw — fire-and-forget contract at the caller level
    await layer2Service.runForProject('proj_1')

    // Retriever was still called, but with vector: undefined (lexical fallback)
    expect(retrieveMock).toHaveBeenCalledTimes(1)
    const ctx = retrieveMock.mock.calls[0]![0]
    expect(ctx.query.vector).toBeUndefined()
  })
})

describe('layer2Service grounding gate (LUM-396)', () => {
  const supported = {
    category: 'TRAP' as const,
    content: { trigger: 'real', outcome: 'o' },
    sourceMemoryIds: ['tm_1'],
  }
  const hallucinated = {
    category: 'DECISION' as const,
    content: { what: 'invented', why: 'invented' },
  }

  it('grounding runs between extract and neighbor retrieval/reconcile; a discarded candidate reaches neither reconcile nor apply', async () => {
    getInput.mockResolvedValue({
      ...makeInput(),
      taskMemories: [
        {
          id: 'tm_1',
          taskId: 't1',
          category: 'TRAP',
          content: { trigger: 'real', outcome: 'o' },
        },
      ],
    })
    extract.mockResolvedValue([supported, hallucinated])
    ground.mockResolvedValue({ kept: [supported], discardedCount: 1 })
    reconcile.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue({
      added: 0,
      updated: 0,
      superseded: 0,
      noop: 1,
      skipped: 0,
    })

    await layer2Service.runForProject('proj_1')

    // Ordering: grounding saw the raw extract output…
    expect(ground).toHaveBeenCalledTimes(1)
    expect(ground.mock.calls[0]![0].candidates).toEqual([
      supported,
      hallucinated,
    ])
    // …and only the kept candidate flows into retrieval and reconcile.
    expect(retrieveMock).toHaveBeenCalledTimes(1)
    const reconcileArg = reconcile.mock.calls[0]![0]
    expect(reconcileArg.candidates).toEqual([supported])
    expect(reconcileArg.neighborsByCandidate).toHaveLength(1)
    // Grounding happened before retrieval (call order).
    expect(ground.mock.invocationCallOrder[0]!).toBeLessThan(
      retrieveMock.mock.invocationCallOrder[0]!
    )
  })

  it('grounding discarding everything returns a zero-result row before reconcile and apply', async () => {
    getInput.mockResolvedValue(makeInput())
    extract.mockResolvedValue([hallucinated])
    ground.mockResolvedValue({ kept: [], discardedCount: 1 })

    const result = await layer2Service.runForProject('proj_1')

    expect(result).toEqual({
      added: 0,
      updated: 0,
      superseded: 0,
      noop: 0,
      skipped: 0,
    })
    expect(retrieveMock).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(repo.releaseLayer2Lease).toHaveBeenCalledWith('proj_1')
  })
})

describe('layer2Service.triggerForTaskCompletion', () => {
  it('does nothing when the workspace turned AI-derived content off (LUM-917)', async () => {
    mockAiDerivedEnabled.mockResolvedValue(false)
    await layer2Service.triggerForTaskCompletion({
      taskId: 'task_1',
      projectId: 'proj_1',
    })
    expect(mockAiDerivedEnabled).toHaveBeenCalledWith({ projectId: 'proj_1' })
    expect(getInput).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it("runs the pipeline for the task's project", async () => {
    getInput.mockResolvedValue(makeInput())
    extract.mockResolvedValue([
      { category: 'TRAP', content: { trigger: 't', outcome: 'o' } },
    ])
    reconcile.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue({
      added: 0,
      updated: 0,
      superseded: 0,
      noop: 1,
      skipped: 0,
    })

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
      { category: 'TRAP', content: { trigger: 't', outcome: 'o' } },
    ])
    reconcile.mockResolvedValue([
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 't', outcome: 'o' },
      },
    ])
    apply.mockResolvedValue({
      added: 1,
      updated: 0,
      superseded: 0,
      noop: 0,
      skipped: 0,
    })

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
      { category: 'TRAP', content: { trigger: 't', outcome: 'o' } },
    ])
    reconcile.mockResolvedValue([
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 't', outcome: 'o' },
      },
    ])
    apply.mockResolvedValue({
      added: 1,
      updated: 0,
      superseded: 0,
      noop: 0,
      skipped: 0,
    })

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
