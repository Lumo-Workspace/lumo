/**
 * @jest-environment node
 */
jest.mock('@/lib/services/memory/layer1-input', () => ({ getLayer1Input: jest.fn() }))
jest.mock('@/lib/services/memory/layer1-extract', () => ({
  extractLayer1Candidates: jest.fn(),
  reconcileLayer1Candidates: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer1-apply', () => ({ applyLayer1Operations: jest.fn() }))

const embedTextsMock = jest.fn().mockResolvedValue([])
jest.mock('@/lib/ai/embedding', () => ({ embedTexts: (...a: unknown[]) => embedTextsMock(...a), EMBEDDING_DIM: 1024 }))

jest.mock('@/lib/services/memory/embedding-neighbor-retriever', () => ({
  compositeNeighborRetriever: { retrieve: jest.fn().mockResolvedValue([]) },
}))

import { getLayer1Input } from '@/lib/services/memory/layer1-input'
import {
  extractLayer1Candidates,
  reconcileLayer1Candidates,
} from '@/lib/services/memory/layer1-extract'
import { applyLayer1Operations } from '@/lib/services/memory/layer1-apply'
import { compositeNeighborRetriever } from '@/lib/services/memory/embedding-neighbor-retriever'
import { layer1Service } from '@/lib/services/memory/layer1.service'

const retrieveMock = compositeNeighborRetriever.retrieve as jest.MockedFunction<
  typeof compositeNeighborRetriever.retrieve
>

const getInput = getLayer1Input as jest.MockedFunction<typeof getLayer1Input>
const extract = extractLayer1Candidates as jest.MockedFunction<typeof extractLayer1Candidates>
const reconcile = reconcileLayer1Candidates as jest.MockedFunction<typeof reconcileLayer1Candidates>
const apply = applyLayer1Operations as jest.MockedFunction<typeof applyLayer1Operations>

const fullInput = {
  task: { id: 'task_1', title: 't', description: null, projectId: 'proj_1', workspaceId: 'ws_1' },
  turnEvents: [],
  existingMemories: [{ id: 'mem_a', category: 'TRAP' as const, content: { trigger: 'x', outcome: 'y' } }],
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('layer1Service.triggerLayer1Extraction (two-pass)', () => {
  it('skips when taskId is null', async () => {
    await layer1Service.triggerLayer1Extraction({ sessionId: 's', taskId: null, workspaceId: 'w' })
    expect(getInput).not.toHaveBeenCalled()
    expect(extract).not.toHaveBeenCalled()
  })

  it('skips reconcile + apply when no candidates', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue([])
    await layer1Service.triggerLayer1Extraction({ sessionId: 's', taskId: 'task_1', workspaceId: 'ws_1' })
    expect(reconcile).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('skips apply when reconcile returns no operations', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue([{ category: 'TRAP', content: { trigger: 'x', outcome: 'y' } }])
    reconcile.mockResolvedValue([])
    await layer1Service.triggerLayer1Extraction({ sessionId: 's', taskId: 'task_1', workspaceId: 'ws_1' })
    expect(apply).not.toHaveBeenCalled()
  })

  it('runs extract → reconcile → apply, feeding neighbors per candidate', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue([{ category: 'TRAP', content: { trigger: 'enum value same migration', outcome: 'P3009' } }])
    reconcile.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue({ added: 0, updated: 0, deleted: 0, superseded: 0, noop: 1, skipped: 0 })
    embedTextsMock.mockResolvedValue([[0.1, 0.2]])

    await layer1Service.triggerLayer1Extraction({ sessionId: 's', taskId: 'task_1', workspaceId: 'ws_1' })

    const reconcileArg = reconcile.mock.calls[0]![0]
    expect(reconcileArg.candidates).toHaveLength(1)
    expect(reconcileArg.neighborsByCandidate).toHaveLength(1)
    // Retriever was called once (per candidate) with a RetrieveContext with TASK scope
    expect(retrieveMock).toHaveBeenCalledTimes(1)
    expect(retrieveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: 'TASK', taskId: 'task_1' },
      })
    )
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ existingMemories: [{ id: 'mem_a', category: 'TRAP' }] })
    )
  })

  it('degrades to lexical (vector undefined) when embedTexts rejects, still completes', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue([{ category: 'TRAP', content: { trigger: 'x', outcome: 'y' } }])
    reconcile.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue({ added: 0, updated: 0, deleted: 0, superseded: 0, noop: 1, skipped: 0 })
    embedTextsMock.mockRejectedValue(new Error('no key'))

    // Must not throw — fire-and-forget contract
    await expect(
      layer1Service.triggerLayer1Extraction({ sessionId: 's', taskId: 'task_1', workspaceId: 'ws_1' })
    ).resolves.toBeUndefined()

    // Retriever was still called, but with vector: undefined (lexical fallback)
    expect(retrieveMock).toHaveBeenCalledTimes(1)
    const ctx = retrieveMock.mock.calls[0]![0]
    expect(ctx.query.vector).toBeUndefined()
  })

  it('swallows unexpected errors (fire-and-forget contract)', async () => {
    getInput.mockRejectedValue(new Error('db down'))
    await expect(
      layer1Service.triggerLayer1Extraction({ sessionId: 's', taskId: 'task_1', workspaceId: 'ws_1' })
    ).resolves.toBeUndefined()
  })
})
