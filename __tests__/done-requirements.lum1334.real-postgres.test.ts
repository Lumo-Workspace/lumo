/**
 * @jest-environment node
 *
 * LUM-1334 — the DONE requirements against a REAL Postgres replayed from
 * every migration (so the new migration applies): both switches default off
 * and are audited when an OWNER turns them on (a MEMBER gets 403); a GitHub
 * review id keeps one row with its latest state; the security plugin's
 * review coverage reads Lumo's AI review and imported agent reviews on the
 * exact head; and the DONE gate refuses, then allows, as the evidence lands.
 */
import { createPgliteHarness } from '../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

import { doneRequirementsSettingsService } from '@/lib/services/done-requirements-settings.service'
import { pullRequestReviewRepository } from '@/lib/repositories/pull-request-review.repository'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { readDoneVerdict } from '@/lib/services/done-verdict.service'
import { memberAuditContext } from '@/lib/api/audit-context'
import { taskStatusService } from '@/lib/services/task-status.service'

jest.setTimeout(180_000)

const WS = 'ws_req'
const OWNER = 'm_req_owner'
const MEMBER = 'm_req_member'
const HEAD = 'a'.repeat(40)
const OLD = 'c'.repeat(40)
const caller = (memberId: string) => ({
  workspaceId: WS,
  memberId,
  workspaceSlug: WS,
})
const ctx = (memberId: string) =>
  memberAuditContext(new Headers({}), { clerkId: 'c', memberId })

beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', { id: WS, name: WS, slug: WS })
  await harness.insert('workspace_members', {
    id: OWNER,
    workspaceId: WS,
    clerkId: 'c-owner',
    role: 'OWNER',
  })
  await harness.insert('workspace_members', {
    id: MEMBER,
    workspaceId: WS,
    clerkId: 'c-member',
    role: 'MEMBER',
  })
  await harness.insert('teams', {
    id: 'team',
    workspaceId: WS,
    name: 'Lumo',
    identifier: 'LUM',
  })
  await harness.insert('projects', {
    id: 'project',
    workspaceId: WS,
    teamId: 'team',
    createdByMemberId: OWNER,
    name: 'P',
  })
  await harness.insert('tasks', {
    id: 'task',
    projectId: 'project',
    teamId: 'team',
    number: 1,
    title: 'T',
  })
  await harness.insert('pull_requests', {
    id: 'pr',
    workspaceId: WS,
    taskId: 'task',
    repo: 'acme/app',
    number: 12,
    state: 'open',
    headSha: HEAD,
  })
})
afterAll(async () => harness.stop())

it('both switches default off; an OWNER turns them on, audited; a MEMBER gets 403', async () => {
  expect(await doneRequirementsSettingsService.get(caller(OWNER))).toEqual({
    testCase: false,
    review: false,
    canEdit: true,
  })
  await expect(
    doneRequirementsSettingsService.update(
      caller(MEMBER),
      { testCase: true },
      ctx(MEMBER)
    )
  ).rejects.toMatchObject({ status: 403 })

  expect(
    await doneRequirementsSettingsService.update(
      caller(OWNER),
      { testCase: true, review: true },
      ctx(OWNER)
    )
  ).toEqual({ testCase: true, review: true, canEdit: true })
  const events = await harness.prisma!.auditEvent.findMany({
    where: { workspaceId: WS, action: 'workspace.security_settings_updated' },
    select: { metadata: true },
  })
  expect(events).toHaveLength(1)
  expect(events[0]!.metadata).toEqual({
    changes: {
      doneRequiresTestCase: { from: false, to: true },
      doneRequiresReview: { from: false, to: true },
    },
  })
})

it('the DONE gate refuses while the PR has neither a passing run nor a review on its head', async () => {
  const v = await readDoneVerdict('task', WS)
  expect(v.blockers).toEqual([
    {
      plane: 'DONE_REQUIREMENT',
      switches: { testCase: true, review: true },
      missing: [
        { requirement: 'TEST_CASE', prNumber: 12 },
        { requirement: 'REVIEW', prNumber: 12 },
      ],
    },
  ])
})

