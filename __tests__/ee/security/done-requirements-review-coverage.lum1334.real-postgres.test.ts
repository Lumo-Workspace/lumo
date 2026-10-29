/**
 * @jest-environment node
 *
 * LUM-1334 — the security plugin's answer to the DONE gate's review
 * requirement, against a REAL Postgres replayed from every migration: a PR
 * head counts as reviewed when Lumo's AI review ran on that exact head or an
 * agent review was imported into its scan — never a scan of an older head.
 */
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'

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

import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { readDoneVerdict } from '@/lib/services/done-verdict.service'

jest.setTimeout(180_000)

const WS = 'ws_rev'
const HEAD = 'a'.repeat(40)
const OLD = 'c'.repeat(40)
const heads = [{ pullRequestId: 'pr', headSha: HEAD }]

beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', {
    id: WS,
    name: WS,
    slug: WS,
    doneRequiresReview: true,
  })
  await harness.insert('workspace_members', {
    id: 'm_rev',
    workspaceId: WS,
    clerkId: 'c-rev',
    role: 'OWNER',
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
    createdByMemberId: 'm_rev',
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
  for (const [id, headSha, judgeStatus] of [
    ['scan-old', OLD, 'RAN'],
    ['scan-head', HEAD, 'SKIPPED'],
  ] as const)
    await harness.insert('pr_security_scans', {
      id,
      pullRequestId: 'pr',
      workspaceId: WS,
      headSha,
      trigger: 'PR_EVENT',
      judgeStatus,
      detectorVersion: 'v',
    })
})
afterAll(async () => harness.stop())

it('an AI review of an older head does not cover the current head', async () => {
  expect(await prSecurityScanRepository.findReviewedHeads(heads)).toEqual([])
  expect((await readDoneVerdict('task', WS)).blockers).toEqual([
    expect.objectContaining({
      plane: 'DONE_REQUIREMENT',
      missing: [{ requirement: 'REVIEW', prNumber: 12 }],
    }),
  ])
})

it('an imported agent review on the head covers it', async () => {
  await harness.prisma!.prSecurityScan.update({
    where: { id: 'scan-head' },
    data: { agentReviewTools: ['claude-code'] },
  })
  expect(await prSecurityScanRepository.findReviewedHeads(heads)).toEqual([
    'pr',
  ])
})

it("Lumo's AI review on the head covers it, and the gate clears", async () => {
  await harness.prisma!.prSecurityScan.update({
    where: { id: 'scan-head' },
    data: { agentReviewTools: [], judgeStatus: 'RAN' },
  })
  expect(await prSecurityScanRepository.findReviewedHeads(heads)).toEqual([
    'pr',
  ])
  expect((await readDoneVerdict('task', WS)).decision).toBe('CLEAR')
})
