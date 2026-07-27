/**
 * @jest-environment node
 *
 * LUM-397 — memory birth-task accounting. `Memory.sourceTaskId` records the
 * task whose session extracted/recorded the memory, captured at creation and
 * never mutated. Unlike `taskId` (a scope pointer that PROJECT promotion
 * nulls out), the birth record survives scope changes and supersedes — it is
 * the reverse lookup that lays the data for same-task self-credit exclusion
 * (follow-up; no scoring change in this task). Layer-2 consolidation rows
 * have a multi-task origin and stay null (provenance edges carry the
 * sources). No backfill: pre-LUM-397 rows stay null, accepted as-is.
 */

// Embeddings fail closed: content writes must not depend on the gateway, and
// skipping vectors keeps these tests off the raw-SQL setEmbedding path.
jest.mock('@/lib/ai/embedding', () => ({
  embedTexts: jest.fn().mockRejectedValue(new Error('gateway offline')),
  EMBEDDING_DIM: 1024,
}))
jest.mock('@/lib/services/memory/supersede-guard', () => ({
  resolveGuardedSupersedeIds: jest.fn().mockResolvedValue(new Set<string>()),
}))
// promoteToProject only canonicalizes when content is passed; mocked anyway so
// this suite never touches the LLM gateway module.
jest.mock('@/lib/services/memory/canonicalize-language', () => ({
  canonicalizeToEnglish: jest.fn(
    async (_c: unknown, content: unknown) => content
  ),
}))
jest.mock('@/lib/services/memory/manual-dedup', () => ({
  resolveManualDedup: jest.fn().mockResolvedValue({ kind: 'ADD' }),
}))
// Silence the expected "embedTexts failed" warnings from the failing-gateway mock.
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockMemoryCreate = jest.fn()
const mockMemoryUpdate = jest.fn()
const mockMemoryFindUnique = jest.fn()
const mockMemoryFindUniqueOrThrow = jest.fn()
const mockProvenanceCreate = jest.fn()

jest.mock('@/lib/db/prisma', () => {
  // Built inside the factory (jest.mock is hoisted above const initializers);
  // the mock* fns are referenced lazily, so they resolve at call time.
  const client = {
    memory: {
      create: (...a: unknown[]) => mockMemoryCreate(...a),
      update: (...a: unknown[]) => mockMemoryUpdate(...a),
      findUnique: (...a: unknown[]) => mockMemoryFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => mockMemoryFindUniqueOrThrow(...a),
    },
    memoryProvenance: {
      create: (...a: unknown[]) => mockProvenanceCreate(...a),
    },
  }
  return {
    prisma: {
      ...client,
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
    },
  }
})

import { memoryRepository } from '@/lib/repositories/memory.repository'
import { memoryManagementService } from '@/lib/services/memory-management.service'
import { applyLayer1Operations } from '@/lib/services/memory/layer1-apply'
import { applyLayer2Operations } from '@/lib/services/memory/layer2-apply'

const DECISION_CONTENT = { what: 'use X', why: 'because Y' }

beforeEach(() => {
  jest.clearAllMocks()
  mockMemoryCreate.mockResolvedValue({ id: 'mem_new' })
  mockMemoryUpdate.mockResolvedValue({ id: 'mem_1' })
  mockProvenanceCreate.mockResolvedValue({ id: 'prov_1' })
})

// ── Layer-1 extraction: birth task recorded for BOTH scopes ─────────────────

