/**
 * @jest-environment node
 *
 * LUM-898: the tables that used to store free text / JSON with no credential
 * redaction now redact on every write path, in the form HookEvent payloads
 * already get — and a clean write reaches Prisma untouched.
 */
const mockPrisma = {
  $transaction: jest.fn(),
  team: { update: jest.fn() },
  task: {
    create: jest.fn(),
    update: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  comment: { create: jest.fn(), update: jest.fn() },
  memory: { create: jest.fn(), update: jest.fn() },
  taskArtifact: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  boundaryCrossingExplanation: { create: jest.fn() },
  taskActivity: { create: jest.fn() },
  boundaryCrossing: { create: jest.fn(), updateMany: jest.fn() },
  testCaseRun: { create: jest.fn() },
}
jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return mockPrisma
  },
}))

import { Prisma } from '@prisma/client'
import {
  redactStoredFields,
  STORAGE_REDACTED_FIELDS,
} from '@/lib/security-scan/storage-redaction'
import { STOCK_TABLES } from '../../../scripts/analysis/lum887-secret-stock/tables'
import { classifyRow } from '../../../scripts/analysis/lum887-secret-stock/classify'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

// Built by concatenation so no credential-shaped literal sits in the repo.
const AWS_KEY = ['AKIA', 'ZXCVBNMLKJHGFDSA'].join('')
const ENV_LINE = 'DB_PASSWORD=' + 'Qm7Tz4Lw' + '9Kp2'
const DIRTY = `see ${AWS_KEY} and ${ENV_LINE}`

/** Every `data` object Prisma received across all mocked delegates. */
function writtenData(): unknown[] {
  const out: unknown[] = []
  for (const delegate of Object.values(mockPrisma)) {
    if (typeof delegate !== 'object') continue
    for (const fn of Object.values(delegate)) {
      for (const call of (fn as jest.Mock).mock.calls)
        out.push((call[0] as { data?: unknown })?.data)
    }
  }
  return out
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const delegate of Object.values(mockPrisma))
    if (typeof delegate === 'object')
      for (const fn of Object.values(delegate))
        (fn as jest.Mock).mockResolvedValue({ id: 'row', count: 1 })
  mockPrisma.team.update.mockResolvedValue({ taskSeq: 7 })
  mockPrisma.$transaction.mockImplementation(async fn => fn(mockPrisma))
  mockPrisma.task.findUniqueOrThrow.mockResolvedValue({
    id: 'row',
    number: 7,
    team: { identifier: 'LUM' },
  })
})

describe('redactStoredFields', () => {
  it('redacts listed text, JSON and set-update fields only', () => {
    const data = {
      body: DIRTY,
      payload: { nested: [DIRTY, 'ok'] },
      title: { set: DIRTY },
      other: DIRTY,
      nullable: Prisma.DbNull,
    }
    const out = redactStoredFields(data, [
      'body',
      'payload',
      'title',
      'nullable',
    ])
    expect(classifyRow([out.body, out.payload, out.title]).size).toBe(0)
    expect(out.body).toContain('see ')
    expect(out.other).toBe(DIRTY) // not listed
    expect(out.nullable).toBe(Prisma.DbNull)
    expect(data.body).toBe(DIRTY) // caller's object untouched
  })

  it('returns the same object for a clean write', () => {
    const data = { body: 'ship it tomorrow', payload: { a: ['x'] } }
    expect(redactStoredFields(data, ['body', 'payload'])).toBe(data)
  })

  it('lists every stock-scanned column of the tables it covers', () => {
    // These two cover only their note column (see STORAGE_REDACTED_FIELDS).
    const columnScoped = new Set(['boundaryCrossing', 'testCaseRun'])
    for (const [delegate, fields] of Object.entries(STORAGE_REDACTED_FIELDS)) {
      const stock = STOCK_TABLES.filter(t => t.delegate === delegate)
      expect([delegate, stock.length > 0]).toEqual([delegate, true])
      const scanned = stock.flatMap(t => t.fields)
      for (const f of fields)
        expect([delegate, f, scanned.includes(f)]).toEqual([delegate, f, true])
      if (columnScoped.has(delegate)) continue
      for (const f of scanned)
        expect([
          delegate,
          f,
          (fields as readonly string[]).includes(f),
        ]).toEqual([delegate, f, true])
    }
  })
})

