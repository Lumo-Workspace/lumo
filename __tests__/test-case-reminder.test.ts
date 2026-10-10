/**
 * LUM-807 — test-case reminders across the CLI flow.
 *
 * Three surfaces, two gates: the start-of-work nudge (attach / task context)
 * fires on a task with no recorded script regardless of PRs; the delivery-time
 * ones (`Next:` block — covered in next-steps-compute.test.ts — and the
 * `task status` advisory) additionally require a linked PR. The invariant
 * test at the bottom is the one that matters most: none of this may reach the
 * DONE gate.
 */
import { taskContextService } from '@/lib/services/task-context.service'
import { taskStatusService } from '@/lib/services/task-status.service'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'
import { readFileSync } from 'fs'
import { join } from 'path'

// task-context.service eagerly imports document.service → @clerk/nextjs, whose
// ESM build jest cannot parse. The section under test never touches documents.
jest.mock('@/lib/services/document.service', () => ({
  documentService: {},
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: { hasForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listIdAndNumberByTask: jest.fn(),
    listForLifecycle: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
    listByTaskAndType: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: jest.fn(),
    findStatus: jest.fn(),
    findHeaderById: jest.fn(),
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
    setClaimSnapshot: jest.fn(() => Promise.resolve({ id: 't-1' })),
  },
}))
// Cuts the github-integration ESM import chain (task.service → octokit).
jest.mock('@/lib/services/task.service', () => ({ taskService: {} }))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadActuals: jest.fn(() => Promise.resolve(null)),
    loadPerSessionCost: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { findMergedSessionIds: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    loadLatestRunClaim: jest.fn(() => Promise.resolve(null)),
    loadRunClaimForSessions: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/claim-faithfulness-verdict.repository', () => ({
  claimFaithfulnessVerdictRepository: {
    findByTaskId: jest.fn(() => Promise.resolve(null)),
  },
}))
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})),
  },
}))

const hasTestCases = testCaseRepository.hasForTask as jest.Mock
const listPrs = pullRequestRepository.listIdAndNumberByTask as jest.Mock
const findTask = taskRepository.findById as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock
const findStatus = taskRepository.findStatus as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  hasTestCases.mockResolvedValue(false)
  listPrs.mockResolvedValue([{ id: 'pr-1', number: 1042 }])
  findTask.mockResolvedValue({ id: 't-1', status: 'IN_PROGRESS' })
  findHeader.mockResolvedValue({
    id: 't-1',
    number: 807,
    title: 'CLI test-case reminders',
    status: 'IN_PROGRESS',
    team: { identifier: 'LUM' },
  })
  findStatus.mockResolvedValue({ status: 'IN_PROGRESS' })
})

describe('LUM-807 · start-of-work nudge', () => {
  it('reminder on attach and context appears only when the task has zero test cases', async () => {
    // Both `session attach` and `task context` render this one section, so the
    // gate is asserted where they share it.
    const withoutScript = await taskContextService.buildTestCaseSectionForTask(
      't-1',
      'LUM-807',
      'IN_PROGRESS'
    )
    expect(withoutScript).toContain('## Test cases')
    expect(withoutScript).toContain('lumo task testcase add LUM-807')

    hasTestCases.mockResolvedValue(true)
    const withScript = await taskContextService.buildTestCaseSectionForTask(
      't-1',
      'LUM-807',
      'IN_PROGRESS'
    )
    expect(withScript).toBe('')

    // No PR gate here: the nudge must survive the state every task starts in.
    hasTestCases.mockResolvedValue(false)
    listPrs.mockResolvedValue([])
    const noPrYet = await taskContextService.buildTestCaseSectionForTask(
      't-1',
      'LUM-807',
      'IN_PROGRESS'
    )
    expect(noPrYet).toContain('lumo task testcase add LUM-807')

    // A delivered task is past the point of being nudged.
    const done = await taskContextService.buildTestCaseSectionForTask(
      't-1',
      'LUM-807',
      'DONE'
    )
    expect(done).toBe('')
  })
})

describe('LUM-807 · task status advisory', () => {
  it('task status nextActions carries a TEST_CASE advisory', async () => {
    const s = await taskStatusService.statusForTask('t-1')
    const advisory = s.nextActions.filter(a => a.kind === 'TEST_CASE')
    expect(advisory).toHaveLength(1)
    expect(advisory[0]).toMatchObject({
      kind: 'TEST_CASE',
      advisory: true,
      command: expect.stringContaining('lumo task testcase add LUM-807'),
    })
    // The CLI renders it as advisory, never as a blocker.
    const rendered = formatTaskStatus(payloadWithAdvisory())
    expect(rendered).toContain('[TEST CASE]')
    expect(rendered).toContain('(advisory)')

    // No PR → no advisory at all (the delivery gate).
    listPrs.mockResolvedValue([])
    const early = await taskStatusService.statusForTask('t-1')
    expect(early.nextActions.some(a => a.kind === 'TEST_CASE')).toBe(false)
  })
})

describe('LUM-807 · invariant', () => {
  it('test case reminder never blocks DONE', async () => {
    // 1. The DONE gate is three assertions in task-state.service; none of them
    //    may learn about test cases. Source-level so it survives a refactor of
    //    how the gate is wired, and fails loudly if a future change routes a
    //    test-case read into the gate.
    const gateSource = readFileSync(
      join(process.cwd(), 'lib/services/task-state.service.ts'),
      'utf8'
    )
    expect(gateSource).not.toMatch(/test-?[Cc]ase/)

    // 2. The advisory row is structurally incapable of blocking: it carries no
    //    `blocking` field at all, and `advisory` is a `true` literal.
    const s = await taskStatusService.statusForTask('t-1')
    const row = s.nextActions.find(a => a.kind === 'TEST_CASE')
    expect(row).toBeDefined()
    expect(row && 'blocking' in row).toBe(false)
  })
})

/**
 * A minimal `task status` payload carrying the advisory
 * row — the shape the server produces for a delivered-but-scriptless task.
 */
function payloadWithAdvisory(): TaskStatusResponse {
  return {
    version: 2,
    task: {
      id: 't-1',
      identifier: 'LUM-807',
      title: 'CLI test-case reminders',
      status: 'IN_PROGRESS',
    },
    nextActions: [
      {
        kind: 'TEST_CASE',
        statement: 'No test case recorded on a task that already has a PR',
        command: 'lumo task testcase add LUM-807 --title "<title>"',
        advisory: true,
      },
    ],
  }
}
