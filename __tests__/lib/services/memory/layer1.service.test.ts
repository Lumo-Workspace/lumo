/**
 * @jest-environment node
 */
jest.mock('@/lib/services/memory/layer1-input', () => ({
  getLayer1Input: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer1-extract', () => ({
  extractLayer1Turn: jest.fn(),
  reconcileLayer1Candidates: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer1-apply', () => ({
  applyLayer1Operations: jest.fn(),
}))
// LUM-773: the LLM grounding gate must never run on the layer1 path any more.
// It stays mocked (not deleted) so a regression that re-imports it is caught.
jest.mock('@/lib/services/memory/ground-candidates', () => ({
  groundCandidates: jest.fn(),
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { setTurnSummary: jest.fn() },
}))
// LUM-538 source de-dup gate is verified in constitution-redundancy.test.ts; a
// no-op here so the two-pass flow assertions aren't perturbed by it.
jest.mock('@/lib/services/memory/extraction-gate', () => ({
  screenCandidate: () => ({ ok: true }),
}))
jest.mock('@/lib/services/memory/constitution', () => ({
  loadConstitutionText: async () => null,
}))

const embedTextsMock = jest.fn().mockResolvedValue([])
jest.mock('@/lib/ai/embedding', () => ({
  embedTexts: (...a: unknown[]) => embedTextsMock(...a),
  EMBEDDING_DIM: 1024,
}))

jest.mock('@/lib/services/memory/embedding-neighbor-retriever', () => ({
  compositeNeighborRetriever: { retrieve: jest.fn().mockResolvedValue([]) },
}))

import { getLayer1Input } from '@/lib/services/memory/layer1-input'
import {
  extractLayer1Turn,
  reconcileLayer1Candidates,
} from '@/lib/services/memory/layer1-extract'
import { applyLayer1Operations } from '@/lib/services/memory/layer1-apply'
import { groundCandidates } from '@/lib/services/memory/ground-candidates'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { compositeNeighborRetriever } from '@/lib/services/memory/embedding-neighbor-retriever'
import { layer1Service } from '@/lib/services/memory/layer1.service'
import type { RawEvent } from '@/lib/services/session-summary/compact-events'

const retrieveMock = compositeNeighborRetriever.retrieve as jest.MockedFunction<
  typeof compositeNeighborRetriever.retrieve
>

const getInput = getLayer1Input as jest.MockedFunction<typeof getLayer1Input>
const extract = extractLayer1Turn as jest.MockedFunction<
  typeof extractLayer1Turn
>
const reconcile = reconcileLayer1Candidates as jest.MockedFunction<
  typeof reconcileLayer1Candidates
>
const apply = applyLayer1Operations as jest.MockedFunction<
  typeof applyLayer1Operations
>
const ground = groundCandidates as jest.MockedFunction<typeof groundCandidates>
const setTurnSummary = hookEventRepository.setTurnSummary as jest.Mock

/** A real turn: one failing Bash call + the STOP. Source text carries P3009. */
function bashFailureTurn(): RawEvent[] {
  const t0 = new Date('2026-05-04T12:00:00Z')
  return [
    {
      id: 'evt_pre',
      type: 'PRE_TOOL_USE',
      toolName: 'Bash',
      payload: {
        tool_input: { command: 'npx prisma migrate dev --name add_status' },
        tool_use_id: 'tool_1',
      },
      createdAt: t0,
    },
    {
      id: 'evt_post',
      type: 'POST_TOOL_USE',
      toolName: 'Bash',
      payload: {
        tool_use_id: 'tool_1',
        tool_response: {
          stderr: "P3009: enum can't add value mid-migration",
          exitCode: 1,
        },
      },
      createdAt: new Date(t0.getTime() + 1000),
    },
    {
      id: 'evt_stop',
      type: 'STOP',
      toolName: null,
      payload: { last_assistant_message: 'Migration failed on the enum.' },
      createdAt: new Date(t0.getTime() + 2000),
    },
  ]
}

/** A trivial turn: no tool calls, one short assistant message. */
function trivialTurn(): RawEvent[] {
  return [
    {
      id: 'evt_stop',
      type: 'STOP',
      toolName: null,
      payload: { last_assistant_message: '好的。' },
      createdAt: new Date('2026-05-04T12:00:00Z'),
    },
  ]
}

const task = {
  id: 'task_1',
  title: 't',
  description: null,
  projectId: 'proj_1',
  workspaceId: 'ws_1',
}
const existingMemories = [
  {
    id: 'mem_a',
    category: 'TRAP' as const,
    content: { trigger: 'x', outcome: 'y' },
  },
]
const fullInput = { task, turnEvents: bashFailureTurn(), existingMemories }

const trigger = {
  sessionId: 's',
  taskId: 'task_1',
  workspaceId: 'ws_1',
  stopEventId: 'evt_stop',
}

const grounded = {
  category: 'TRAP' as const,
  content: { trigger: 'enum value same migration', outcome: 'P3009' },
  quote: 'P3009',
}
const ungrounded = {
  category: 'DECISION' as const,
  content: { what: 'invented', why: 'invented' },
  quote: 'we agreed to switch databases',
}