it('task status serves the same requirements: the gate row and one blocking row each', async () => {
  const report = await taskStatusService.statusForTask('task', WS)
  expect(report.doneGate).toMatchObject({
    confirmed: true,
    headline: 'blocked',
    requirements: {
      state: 'blocked',
      missing: [
        { requirement: 'TEST_CASE', prNumber: 12 },
        { requirement: 'REVIEW', prNumber: 12 },
      ],
    },
  })
  const rows = report.nextActions.filter(
    (a: { kind: string }) => a.kind === 'DONE_REQUIREMENT'
  )
  expect(rows).toEqual([
    expect.objectContaining({
      requirement: 'TEST_CASE',
      prNumber: 12,
      blocking: true,
      statement: expect.stringContaining('PR #12 has no passing test-case run'),
    }),
    expect.objectContaining({ requirement: 'REVIEW', prNumber: 12 }),
  ])
})

it('a GitHub review id keeps one row holding its latest state; a dismissal is final', async () => {
  const base = {
    pullRequestId: 'pr',
    githubReviewId: '987',
    reviewerLogin: 'alice',
    commitSha: HEAD,
    submittedAt: new Date('2026-10-28T10:00:00Z'),
  }
  await pullRequestReviewRepository.upsert({ ...base, state: 'APPROVED' })
  await pullRequestReviewRepository.upsert({ ...base, state: 'DISMISSED' })
  const rows = await pullRequestReviewRepository.listByPullRequestIds(['pr'])
  expect(rows).toHaveLength(1)
  expect(rows[0]!.state).toBe('DISMISSED')
  // A late-delivered approval never brings a dismissed review back.
  await pullRequestReviewRepository.upsert({ ...base, state: 'APPROVED' })
  expect(
    (await pullRequestReviewRepository.listByPullRequestIds(['pr']))[0]!.state
  ).toBe('DISMISSED')
  // A dismissed approval does not count.
  expect((await readDoneVerdict('task', WS)).blockers[0]).toMatchObject({
    missing: expect.arrayContaining([{ requirement: 'REVIEW', prNumber: 12 }]),
  })
})

it("Lumo's AI review or an imported agent review on the exact head covers it", async () => {
  await harness.insert('pr_security_scans', {
    id: 'scan-old',
    pullRequestId: 'pr',
    workspaceId: WS,
    headSha: OLD,
    trigger: 'PR_EVENT',
    judgeStatus: 'RAN',
    detectorVersion: 'v',
  })
  await harness.insert('pr_security_scans', {
    id: 'scan-head',
    pullRequestId: 'pr',
    workspaceId: WS,
    headSha: HEAD,
    trigger: 'PR_EVENT',
    judgeStatus: 'SKIPPED',
    detectorVersion: 'v',
  })
  const heads = [{ pullRequestId: 'pr', headSha: HEAD }]
  // AI review ran only on an older head; the head's own scan skipped it.
  expect(await prSecurityScanRepository.findReviewedHeads(heads)).toEqual([])

  await harness.prisma!.prSecurityScan.update({
    where: { id: 'scan-head' },
    data: { agentReviewTools: ['claude-code'] },
  })
  expect(await prSecurityScanRepository.findReviewedHeads(heads)).toEqual([
    'pr',
  ])
  await harness.prisma!.prSecurityScan.update({
    where: { id: 'scan-head' },
    data: { agentReviewTools: [], judgeStatus: 'RAN' },
  })
  expect(await prSecurityScanRepository.findReviewedHeads(heads)).toEqual([
    'pr',
  ])

  expect((await readDoneVerdict('task', WS)).blockers).toEqual([
    expect.objectContaining({
      plane: 'DONE_REQUIREMENT',
      missing: [{ requirement: 'TEST_CASE', prNumber: 12 }],
    }),
  ])
})

it('a passing run on the head clears the gate', async () => {
  await harness.insert('test_cases', {
    id: 'tc',
    taskId: 'task',
    number: 1,
    title: 'case',
    steps: ['do it'],
  })
  await harness.insert('test_case_runs', {
    id: 'run',
    testCaseId: 'tc',
    taskId: 'task',
    result: 'PASS',
    environment: 'LOCAL',
    pullRequestId: 'pr',
    commitSha: HEAD.slice(0, 7),
    commitDirty: false,
    evidence: JSON.stringify([{ type: 'link', url: 'https://ci/1' }]),
    stepResults: JSON.stringify([
      { phase: 'STEP', index: 0, text: 'do it', status: 'PASS' },
    ]),
  })
  expect((await readDoneVerdict('task', WS)).decision).toBe('CLEAR')
})
