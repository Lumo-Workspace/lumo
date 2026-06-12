/**
 * LUM-441 — reward-hacking (TEST_TAMPERING) boundary detection.
 *
 * Extends the LUM-426 detector with one new crossing: an Edit/Write that touches
 * a file a MACHINE acceptance checkpointer runs is suspected test-tampering
 * (weakening the test to force a fake PASS). It is a flag-for-review, not a hard
 * block — a human dispositions it FALSE_POSITIVE (legit fix) or CONFIRMED via the
 * LUM-435 model (criterion 3, exercised in the route/gate test).
 *
 *  c1 — editing a file a MACHINE checkpointer references records the crossing.
 *  c2 — editing an ordinary (non-checkpointer) file records nothing.
 */
import {
  boundaryDetectorService,
  detectTestTampering,
  eventPathMatchesCheckpointerPath,
} from '@/lib/services/boundary-detector.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn() },
}))

const createCrossing = boundaryCrossingRepository.create as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const listByTask = acceptanceCriterionRepository.listByTask as jest.Mock

/** A MACHINE criterion whose checkpointer scopes the given test file path(s). */
const machineCriterion = (
  checkpointer: string,
  statement = 'the widget renders'
) => ({
  id: 'crit-1',
  taskId: 't-1',
  statement,
  verifierType: 'MACHINE' as const,
  checkpointer,
  evidenceRequired: false,
  source: 'AGENT_DRAFT' as const,
  addedAtRound: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
})

const editEvent = (filePath: string, newString = 'export const x = 1') => ({
  taskId: 't-1',
  hookEventId: 'evt-1',
  toolName: 'Edit',
  filePath,
  payload: { tool_input: { file_path: filePath, new_string: newString } },
})

const CHECKPOINTER =
  "npx tsx scripts/jest-t.ts 'the widget renders' __tests__/widget.test.ts"

beforeEach(() => {
  jest.clearAllMocks()
  createCrossing.mockResolvedValue({ id: 'bc-1' })
  createActivity.mockResolvedValue({ id: 'act-1' })
  listByTask.mockResolvedValue([])
})

describe('detectAndRecord — TEST_TAMPERING (LUM-441)', () => {
  it('editing a MACHINE checkpointer test file records a TEST_TAMPERING crossing', async () => {
    listByTask.mockResolvedValue([machineCriterion(CHECKPOINTER)])

    await boundaryDetectorService.detectAndRecord(
      editEvent('/Users/dev/repo/__tests__/widget.test.ts')
    )

    // A BoundaryCrossing row is persisted, categorized TEST_TAMPERING, on the
    // bound task — naming the edited test file and the criterion it backs.
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        hookEventId: 'evt-1',
        category: 'TEST_TAMPERING',
      })
    )
    const detail = createCrossing.mock.calls[0]![0].detail as string
    expect(detail).toContain('__tests__/widget.test.ts')
    expect(detail).toContain('the widget renders')

    // …and a timeline marker mirrors it (same activity type as LUM-426).
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        type: 'BOUNDARY_CROSSING_DETECTED',
        payload: expect.objectContaining({ category: 'TEST_TAMPERING' }),
      })
    )
  })

  it('editing a non-checkpointer file does not record a TEST_TAMPERING crossing', async () => {
    // Same contract — but the edit hits the code under test, not the test file.
    listByTask.mockResolvedValue([machineCriterion(CHECKPOINTER)])

    await boundaryDetectorService.detectAndRecord(
      editEvent('/Users/dev/repo/lib/widget.ts')
    )

    expect(createCrossing).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
  })

  it('does not flag when the task has no MACHINE checkpointers (no criteria query waste guarded upstream)', async () => {
    listByTask.mockResolvedValue([
      { ...machineCriterion(''), verifierType: 'HUMAN', checkpointer: null },
    ])
    await boundaryDetectorService.detectAndRecord(
      editEvent('/Users/dev/repo/__tests__/widget.test.ts')
    )
    expect(createCrossing).not.toHaveBeenCalled()
  })

  it('skips the criteria read entirely for a non-write (Bash) event', async () => {
    await boundaryDetectorService.detectAndRecord({
      taskId: 't-1',
      hookEventId: 'evt-1',
      toolName: 'Bash',
      filePath: null,
      payload: { tool_input: { command: 'npm test' } },
    })
    // A Bash event can't tamper with a file — the criteria query is never paid.
    expect(listByTask).not.toHaveBeenCalled()
    expect(createCrossing).not.toHaveBeenCalled()
  })
})

describe('detectTestTampering — pure matcher (LUM-441)', () => {
  const cp = [
    {
      criterionId: 'crit-1',
      statement: 'renders',
      checkpointer: "npx tsx scripts/jest-t.ts 'renders' __tests__/a.test.ts",
    },
  ]

  it('matches the referenced test file by repo-relative suffix of an absolute event path', () => {
    expect(
      detectTestTampering({
        toolName: 'Write',
        filePath: '/abs/repo/__tests__/a.test.ts',
        machineCheckpointers: cp,
      })
    ).toMatchObject({ category: 'TEST_TAMPERING' })
  })

  it('returns null for a non-write tool, even on the checkpointer file', () => {
    expect(
      detectTestTampering({
        toolName: 'Read',
        filePath: '/abs/repo/__tests__/a.test.ts',
        machineCheckpointers: cp,
      })
    ).toBeNull()
  })

  it('returns null when there is no file path', () => {
    expect(
      detectTestTampering({
        toolName: 'Edit',
        filePath: null,
        machineCheckpointers: cp,
      })
    ).toBeNull()
  })

  it('ignores a checkpointer with no test-file path (jest-by-name, bash probe)', () => {
    expect(
      detectTestTampering({
        toolName: 'Edit',
        filePath: '/abs/repo/__tests__/a.test.ts',
        machineCheckpointers: [
          { checkpointer: "npx tsx scripts/jest-t.ts 'renders'" },
          { checkpointer: 'test -f prisma/schema.prisma' },
        ],
      })
    ).toBeNull()
  })
})

describe('eventPathMatchesCheckpointerPath — path-segment boundary (LUM-441)', () => {
  it('matches on a segment boundary, not a bare string suffix', () => {
    expect(
      eventPathMatchesCheckpointerPath(
        '/repo/__tests__/widget.test.ts',
        '__tests__/widget.test.ts'
      )
    ).toBe(true)
    // a substring tail must NOT match: barwidget.test.ts ≠ widget.test.ts
    expect(
      eventPathMatchesCheckpointerPath(
        '/repo/__tests__/barwidget.test.ts',
        'widget.test.ts'
      )
    ).toBe(false)
  })
})
