/**
 * LUM-538 — the constitution-redundancy gate is wired at the SOURCE, not only
 * at Layer 2: a candidate already documented in CLAUDE.md/AGENTS.md is rejected
 * on BOTH the Layer-1 extraction path and the manual `memory add` path.
 */

const CONSTITUTION = [
  '# CLAUDE.md',
  '## Code Style',
  '- Use async/await, not .then()',
  '- No console.log in production code, use proper logging',
  '- Use Prisma for all database access — never raw SQL',
].join('\n')

// Shared: the gate loads the constitution through this module on both paths.
jest.mock('@/lib/services/memory/constitution', () => ({
  loadConstitutionText: jest.fn(async () => CONSTITUTION),
  loadConstitution: jest.fn(async () => ({
    claudeMd: CONSTITUTION,
    agentsMd: null,
  })),
}))
jest.mock('@/lib/ai/embedding', () => ({
  embedTexts: jest.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
}))

// ── Manual-path collaborators ──
const mockCreate = jest.fn(async () => ({ id: 'new-mem' }))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    listForProject: jest.fn(async () => []),
    listForTask: jest.fn(async () => []),
    create: (...a: unknown[]) => mockCreate(...(a as [])),
    setEmbedding: jest.fn(async () => {}),
    updateContent: jest.fn(async () => {}),
    supersede: jest.fn(async () => ({ newId: 'x' })),
  },
}))
jest.mock('@/lib/services/memory/canonicalize-language', () => ({
  canonicalizeToEnglish: async (_c: unknown, content: unknown) => content,
}))
const mockResolveManualDedup = jest.fn(async () => ({ kind: 'ADD' as const }))
jest.mock('@/lib/services/memory/manual-dedup', () => ({
  resolveManualDedup: (...a: unknown[]) => mockResolveManualDedup(...(a as [])),
}))

// ── Layer-1-path collaborators ──
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { setTurnSummary: jest.fn(async () => {}) },
}))
jest.mock('@/lib/services/memory/layer1-input', () => ({
  getLayer1Input: jest.fn(async () => ({
    task: {
      id: 't1',
      title: 'Task',
      description: null,
      projectId: 'p1',
      workspaceId: 'w1',
    },
    existingMemories: [],
    // LUM-773: a real tool-call turn — trivial turns are gated before
    // extraction, and local grounding needs source text to quote from.
    turnEvents: [
      {
        id: 'evt_pre',
        type: 'PRE_TOOL_USE',
        toolName: 'Bash',
        payload: {
          tool_input: { command: 'npm run slack:retry' },
          tool_use_id: 't1',
        },
        createdAt: new Date('2026-05-04T12:00:00Z'),
      },
      {
        id: 'evt_stop',
        type: 'STOP',
        payload: {
          last_assistant_message:
            'Slack webhook retries exhaust after 3 attempts and the notification is silently dropped.',
        },
        createdAt: new Date('2026-05-04T12:00:01Z'),
      },
    ],
    agent: undefined,
  })),
}))
const mockExtract = jest.fn()
const mockReconcile = jest.fn(async () => [])
jest.mock('@/lib/services/memory/layer1-extract', () => ({
  extractLayer1Turn: (...a: unknown[]) => mockExtract(...(a as [])),
  reconcileLayer1Candidates: (...a: unknown[]) => mockReconcile(...(a as [])),
}))
jest.mock('@/lib/services/memory/ground-candidates', () => ({
  groundCandidates: jest.fn(
    async ({ candidates }: { candidates: unknown[] }) => ({
      kept: candidates,
      discardedCount: 0,
    })
  ),
}))
const mockApply = jest.fn(async () => ({}))
jest.mock('@/lib/services/memory/layer1-apply', () => ({
  applyLayer1Operations: (...a: unknown[]) => mockApply(...(a as [])),
}))
jest.mock('@/lib/services/memory/embedding-neighbor-retriever', () => ({
  compositeNeighborRetriever: { retrieve: jest.fn(async () => []) },
}))

import { memoryManagementService } from '@/lib/services/memory-management.service'
import { layer1Service } from '@/lib/services/memory/layer1.service'

const REDUNDANT = {
  category: 'CONVENTION' as const,
  content: {
    rule: 'Use Prisma for all database access, never raw SQL',
    scope: 'all database code',
  },
}
const NOVEL = {
  category: 'TRAP' as const,
  content: {
    trigger: 'Slack webhook retries exhaust after 3 attempts',
    outcome: 'notification silently dropped; add a dead-letter log',
  },
}
// LUM-773: the extract pass attaches a verbatim quote per candidate; both
// are grounded here so ONLY the constitution gate decides their fate.
const REDUNDANT_Q = { ...REDUNDANT, quote: 'npm run slack:retry' }
const NOVEL_Q = {
  ...NOVEL,
  quote: 'Slack webhook retries exhaust after 3 attempts',
}

beforeEach(() => jest.clearAllMocks())

describe('source constitution-redundancy gate (LUM-538)', () => {
  it('constitution-redundant candidates are rejected at Layer1 and manual add', async () => {
    // ── Manual path: redundant add is refused (422); novel add proceeds. ──
    await expect(
      memoryManagementService.createForProject({
        projectId: 'p1',
        workspaceId: 'w1',
        category: REDUNDANT.category,
        content: REDUNDANT.content,
        actorMemberId: 'm1',
      })
    ).rejects.toMatchObject({ status: 422 })
    expect(mockCreate).not.toHaveBeenCalled()

    const ok = await memoryManagementService.createForProject({
      projectId: 'p1',
      workspaceId: 'w1',
      category: NOVEL.category,
      content: NOVEL.content,
      actorMemberId: 'm1',
    })
    expect(ok.outcome).toBe('ADD')
    expect(mockCreate).toHaveBeenCalledTimes(1)

    // ── Layer-1 path: a redundant + a novel candidate are extracted; only the
    // novel one survives the gate and reaches reconcile. ──
    mockExtract.mockResolvedValueOnce({
      summary: '运行 slack 重试脚本',
      candidates: [REDUNDANT_Q, NOVEL_Q],
    })
    await layer1Service.triggerLayer1Extraction({
      sessionId: 's1',
      taskId: 't1',
      workspaceId: 'w1',
      stopEventId: 'evt_stop',
    })
    expect(mockReconcile).toHaveBeenCalledTimes(1)
    const reconcileArgs = mockReconcile.mock.calls[0] as unknown as [
      { candidates: Array<{ content: { trigger?: string } }> },
    ]
    const reconcileArg = reconcileArgs[0]
    expect(reconcileArg.candidates).toHaveLength(1)
    expect(reconcileArg.candidates[0]!.content.trigger).toBe(
      NOVEL.content.trigger
    )
  })
})