describe('Layer-1 extraction ADD records the birth task', () => {
  const baseInput = {
    taskId: 'task_birth',
    projectId: 'proj_1',
    workspaceId: 'ws_1',
    sessionId: 'sess_1',
    existingMemories: [],
  }

  it('TASK-scope ADD carries sourceTaskId = the extracting task (alongside taskId)', async () => {
    const result = await applyLayer1Operations({
      ...baseInput,
      operations: [
        { type: 'ADD', category: 'DECISION', content: DECISION_CONTENT },
      ] as any,
    })

    expect(result.added).toBe(1)
    expect(mockMemoryCreate).toHaveBeenCalledTimes(1)
    const { data } = mockMemoryCreate.mock.calls[0][0]
    expect(data.taskId).toBe('task_birth')
    expect(data.sourceTaskId).toBe('task_birth')
    expect(data.scope).toBe('TASK')
  })

  it('PROJECT-scope ADD nulls taskId (scope pointer) but still records sourceTaskId (birth)', async () => {
    await applyLayer1Operations({
      ...baseInput,
      operations: [
        {
          type: 'ADD',
          category: 'DECISION',
          content: DECISION_CONTENT,
          scope: 'PROJECT',
        },
      ] as any,
    })

    const { data } = mockMemoryCreate.mock.calls[0][0]
    expect(data.scope).toBe('PROJECT')
    expect(data.taskId).toBeNull()
    // This is exactly the reverse lookup the column restores: before LUM-397
    // a PROJECT-scope sediment could not be traced back to its birth task.
    expect(data.sourceTaskId).toBe('task_birth')
  })
})

// ── Layer-2 consolidation: multi-task origin stays null ────────────────────

describe('Layer-2 consolidation ADD leaves sourceTaskId null', () => {
  it('a promoted PROJECT memory has no single birth task — provenance edges carry the sources', async () => {
    const result = await applyLayer2Operations({
      operations: [
        { type: 'ADD', category: 'DECISION', content: DECISION_CONTENT },
      ] as any,
      projectId: 'proj_1',
      workspaceId: 'ws_1',
      existingProjectMemories: [],
      sourceSessionId: 'sess_1',
    })

    expect(result.added).toBe(1)
    const { data } = mockMemoryCreate.mock.calls[0][0]
    expect(data.sourceTaskId).toBeNull()
    expect(data.scope).toBe('PROJECT')
  })
})

// ── Immutability: the birth record survives every lifecycle mutation ────────

describe('sourceTaskId is an immutable birth record', () => {
  it('SUPERSEDE copies it onto the replacement row', async () => {
    mockMemoryFindUniqueOrThrow.mockResolvedValue({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      taskId: 'task_1',
      scope: 'TASK',
      category: 'DECISION',
      agent: 'CLAUDE_CODE',
      sourceSessionId: 'sess_orig',
      createdByMemberId: null,
      sourceTaskId: 'task_birth',
    })

    await memoryRepository.supersede('mem_old', DECISION_CONTENT)

    const { data } = mockMemoryCreate.mock.calls[0][0]
    expect(data.sourceTaskId).toBe('task_birth')
  })

  it('the supersede copy reads the birth record from the old row (select includes it)', async () => {
    mockMemoryFindUniqueOrThrow.mockResolvedValue({ sourceTaskId: null })

    await memoryRepository.supersede('mem_old', DECISION_CONTENT)

    const { select } = mockMemoryFindUniqueOrThrow.mock.calls[0][0]
    expect(select.sourceTaskId).toBe(true)
  })

  it('TASK→PROJECT promote nulls the scope pointer but never touches the birth record', async () => {
    mockMemoryFindUnique.mockResolvedValue({
      id: 'mem_1',
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      taskId: 'task_1',
      scope: 'TASK',
      category: 'DECISION',
    })

    await memoryManagementService.promoteToProject('mem_1')

    expect(mockMemoryUpdate).toHaveBeenCalledTimes(1)
    const { data } = mockMemoryUpdate.mock.calls[0][0]
    expect(data.scope).toBe('PROJECT')
    expect(data.task).toEqual({ disconnect: true })
    expect(data).not.toHaveProperty('sourceTaskId')
  })

  it('content updates never touch the birth record', async () => {
    await memoryRepository.updateContent('mem_1', DECISION_CONTENT)

    const { data } = mockMemoryUpdate.mock.calls[0][0]
    expect(Object.keys(data)).toEqual(['content'])
  })

  it('repository create defaults the birth record to null when the caller has none (Layer-2 / manual PROJECT adds)', async () => {
    await memoryRepository.create({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      taskId: null,
      scope: 'PROJECT',
      category: 'DECISION',
      content: DECISION_CONTENT,
      sourceSessionId: null,
      createdByMemberId: null,
    })

    const { data } = mockMemoryCreate.mock.calls[0][0]
    expect(data.sourceTaskId).toBeNull()
  })
})
