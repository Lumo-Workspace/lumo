/**
 * LUM-590: Advisory crossings must NOT block the DONE gate.
 *
 * Advisory crossings (advisory: true) are surfaced in the crossing panel but
 * excluded from `findUndispositionedByTask` — the query the DONE gate reads.
 * Only non-advisory open crossings remain in the blocking set.
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

// ── Mock Prisma ──────────────────────────────────────────────────────────────

const mockCreate = jest.fn()
const mockFindMany = jest.fn()
const mockFindFirst = jest.fn()

jest.mock('@/lib/db/prisma', () => {
  const client: any = {
    boundaryCrossing: {
      create: (...args: any[]) => mockCreate(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
      findFirst: (...args: any[]) => mockFindFirst(...args),
    },
    // LUM-1059: create allocates the crossing number in a transaction.
    task: { findUnique: async () => ({ workspaceId: 'w1' }) },
    workspace: { update: async () => ({ crossingSeq: 1 }) },
  }
  client.$transaction = (fn: (tx: any) => unknown) => fn(client)
  return { prisma: client }
})

beforeEach(() => {
  jest.clearAllMocks()
})

// ── Seed helper ──────────────────────────────────────────────────────────────

let taskCounter = 0
function seedTask(): string {
  return `t-${++taskCounter}`
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('advisory crossing does not block DONE while non-advisory does', async () => {
  const taskId = seedTask()

  // Seed an advisory crossing — mock create to return an advisory row.
  mockCreate.mockResolvedValueOnce({
    id: 'bc-1',
    taskId,
    category: 'PROJECT_RULE_VIOLATION',
    detail: 'semantic',
    severity: 'LOW',
    target: 'r1',
    advisory: true,
    disposition: null,
  })
  await boundaryCrossingRepository.create({
    taskId,
    category: 'PROJECT_RULE_VIOLATION',
    detail: 'semantic',
    severity: 'LOW',
    target: 'r1',
    advisory: true,
  })

  // Gate query excludes advisory — returns empty.
  mockFindMany.mockResolvedValueOnce([])
  expect(
    await boundaryCrossingRepository.findUndispositionedByTask(taskId)
  ).toHaveLength(0)

  // Verify the where-clause included advisory: false.
  expect(mockFindMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ advisory: false }),
    })
  )

  // Seed a non-advisory crossing — it IS in the blocking set.
  mockCreate.mockResolvedValueOnce({
    id: 'bc-2',
    taskId,
    category: 'PROJECT_RULE_VIOLATION',
    detail: 'deterministic',
    severity: 'MEDIUM',
    target: 'r2',
    advisory: false,
    disposition: null,
  })
  await boundaryCrossingRepository.create({
    taskId,
    category: 'PROJECT_RULE_VIOLATION',
    detail: 'deterministic',
    severity: 'MEDIUM',
    target: 'r2',
    advisory: false,
  })

  // Gate query now returns the non-advisory crossing.
  mockFindMany.mockResolvedValueOnce([
    {
      id: 'bc-2',
      taskId,
      category: 'PROJECT_RULE_VIOLATION',
      detail: 'deterministic',
      severity: 'MEDIUM',
      target: 'r2',
      advisory: false,
      disposition: null,
    },
  ])
  expect(
    await boundaryCrossingRepository.findUndispositionedByTask(taskId)
  ).toHaveLength(1)
})

test('hasOpenForTask excludes advisory crossings mirroring gate predicate', async () => {
  const taskId = seedTask()

  // Only an advisory crossing exists — hasOpenForTask must return false.
  mockFindFirst.mockResolvedValueOnce(null)
  expect(await boundaryCrossingRepository.hasOpenForTask(taskId)).toBe(false)

  // Verify advisory: false is included in the where-clause.
  expect(mockFindFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ advisory: false }),
    })
  )

  // A non-advisory crossing exists — hasOpenForTask must return true.
  mockFindFirst.mockResolvedValueOnce({ id: 'bc-x' })
  expect(await boundaryCrossingRepository.hasOpenForTask(taskId)).toBe(true)
})

test('a HIGH advisory crossing still does not force the gate', async () => {
  const taskId = seedTask()
  mockCreate.mockResolvedValueOnce({
    id: 'bc-3',
    taskId,
    category: 'PROJECT_RULE_VIOLATION',
    detail: 'x',
    severity: 'HIGH',
    target: 'r3',
    advisory: true,
    disposition: null,
  })
  await boundaryCrossingRepository.create({
    taskId,
    category: 'PROJECT_RULE_VIOLATION',
    detail: 'x',
    severity: 'HIGH',
    target: 'r3',
    advisory: true,
  })

  // HIGH advisory is still excluded from the blocking set.
  mockFindMany.mockResolvedValueOnce([])
  expect(
    await boundaryCrossingRepository.findUndispositionedByTask(taskId)
  ).toHaveLength(0)

  expect(mockFindMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ advisory: false }),
    })
  )
})
