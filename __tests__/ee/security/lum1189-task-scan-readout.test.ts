/**
 * @jest-environment node
 *
 * LUM-1189 — the task-level scan read-out behind `lumo task scans`: every PR
 * linked to the task, each built by the same function as `lumo pr scan`'s
 * read-out, with the call chain and the falsifier's reason cleaned on the
 * server. Repositories are mocked; the gate runs for real.
 */
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { listByPullRequest: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findByNumberInWorkspace: jest.fn(),
    findManyForScanReadoutByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findReviewAutoPauseAfter: jest.fn().mockResolvedValue(5),
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findSecuritySwitches: jest.fn().mockResolvedValue(null),
    findSecurityBaseline: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/ee/security/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: {
    get: jest.fn().mockResolvedValue({ reviewPaused: false, reviewHeads: [] }),
  },
}))

import {
  prScanReadoutService,
  readCallChain,
} from '@/ee/security/services/pr-scan-readout.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

const listScans = prSecurityScanRepository.listByPullRequest as jest.Mock
const taskPrs =
  pullRequestRepository.findManyForScanReadoutByTaskId as jest.Mock
const findPolicy = securityColumnsRepository.findSecurityPolicy as jest.Mock

/** Assembled at runtime so no token-shaped literal sits in the tree. */
const SAMPLE_TOKEN = ['ghp_', 'abcdefghijklmnopqrstuvwxyz', '0123456789'].join(
  ''
)

const TASK = { id: 't-1', identifier: 'LUM-1189' }

const pr = (over: object) => ({
  id: 'pr-1',
  repo: 'Lumo-Workspace/lumo',
  number: 1500,
  title: 'feat: one',
  url: 'https://github.com/Lumo-Workspace/lumo/pull/1500',
  state: 'open',
  headSha: 'aaaaaaa1',
  mergedAt: null,
  task: { number: 1189, team: { identifier: 'LUM' } },
  ...over,
})

const finding = (over: object) => ({
  id: 'f1',
  scanId: 's1',
  kind: 'VULNERABILITY',
  ruleId: 'hunt:injection',
  severity: 'HIGH',
  provenance: 'LLM_JUDGE',
  filePath: 'src/db.ts',
  line: 40,
  title: 'SQL built from request input',
  detail: 'query string reaches raw SQL',
  fingerprint: 'fp-1',
  externalRef: null,
  disposition: null,
  dispositionNote: null,
  dispositionedById: null,
  dispositionedAt: null,
  inheritedFromFindingId: null,
  cwe: 'CWE-89',
  reachability: 'REACHABLE',
  callChain: null,
  falsifierVerdict: null,
  suggestedDisposition: null,
  suggestedReason: null,
  suggestionOutcome: null,
  verifierVerdict: null,
  verifierReason: null,
  persisting: false,
  secretDowngrade: null,
  createdAt: new Date('2026-10-15T07:00:00Z'),
  ...over,
})

const scan = (over: object) => ({
  id: 's1',
  pullRequestId: 'pr-1',
  workspaceId: 'ws-1',
  headSha: 'aaaaaaa1',
  status: 'FINDINGS',
  trigger: 'PR_EVENT',
  judgeStatus: 'RAN',
  truncated: false,
  stages: { secrets: 'RAN', judge: 'RAN', hunt: 'RAN' },
  partial: false,
  detectorVersion: 'secrets@1',
  error: null,
  startedAt: new Date('2026-10-15T07:00:00Z'),
  finishedAt: new Date('2026-10-15T07:04:00Z'),
  tokenSpent: null,
  huntAudit: null,
  judgeBudget: null,
  partialCauses: [],
  huntJob: null,
  findings: [],
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  findPolicy.mockResolvedValue(null)
  listScans.mockResolvedValue([])
  taskPrs.mockResolvedValue([])
})

describe('readCallChain', () => {
  it('keeps well-formed hops, cleans each one, and drops the rest', () => {
    const tally = { redacted: 0 }
    const chain = readCallChain(
      [
        { from: 'GET /api/x', to: 'svc.read\u001b[2J' },
        { from: 42, to: 'nope' },
        null,
        { from: 'svc.read', to: `db.raw(${SAMPLE_TOKEN})` },
      ],
      tally
    )
    expect(chain).toHaveLength(2)
    expect(chain![0]!.to).not.toContain('\u001b')
    expect(chain![1]!.to).not.toContain(SAMPLE_TOKEN)
    expect(tally.redacted).toBe(1)
  })

  it('is null for a row without a chain and elides a long one', () => {
    expect(readCallChain(null, { redacted: 0 })).toBeNull()
    expect(readCallChain([], { redacted: 0 })).toBeNull()
    const long = Array.from({ length: 25 }, (_, i) => ({
      from: `f${i}`,
      to: `f${i + 1}`,
    }))
    const chain = readCallChain(long, { redacted: 0 })!
    expect(chain).toHaveLength(21)
    expect(chain[20]).toEqual({ from: '…', to: '5 more hops' })
  })
})

