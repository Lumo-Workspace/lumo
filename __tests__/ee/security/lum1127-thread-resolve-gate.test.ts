/**
 * @jest-environment node
 *
 * LUM-1127 — resolving a conversation on GitHub is not a disposition. A
 * gate-blocking finding whose thread a human resolved still shows as blocking
 * in `lumo task status` and still blocks DONE; a non-blocking one is closed
 * by the resolve and leaves the task-status list.
 */
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/ee/security/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findLatestByPullRequestIds: jest.fn(),
    findUnnotifiedFindingScansByTask: jest.fn(),
    markAgentNotified: jest.fn(),
  },
}))
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findResolvedByUserFingerprints: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findManyForSecurityByTaskId: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findHeaderById: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findSecurityBaseline: jest.fn(),
  },
}))

import { securityTaskStatusSection } from '@/ee/security/task-status'
import { listOpenBlockingFindings } from '@/ee/security/services/pr-security-scan-gate'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { prFindingThreadRepository } from '@/ee/security/repositories/pr-finding-thread.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

const latest = prSecurityScanRepository.findLatestByPullRequestIds as jest.Mock
const prs = pullRequestRepository.findManyForSecurityByTaskId as jest.Mock
const resolved =
  prFindingThreadRepository.findResolvedByUserFingerprints as jest.Mock

const finding = (over: object) => ({
  id: 'f',
  scanId: 's1',
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
  persisting: false,
  createdAt: new Date(0),
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  prs.mockResolvedValue([
    { id: 'pr1', number: 12, title: 'PR', url: 'u', state: 'open' },
  ])
  latest.mockResolvedValue([
    {
      id: 's1',
      pullRequestId: 'pr1',
      taskId: 't-1',
      workspaceId: 'ws',
      headSha: 'abcdef0',
      status: 'FINDINGS',
      judgeStatus: 'RAN',
      truncated: false,
      stages: { secrets: 'RAN', judge: 'RAN' },
      partial: false,
      error: null,
      startedAt: new Date('2026-10-01T00:00:00Z'),
      findings: [
        // Blocking under the default policy (DETERMINISTIC HIGH).
        finding({ id: 'blocking', fingerprint: 'fp-block' }),
        // Advisory (LLM_JUDGE never blocks).
        finding({
          id: 'advisory',
          fingerprint: 'fp-adv',
          kind: 'VULNERABILITY',
          ruleId: 'vuln:xss',
          provenance: 'LLM_JUDGE',
          severity: 'MEDIUM',
        }),
      ],
    },
  ])
  resolved.mockResolvedValue(
    new Map([['pr1', new Set(['fp-block', 'fp-adv'])]])
  )
})

describe('LUM-1127 — a GitHub resolve is not a disposition', () => {
  it('task status: the blocking finding stays (blocking); the non-blocking one is closed', async () => {
    const section = await securityTaskStatusSection('t-1')
    const actions = (section.nextActions ?? []) as unknown as Array<{
      findingId: string
      blocking: boolean
    }>
    expect(actions.map(a => a.findingId)).toEqual(['blocking'])
    expect(actions[0]!.blocking).toBe(true)
    const fields = section.fields as {
      securityFindings: { open: number; blocking: number }
    }
    expect(fields.securityFindings).toMatchObject({ open: 1, blocking: 1 })
  })

  it('the DONE gate still lists the blocking finding', async () => {
    await expect(listOpenBlockingFindings('t-1')).resolves.toEqual([
      { ruleId: 'secret:aws-access-key-id', filePath: 'src/cfg.ts' },
    ])
  })

  it('without any resolved thread, both findings are open', async () => {
    resolved.mockResolvedValue(new Map())
    const section = await securityTaskStatusSection('t-1')
    expect((section.nextActions ?? []).length).toBe(2)
  })

  it('a failed thread read hides nothing', async () => {
    resolved.mockRejectedValue(new Error('down'))
    const section = await securityTaskStatusSection('t-1')
    expect((section.nextActions ?? []).length).toBe(2)
  })
})
