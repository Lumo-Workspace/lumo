/**
 * LUM-609 (fidelity premise A): freeze the acceptance contract at delivery
 * (IN_REVIEW entry) into an append-only, replayable snapshot, so a later
 * fidelity comparison reads the contract AS IT STOOD AT DELIVERY — not the
 * possibly-since-edited `latest` (which would be self-confirming).
 *
 * The snapshot store is append-only; the CRITERION_CHANGED TaskActivity trail
 * remains the immutable mutable-criteria audit backstop (Step 0). These tests
 * pin: the freeze (full set, append-only), the as-of replay (delivery-time, not
 * latest), the replay-sufficient field capture, and that the snapshot path does
 * not bypass the CRITERION_CHANGED audit.
 */
import { taskCriteriaSnapshotService } from '@/lib/services/task-criteria-snapshot.service'
import { selectActiveAsOf } from '@/lib/repositories/task-criteria-snapshot.repository'
import { taskCriteriaService } from '@/lib/services/task-criteria.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { prisma } from '@/lib/db/prisma'

const TX = { __tx: true }
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({ __tx: true })),
    taskCriteriaSnapshot: {
      create: jest.fn(() =>
        Promise.resolve({ id: 's1', frozenAt: new Date('2026-06-27') })
      ),
      findMany: jest.fn(),
    },
  },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    create: jest.fn(),
    listByTask: jest.fn(),
    countByTask: jest.fn(() => Promise.resolve(0)),
  },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: {
    maxRoundByTask: jest.fn(() => Promise.resolve(null)),
    latestRunsByCriterion: jest.fn(() => Promise.resolve(new Map())),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

const listByTask = acceptanceCriterionRepository.listByTask as jest.Mock
const repoCreate = acceptanceCriterionRepository.create as jest.Mock
const snapshotCreate = (
  prisma as unknown as {
    taskCriteriaSnapshot: { create: jest.Mock }
  }
).taskCriteriaSnapshot.create
const activityCreate = activityRepository.create as jest.Mock

const criterion = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  taskId: 'task-1',
  statement: 'a verifiable outcome',
  verifierType: 'MACHINE' as const,
  checkpointer: 'npx tsx scripts/jest-t.ts foo',
  referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
  evidenceRequired: false,
  ...over,
})

beforeEach(() => jest.clearAllMocks())

test('freezes the full active criteria set on IN_REVIEW entry, append-only across re-delivery', async () => {
  listByTask.mockResolvedValue([criterion({ id: 'a' }), criterion({ id: 'b' })])

  await taskCriteriaSnapshotService.recordDeliverySnapshot('task-1', {
    sessionId: 'sess-1',
  })

  expect(listByTask).toHaveBeenCalledWith('task-1')
  expect(snapshotCreate).toHaveBeenCalledTimes(1)
  const first = snapshotCreate.mock.calls[0][0]
  expect(first.data.taskId).toBe('task-1')
  expect(first.data.criteria).toHaveLength(2)

  // Append-only: a second delivery (e.g. after reopen) inserts a NEW row; the
  // repository exposes no update/delete path, so re-delivery can only append.
  await taskCriteriaSnapshotService.recordDeliverySnapshot('task-1', {
    sessionId: 'sess-2',
  })
  expect(snapshotCreate).toHaveBeenCalledTimes(2)
})

test('recordDeliverySnapshot is best-effort — a snapshot write failure never throws (round stays safe)', async () => {
  listByTask.mockResolvedValue([criterion()])
  snapshotCreate.mockRejectedValueOnce(new Error('db down'))

  await expect(
    taskCriteriaSnapshotService.recordDeliverySnapshot('task-1')
  ).resolves.toBeUndefined()
})

test('as-of returns the contract frozen at delivery time, not the diverged current criteria', () => {
  const v1 = {
    id: 's1',
    frozenAt: new Date('2026-06-01'),
    criteria: [{ id: 'a' }],
  }
  const v2 = {
    id: 's2',
    frozenAt: new Date('2026-06-20'),
    criteria: [{ id: 'a' }, { id: 'b' }],
  }
  const snaps = [v2, v1] // unordered on purpose

  // Asking "as of the first delivery" returns v1 — NOT the later v2 (latest).
  expect(selectActiveAsOf(snaps, new Date('2026-06-10'))?.id).toBe('s1')
  // As of after the second delivery, the active contract is v2.
  expect(selectActiveAsOf(snaps, new Date('2026-06-25'))?.id).toBe('s2')
  // Before any delivery there is no frozen contract.
  expect(selectActiveAsOf(snaps, new Date('2026-05-01'))).toBeNull()
})

test('snapshot captures each criterion full verifiable fields sufficient to replay', async () => {
  listByTask.mockResolvedValue([
    criterion({
      id: 'a',
      statement: 'returns 409',
      verifierType: 'MACHINE',
      checkpointer: 'npx tsx scripts/jest-t.ts bar',
      referentKind: 'EXTERNAL_FACT',
      evidenceRequired: true,
    }),
  ])

  await taskCriteriaSnapshotService.recordDeliverySnapshot('task-1')

  const frozen = snapshotCreate.mock.calls[0][0].data.criteria[0]
  expect(frozen).toMatchObject({
    id: 'a',
    statement: 'returns 409',
    verifierType: 'MACHINE',
    checkpointer: 'npx tsx scripts/jest-t.ts bar',
    referentKind: 'EXTERNAL_FACT',
    evidenceRequired: true,
  })
})

test('criteria mutation still records a CRITERION_CHANGED drift event alongside the snapshot path', async () => {
  // Regression guard: the snapshot mechanism must not bypass the immutable
  // CRITERION_CHANGED audit. An initial draft (one create) still writes it.
  listByTask.mockResolvedValueOnce([]) // existing → initial draft
  repoCreate.mockResolvedValue(criterion({ id: 'c-new' }))
  listByTask.mockResolvedValueOnce([criterion({ id: 'c-new' })]) // read-back

  await taskCriteriaService.submitDraft(
    'task-1',
    [
      {
        statement: 'a verifiable outcome',
        verifierType: 'MACHINE',
        checkpointer: 'npx tsx scripts/jest-t.ts foo',
        referentKind: 'AGENT_CONSTRUCTED_STATE',
      },
    ],
    { actorMemberId: 'member-1', sourceSessionId: null },
    'TODO',
    null
  )

  const wroteCriterionChanged = activityCreate.mock.calls.some(
    (args: unknown[]) =>
      args.some(
        (a: unknown) =>
          !!a &&
          typeof a === 'object' &&
          (a as { type?: string }).type === 'CRITERION_CHANGED'
      )
  )
  expect(wroteCriterionChanged).toBe(true)
})

void TX