describe('LUM-898 write paths store credentials redacted', () => {
  it('LUM-898 every write path of the six tables stores credentials redacted', async () => {
    await commentRepository.create({
      taskId: 't',
      authorActorId: 'a',
      body: DIRTY,
    } as never)
    await commentRepository.createForIdea({
      ideaId: 'i',
      authorActorId: 'a',
      body: DIRTY,
    } as never)
    await commentRepository.update('c', { body: DIRTY })

    const content = { trigger: DIRTY, action: 'rotate' }
    await memoryRepository.create({
      workspaceId: 'w',
      projectId: 'p',
      taskId: null,
      scope: 'PROJECT',
      category: 'TRAP',
      content,
      sourceSessionId: null,
      createdByMemberId: null,
    })
    await memoryRepository.update('m', { content })
    await memoryRepository.updateContent('m', content)

    await taskArtifactRepository.create({
      taskId: 't',
      workspaceId: 'w',
      kind: 'plan',
      title: DIRTY,
      content: DIRTY,
      summary: DIRTY,
    } as never)
    await taskArtifactRepository.updateSummary('x', DIRTY)
    await taskArtifactRepository.updateById('x', 't', { title: DIRTY })

    await boundaryCrossingRepository.createExplanation({
      crossingId: 'bc',
      note: DIRTY,
    })
    await activityRepository.create({
      taskId: 't',
      actorId: null,
      type: 'COMMENT_ADDED',
      payload: { excerpt: DIRTY },
    } as never)

    await taskRepository.update('t', {
      title: DIRTY,
      description: DIRTY,
    } as never)
    await taskRepository.updateSpec('t', DIRTY)
    await taskRepository.setClaimSnapshot('t', {
      text: DIRTY,
      source: 'AGENT',
      sessionId: null,
      at: new Date(),
    })
    await taskRepository.updateCommentsSummary('t', DIRTY)
    await taskRepository.createWithSequence({
      projectId: 'p',
      teamId: 'tm',
      title: DIRTY,
      description: DIRTY,
      status: 'TODO',
      priority: 'MEDIUM',
      assigneeActorId: null,
      agentStatus: null,
      dueDate: null,
    } as never)

    const data = writtenData().filter(d => d && typeof d === 'object')
    // 3 comment + 3 memory + 3 artifact + 1 explanation + 1 activity + 5 task
    expect(data.length).toBeGreaterThanOrEqual(16)
    const text = JSON.stringify(data)
    expect(text).not.toContain(AWS_KEY)
    expect(text).not.toContain(ENV_LINE)
    expect(classifyRow(data).size).toBe(0)
    expect(text).toContain('see AKIA')
  })
})

describe('LUM-898 follow-up: crossing and test-run notes', () => {
  it('LUM-898 crossing disposition notes and test run notes store credentials redacted', async () => {
    await boundaryCrossingRepository.create({
      taskId: 't',
      category: 'HARDCODED_SECRET',
      severity: 'HIGH',
      dispositionNote: DIRTY,
    } as never)
    await boundaryCrossingRepository.disposition(
      'bc',
      'FALSE_POSITIVE',
      DIRTY,
      'actor',
      new Date()
    )
    await boundaryCrossingRepository.suppressManyByIds(
      ['bc'],
      'rule',
      DIRTY,
      new Date()
    )
    await testCaseRepository.createRun({
      testCaseId: 'tc',
      taskId: 't',
      result: 'PASS',
      environment: 'LOCAL',
      note: DIRTY,
    } as never)

    const notes = [
      ...mockPrisma.boundaryCrossing.create.mock.calls,
      ...mockPrisma.boundaryCrossing.updateMany.mock.calls,
      ...mockPrisma.testCaseRun.create.mock.calls,
    ].map(c => {
      const d = (c[0] as { data: Record<string, unknown> }).data
      return d.dispositionNote ?? d.note
    })
    expect(notes).toHaveLength(4)
    for (const n of notes) {
      expect(typeof n).toBe('string')
      expect(classifyRow([n]).size).toBe(0)
      expect(n).toContain('see AKIA')
    }

    // Reopening a crossing still clears the note.
    mockPrisma.boundaryCrossing.updateMany.mockClear()
    await boundaryCrossingRepository.disposition(
      'bc',
      null,
      DIRTY,
      null,
      new Date()
    )
    const reopened = mockPrisma.boundaryCrossing.updateMany.mock
      .calls[0]![0] as {
      data: Record<string, unknown>
    }
    expect(reopened.data.dispositionNote).toBeNull()
  })
})
