/**
 * @jest-environment node
 *
 * LUM-732 — the DONE gate for PR security findings. Exercises the exact
 * function task-state.service wires into the DONE transition.
 */
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { findLatestByPullRequestIds: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findManyForSecurityByTaskId: jest.fn() },
}))
// LUM-740: the gate reads the workspace policy; null = the 732 default this
// suite was written against.
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
  },
}))

import {
  assertNoOpenBlockingSecurityFindings,
  isBlockingFinding,
} from '@/lib/services/pr-security-scan-gate'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

const scans = prSecurityScanRepository.findLatestByPullRequestIds as jest.Mock
const prs = pullRequestRepository.findManyForSecurityByTaskId as jest.Mock

const finding = (over: object) => ({
  id: 'f',
  scanId: 's',
  kind: 'SECRET',
  ruleId: 'secret:aws-access-key-id',
  severity: 'HIGH',
  provenance: 'DETERMINISTIC',
  filePath: 'src/cfg.ts',
  line: 1,
  title: 't',
  detail: 'd',
  evidence: 'e',
  fingerprint: 'fp',
  externalRef: null,
  disposition: null,
  dispositionNote: null,
  dispositionedById: null,
  dispositionedAt: null,
  inheritedFromFindingId: null,
  createdAt: new Date(0),
  ...over,
})
const scan = (over: object) => ({
  id: 's',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  headSha: 'a',
  status: 'FINDINGS',
  trigger: 'PR_EVENT',
  judgeStatus: 'RAN',
  truncated: false,
  detectorVersion: 'v',
  error: null,
  startedAt: new Date(1000),
  finishedAt: null,
  findings: [],
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  prs.mockResolvedValue([
    { id: 'pr1', number: 1, title: 'x', url: 'u', state: 'open' },
  ])
})

test('blocks DONE with 409 while an undispositioned deterministic HIGH finding stands', async () => {
  scans.mockResolvedValue([scan({ findings: [finding({})] })])
  await expect(
    assertNoOpenBlockingSecurityFindings('t1')
  ).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining('security finding'),
  })

  // LLM_JUDGE HIGH never blocks; MEDIUM deterministic never blocks.
  scans.mockResolvedValue([
    scan({
      findings: [
        finding({ provenance: 'LLM_JUDGE' }),
        finding({ severity: 'MEDIUM' }),
      ],
    }),
  ])
  await expect(
    assertNoOpenBlockingSecurityFindings('t1')
  ).resolves.toBeUndefined()

  // A dispositioned HIGH unblocks.
  scans.mockResolvedValue([
    scan({ findings: [finding({ disposition: 'ACCEPTED_RISK' })] }),
  ])
  await expect(
    assertNoOpenBlockingSecurityFindings('t1')
  ).resolves.toBeUndefined()

  // Only the LATEST scan per PR counts — an old scan's open HIGH is superseded.
  scans.mockResolvedValue([
    scan({
      id: 'new',
      startedAt: new Date(2000),
      status: 'CLEAN',
      findings: [],
    }),
    scan({ id: 'old', startedAt: new Date(1000), findings: [finding({})] }),
  ])
  await expect(
    assertNoOpenBlockingSecurityFindings('t1')
  ).resolves.toBeUndefined()

  expect(
    isBlockingFinding({
      provenance: 'DETERMINISTIC',
      severity: 'HIGH',
      disposition: null,
    })
  ).toBe(true)
  expect(
    isBlockingFinding({
      provenance: 'EXTERNAL_TOOL',
      severity: 'HIGH',
      disposition: null,
    })
  ).toBe(false)
})

test('no PRs or no scans means nothing blocks', async () => {
  prs.mockResolvedValue([])
  await expect(
    assertNoOpenBlockingSecurityFindings('t1')
  ).resolves.toBeUndefined()
  expect(scans).not.toHaveBeenCalled()
})