const applied = {
  added: 0,
  updated: 0,
  deleted: 0,
  superseded: 0,
  noop: 1,
  skipped: 0,
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('layer1Service.triggerLayer1Extraction — one combined call per turn (LUM-773)', () => {
  it('a task-bound STOP makes one combined extract call and no grounding call and the turn summary comes from it', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue({
      summary: '运行 prisma migrate dev，P3009 报错',
      candidates: [grounded],
    })
    reconcile.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue(applied)

    await layer1Service.triggerLayer1Extraction(trigger)

    // Exactly one model-facing extraction for the turn…
    expect(extract).toHaveBeenCalledTimes(1)
    // …no second (LLM) grounding call on this path…
    expect(ground).not.toHaveBeenCalled()
    // …and the summary that call produced is written onto the STOP event.
    expect(setTurnSummary).toHaveBeenCalledTimes(1)
    expect(setTurnSummary).toHaveBeenCalledWith(
      'evt_stop',
      '运行 prisma migrate dev，P3009 报错'
    )
    // The grounded candidate still flows into reconcile, quote stripped.
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(reconcile.mock.calls[0]![0].candidates).toEqual([
      { category: 'TRAP', content: grounded.content },
    ])
  })

  it('writes the summary even when the turn yields no candidates', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue({ summary: '查阅 prisma 迁移', candidates: [] })

    await layer1Service.triggerLayer1Extraction(trigger)

    expect(setTurnSummary).toHaveBeenCalledWith('evt_stop', '查阅 prisma 迁移')
    expect(reconcile).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('leaves the summary unset when the extraction produced none', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue({ summary: null, candidates: [] })

    await layer1Service.triggerLayer1Extraction(trigger)

    expect(setTurnSummary).not.toHaveBeenCalled()
  })

  it('grounds candidates locally: a candidate whose quote is not in the turn reaches neither reconcile nor the DB', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue({
      summary: 's',
      candidates: [grounded, ungrounded],
    })
    reconcile.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue(applied)

    await layer1Service.triggerLayer1Extraction(trigger)

    expect(retrieveMock).toHaveBeenCalledTimes(1)
    expect(reconcile.mock.calls[0]![0].candidates).toEqual([
      { category: 'TRAP', content: grounded.content },
    ])
  })

  it('every candidate failing local grounding stops the pipeline before reconcile and apply', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue({ summary: 's', candidates: [ungrounded] })

    await layer1Service.triggerLayer1Extraction(trigger)

    expect(retrieveMock).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('trivial turns without tool calls skip extraction and make no gateway call', async () => {
    getInput.mockResolvedValue({ ...fullInput, turnEvents: trivialTurn() })

    await layer1Service.triggerLayer1Extraction(trigger)

    expect(extract).not.toHaveBeenCalled()
    expect(ground).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    // No summary written either — the UI falls back to the assistant message.
    expect(setTurnSummary).not.toHaveBeenCalled()
  })

  it('a turn with tool calls is never gated, however short', async () => {
    const shortToolTurn: RawEvent[] = [
      {
        id: 'evt_pre',
        type: 'PRE_TOOL_USE',
        toolName: 'Bash',
        payload: { tool_input: { command: 'ls' }, tool_use_id: 't' },
        createdAt: new Date('2026-05-04T12:00:00Z'),
      },
      {
        id: 'evt_stop',
        type: 'STOP',
        toolName: null,
        payload: { last_assistant_message: 'ok' },
        createdAt: new Date('2026-05-04T12:00:01Z'),
      },
    ]
    getInput.mockResolvedValue({ ...fullInput, turnEvents: shortToolTurn })
    extract.mockResolvedValue({ summary: '运行 ls', candidates: [] })

    await layer1Service.triggerLayer1Extraction(trigger)

    expect(extract).toHaveBeenCalledTimes(1)
  })
})

describe('layer1Service.triggerLayer1Extraction (two-pass)', () => {
  it('skips when taskId is null', async () => {
    await layer1Service.triggerLayer1Extraction({ ...trigger, taskId: null })
    expect(getInput).not.toHaveBeenCalled()
    expect(extract).not.toHaveBeenCalled()
  })

  it('skips apply when reconcile returns no operations', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue({ summary: 's', candidates: [grounded] })
    reconcile.mockResolvedValue([])
    await layer1Service.triggerLayer1Extraction(trigger)
    expect(apply).not.toHaveBeenCalled()
  })

  it('runs extract → reconcile → apply, feeding neighbors per candidate', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue({ summary: 's', candidates: [grounded] })
    reconcile.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue(applied)
    embedTextsMock.mockResolvedValue([[0.1, 0.2]])

    await layer1Service.triggerLayer1Extraction(trigger)

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
      expect.objectContaining({
        existingMemories: [{ id: 'mem_a', category: 'TRAP' }],
      })
    )
  })

  it('degrades to lexical (vector undefined) when embedTexts rejects, still completes', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue({ summary: 's', candidates: [grounded] })
    reconcile.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue(applied)
    embedTextsMock.mockRejectedValue(new Error('no key'))

    // Must not throw — fire-and-forget contract
    await expect(
      layer1Service.triggerLayer1Extraction(trigger)
    ).resolves.toBeUndefined()

    // Retriever was still called, but with vector: undefined (lexical fallback)
    expect(retrieveMock).toHaveBeenCalledTimes(1)
    const ctx = retrieveMock.mock.calls[0]![0]
    expect(ctx.query.vector).toBeUndefined()
  })

  it('swallows unexpected errors (fire-and-forget contract)', async () => {
    getInput.mockRejectedValue(new Error('db down'))
    await expect(
      layer1Service.triggerLayer1Extraction(trigger)
    ).resolves.toBeUndefined()
  })
})