describe('prScanReadoutService.getForTask', () => {
  it('reads every linked PR in the caller workspace, each as the pr scan read-out', async () => {
    const one = pr({})
    const two = pr({
      id: 'pr-2',
      number: 1501,
      title: 'fix: two',
      url: 'https://github.com/Lumo-Workspace/lumo/pull/1501',
      headSha: 'bbbbbbb2',
    })
    taskPrs.mockResolvedValue([two, one])
    listScans.mockImplementation(async (prId: string) =>
      prId === 'pr-1'
        ? [
            scan({
              findings: [
                finding({
                  callChain: [
                    { from: 'route', to: 'service' },
                    { from: 'service', to: 'db.raw' },
                  ],
                  suggestedDisposition: 'FALSE_POSITIVE',
                  suggestedReason: 'input is a constant\u0007',
                }),
              ],
            }),
          ]
        : [
            scan({
              id: 's2',
              pullRequestId: 'pr-2',
              headSha: 'bbbbbbb2',
              findings: [
                finding({
                  id: 'f2',
                  fingerprint: 'fp-2',
                  disposition: 'ACCEPTED_RISK',
                  dispositionNote: 'internal only',
                  dispositionedAt: new Date('2026-10-16T09:00:00Z'),
                }),
              ],
            }),
          ]
    )

    const out = await prScanReadoutService.getForTask('ws-1', TASK, {
      all: false,
    })

    expect(taskPrs).toHaveBeenCalledWith('ws-1', 't-1')
    expect(listScans).toHaveBeenCalledWith('pr-1', 1)
    expect(listScans).toHaveBeenCalledWith('pr-2', 1)
    expect(out.version).toBe(1)
    expect(out.task).toEqual({ identifier: 'LUM-1189' })
    expect(out.pullRequests.map(p => p.pullRequest.number)).toEqual([
      1501, 1500,
    ])
    const [ruled, open] = out.pullRequests
    // Already-ruled history comes through with its source and note.
    expect(ruled!.scans[0]!.findings[0]).toMatchObject({
      disposition: 'ACCEPTED_RISK',
      dispositionSource: 'HUMAN',
      dispositionNote: 'internal only',
      dispositionedAt: '2026-10-16T09:00:00.000Z',
      open: false,
    })
    // The open finding carries its chain and the AI's cleaned reason.
    const f = open!.scans[0]!.findings[0]!
    expect(f.callChain).toEqual([
      { from: 'route', to: 'service' },
      { from: 'service', to: 'db.raw' },
    ])
    expect(f.suggestedReason).toBe('input is a constant')
    expect(f).not.toHaveProperty('evidence')
    expect(out.totals).toEqual({
      pullRequests: 2,
      scanned: 2,
      open: 1,
      blocking: open!.scans[0]!.counts.blocking,
    })
  })

  it('passes --all through and says so for a task with no linked PR', async () => {
    const out = await prScanReadoutService.getForTask('ws-1', TASK, {
      all: true,
    })
    expect(out.pullRequests).toEqual([])
    expect(out.totals).toEqual({
      pullRequests: 0,
      scanned: 0,
      open: 0,
      blocking: 0,
    })
    expect(out.all).toBe(true)

    taskPrs.mockResolvedValue([pr({})])
    await prScanReadoutService.getForTask('ws-1', TASK, { all: true })
    expect(listScans).toHaveBeenCalledWith('pr-1', null)
  })

  it('sums the redaction tally across PRs', async () => {
    taskPrs.mockResolvedValue([pr({}), pr({ id: 'pr-2', number: 1501 })])
    listScans.mockResolvedValue([
      scan({ findings: [finding({ detail: `leaked ${SAMPLE_TOKEN}` })] }),
    ])
    const out = await prScanReadoutService.getForTask('ws-1', TASK, {
      all: false,
    })
    expect(out.redactedSecrets).toBe(2)
    expect(JSON.stringify(out)).not.toContain(SAMPLE_TOKEN)
  })
})
