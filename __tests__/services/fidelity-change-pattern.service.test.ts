/**
 * LUM-610 — the fidelity change-pattern service folds two append-only sources
 * (LUM-609 delivery snapshots + the CRITERION_CHANGED activity trail) into the
 * pure-core report. These tests pin the DB-JSON → core coercion (the glue the
 * pure-core tests don't reach): malformed rows are dropped, verifierType is
 * normalised, and a post-start ADDED criterion surfaces as an independence
 * suspect. The two repository reads are mocked — no DB.
 */
import { fidelityChangePatternService } from '@/lib/services/fidelity-change-pattern.service'
import { taskCriteriaSnapshotRepository } from '@/lib/repositories/task-criteria-snapshot.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

jest.mock('@/lib/repositories/task-criteria-snapshot.repository', () => ({
  taskCriteriaSnapshotRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { listByTaskAndType: jest.fn() },
}))

const listByTask = taskCriteriaSnapshotRepository.listByTask as jest.Mock
const listByTaskAndType = activityRepository.listByTaskAndType as jest.Mock

afterEach(() => jest.clearAllMocks())

it('folds a snapshot + CRITERION_CHANGED trail into a per-delivery report', async () => {
  listByTask.mockResolvedValue([
    {
      id: 'snap1',
      frozenAt: new Date('2026-06-20T12:00:00Z'),
      trigger: 'IN_REVIEW_ENTRY',
      sessionId: 'sess1',
      criteria: [
        {
          id: 'c1',
          statement: 'git check',
          verifierType: 'MACHINE',
          checkpointer: 'git diff --quiet origin/main',
          referentKind: 'EXTERNAL_FACT',
          evidenceRequired: false,
        },
        {
          id: 'c2',
          statement: 'human read',
          verifierType: 'HUMAN',
          checkpointer: null,
          referentKind: 'AGENT_CONSTRUCTED_STATE',
          evidenceRequired: false,
        },
        // malformed row (no id) → dropped by the coercion
        { statement: 'broken', verifierType: 'MACHINE' },
      ],
    },
  ])
  listByTaskAndType.mockResolvedValue([
    {
      // c2 added after work started (round 1) → independence suspect
      payload: {
        op: 'ADDED',
        criterionId: 'c2',
        source: 'AGENT_DRAFT',
        round: 1,
        causeTag: 'SCOPE_CHANGE',
        before: null,
        after: {},
      },
      createdAt: new Date('2026-06-20T10:00:00Z'),
    },
    // a non-criterion-shaped payload → dropped
    {
      payload: { nonsense: true },
      createdAt: new Date('2026-06-20T11:00:00Z'),
    },
  ])

  const report = await fidelityChangePatternService.forTask(
    'task-cuid',
    new Date('2026-06-19T00:00:00Z')
  )

  expect(listByTask).toHaveBeenCalledWith('task-cuid')
  expect(listByTaskAndType).toHaveBeenCalledWith(
    'task-cuid',
    'CRITERION_CHANGED'
  )

  expect(report.hasSnapshots).toBe(true)
  expect(report.deliveries).toHaveLength(1)
  const d = report.deliveries[0]!
  // malformed criterion dropped → 2 valid criteria
  expect(d.total).toBe(2)
  expect(d.grounding.grounded).toBe(1) // c1 EXTERNAL_FACT
  expect(d.grounding.selfConfirming).toBe(1) // c2 AGENT_CONSTRUCTED_STATE
  // c2's post-start ADDED is a backward-inference suspect
  expect(d.independence.postStartChanges).toBe(1)
  expect(d.independence.suspects[0]!.criterionId).toBe('c2')
  expect(d.independence.suspects[0]!.causeTag).toBe('SCOPE_CHANGE')
})

it('reports the no-snapshot case explicitly (never delivered)', async () => {
  listByTask.mockResolvedValue([])
  listByTaskAndType.mockResolvedValue([])

  const report = await fidelityChangePatternService.forTask('task-cuid', null)
  expect(report.hasSnapshots).toBe(false)
  expect(report.deliveries).toEqual([])
  expect(report.workStartedAt).toBeNull()
})
