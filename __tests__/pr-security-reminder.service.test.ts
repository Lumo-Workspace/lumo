/**
 * @jest-environment node
 *
 * LUM-737 — agent-facing read-out of undispositioned PR security findings.
 * The one-shot PreToolUse reminder mirrors LUM-542: read only un-notified
 * FINDINGS scans, stamp `agentNotifiedAt`, never re-nag.
 */
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findLatestByPullRequestIds: jest.fn(),
    findUnnotifiedFindingScansByTask: jest.fn(),
    markAgentNotified: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findManyForSecurityByTaskId: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findHeaderById: jest.fn() },
}))

import { prSecurityReminderService } from '@/lib/services/pr-security-reminder.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

const latest = prSecurityScanRepository.findLatestByPullRequestIds as jest.Mock
const unnotified =
  prSecurityScanRepository.findUnnotifiedFindingScansByTask as jest.Mock
const mark = prSecurityScanRepository.markAgentNotified as jest.Mock
const prs = pullRequestRepository.findManyForSecurityByTaskId as jest.Mock
const header = taskRepository.findHeaderById as jest.Mock

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
  id: 's1',
  pullRequestId: 'pr1',
  taskId: 't-1',
  workspaceId: 'ws',
  headSha: 'abcdef0123456',
  status: 'FINDINGS',
  trigger: 'PR_EVENT',
  judgeStatus: 'RAN',
  truncated: false,
  detectorVersion: 'secrets@1;judge@1',
  error: null,
  startedAt: new Date('2026-09-09T00:00:00Z'),
  finishedAt: new Date('2026-09-09T00:01:00Z'),
  agentNotifiedAt: null,
  findings: [],
  ...over,
})
const pr = (over: object) => ({
  id: 'pr1',
  number: 12,
  title: 'PR',
  url: 'https://github.com/o/r/pull/12',
  state: 'open',
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  mark.mockResolvedValue(1)
  header.mockResolvedValue({
    id: 't-1',
    number: 7,
    title: 'x',
    status: 'IN_PROGRESS',
    team: { identifier: 'LUM' },
  })
})

describe('loadOpenFindingsForTask', () => {
  it('returns only undispositioned findings on each PR latest scan, sorted, with blocking derived', async () => {
    prs.mockResolvedValue([pr({}), pr({ id: 'pr2', number: 13 })])
    latest.mockResolvedValue([
      scan({
        id: 's1',
        findings: [
          finding({ id: 'gone', scanId: 's1', disposition: 'FALSE_POSITIVE' }),
          finding({ id: 'judge', scanId: 's1', provenance: 'LLM_JUDGE' }),
          finding({ id: 'det', scanId: 's1' }),
        ],
      }),
      scan({ id: 's2', pullRequestId: 'pr2', status: 'CLEAN' }),
    ])
    const state = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(state.findings.map(f => f.id)).toEqual(['det', 'judge'])
    expect(state.findings[0]).toMatchObject({
      blocking: true,
      prNumber: 12,
      scanId: 's1',
      kind: 'SECRET',
    })
    expect(state.findings[1]?.blocking).toBe(false)
    expect(state.blockingCount).toBe(1)
    expect(state.unconfirmedPrs).toEqual([])
    expect(state.latestScans).toEqual([
      { scanId: 's1', prNumber: 12, headSha: 'abcdef0123456' },
      { scanId: 's2', prNumber: 13, headSha: 'abcdef0123456' },
    ])
    expect(latest).toHaveBeenCalledWith(['pr1', 'pr2'])
  })

  it('flags open PRs whose latest scan is PENDING or RUNNING', async () => {
    prs.mockResolvedValue([
      pr({ id: 'pr1', number: 1 }),
      pr({ id: 'pr2', number: 2 }),
    ])
    latest.mockResolvedValue([
      scan({ id: 's1', pullRequestId: 'pr1', status: 'PENDING' }),
      scan({ id: 's2', pullRequestId: 'pr2', status: 'RUNNING' }),
    ])
    const state = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(state.unconfirmedPrs).toEqual([
      { number: 1, reason: 'PENDING' },
      { number: 2, reason: 'RUNNING' },
    ])
  })

  it('flags open PRs whose latest scan is missing or FAILED, but not merged/closed ones', async () => {
    prs.mockResolvedValue([
      pr({ id: 'pr1', number: 1 }),
      pr({ id: 'pr2', number: 2 }),
      pr({ id: 'pr3', number: 3, state: 'merged' }),
    ])
    latest.mockResolvedValue([
      scan({ id: 's2', pullRequestId: 'pr2', status: 'FAILED' }),
    ])
    const state = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(state.unconfirmedPrs).toEqual([
      { number: 1, reason: 'NONE' },
      { number: 2, reason: 'FAILED' },
    ])
    expect(state.findings).toEqual([])
  })

  it('short-circuits with an empty state when the task has no PRs', async () => {
    prs.mockResolvedValue([])
    const state = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(state).toEqual({
      findings: [],
      blockingCount: 0,
      unconfirmedPrs: [],
      latestScans: [],
      scans: [],
    })
    expect(latest).not.toHaveBeenCalled()
  })
})

describe('LUM-735 scans array', () => {
  it('one entry per PR with a latest scan, using the new stages column and counting external/open findings', async () => {
    prs.mockResolvedValue([pr({}), pr({ id: 'pr2', number: 13 })])
    latest.mockResolvedValue([
      scan({
        id: 's1',
        status: 'FINDINGS',
        stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
        partial: false,
        error: null,
        findings: [
          finding({
            id: 'ext1',
            scanId: 's1',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:semgrep:sql-injection',
          }),
          finding({
            id: 'ext2-dispositioned',
            scanId: 's1',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:semgrep:xss',
            disposition: 'FALSE_POSITIVE',
          }),
          finding({ id: 'det1', scanId: 's1', provenance: 'DETERMINISTIC' }),
        ],
      }),
      scan({
        id: 's2',
        pullRequestId: 'pr2',
        status: 'CLEAN',
        stages: { secrets: 'RAN' },
        partial: false,
        error: null,
        findings: [],
      }),
    ])
    const state = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(state.scans).toEqual([
      {
        prNumber: 12,
        status: 'FINDINGS',
        stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
        partial: false,
        error: null,
        // both EXTERNAL_TOOL findings count regardless of disposition.
        externalFindings: 2,
        // only the undispositioned ones count as open.
        openFindings: 2,
        dependencyFindings: 0,
        persistingFindings: 0,
      },
      {
        prNumber: 13,
        status: 'CLEAN',
        stages: { secrets: 'RAN' },
        partial: false,
        error: null,
        externalFindings: 0,
        openFindings: 0,
        dependencyFindings: 0,
        persistingFindings: 0,
      },
    ])
  })

  it('derives stages from judgeStatus (legacy null stages) and surfaces partial/error', async () => {
    prs.mockResolvedValue([pr({})])
    latest.mockResolvedValue([
      scan({
        id: 's1',
        status: 'FAILED',
        stages: null,
        judgeStatus: 'UNAVAILABLE',
        partial: true,
        error: 'external: rate limited',
        findings: [],
      }),
    ])
    const state = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(state.scans).toEqual([
      {
        prNumber: 12,
        status: 'FAILED',
        stages: { secrets: 'RAN', judge: 'FAILED' },
        partial: true,
        error: 'external: rate limited',
        externalFindings: 0,
        openFindings: 0,
        dependencyFindings: 0,
        persistingFindings: 0,
      },
    ])
  })

  it('omits a PR with no latest scan from scans (same set as latestScans)', async () => {
    prs.mockResolvedValue([pr({ id: 'pr1', number: 1 })])
    latest.mockResolvedValue([])
    const state = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(state.scans).toEqual([])
    expect(state.latestScans).toEqual([])
  })
})

describe('buildSessionStartSection', () => {
  it('renders the section with the task identifier and returns "" when there is nothing open', async () => {
    prs.mockResolvedValue([pr({})])
    latest.mockResolvedValue([scan({ findings: [finding({ scanId: 's1' })] })])
    const out = await prSecurityReminderService.buildSessionStartSection(
      't-1',
      'LUM-7'
    )
    expect(out).toContain(
      '## ⚠ Undispositioned security findings (1 · 1 block DONE)'
    )
    expect(out).toContain('lumo task status LUM-7')

    latest.mockResolvedValue([scan({ status: 'CLEAN' })])
    expect(
      await prSecurityReminderService.buildSessionStartSection('t-1', 'LUM-7')
    ).toBe('')
  })
})

describe('LUM-737 one-time security reminder', () => {
  it('one-time security reminder: surfaces fresh FINDINGS scans and stamps agentNotifiedAt so a later hook does not re-nag', async () => {
    // First hook after a scan finished with findings: one un-notified scan.
    unnotified.mockResolvedValueOnce([
      { id: 's1', pullRequestId: 'pr1', headSha: 'abcdef0123456' },
    ])
    prs.mockResolvedValue([pr({})])
    latest.mockResolvedValue([scan({ findings: [finding({ scanId: 's1' })] })])

    const first = await prSecurityReminderService.buildAgentReminder('t-1')
    expect(first).not.toBeNull()
    expect(first).toContain('PR #12 (head abcdef0)')
    expect(first).toContain('secret:aws-access-key-id')
    expect(first).toContain('lumo task status LUM-7')
    expect(unnotified).toHaveBeenCalledWith('t-1')
    // Stamping is guarded server-side on agentNotifiedAt:null (repository).
    expect(mark).toHaveBeenCalledWith(['s1'], expect.any(Date))

    // A later hook: nothing un-notified → no reminder, no write, no re-read.
    unnotified.mockResolvedValueOnce([])
    mark.mockClear()
    latest.mockClear()
    expect(await prSecurityReminderService.buildAgentReminder('t-1')).toBeNull()
    expect(mark).not.toHaveBeenCalled()
    expect(latest).not.toHaveBeenCalled()
  })

  it('does not stamp when the header read rejects, so the next hook retries', async () => {
    unnotified.mockResolvedValueOnce([
      { id: 's1', pullRequestId: 'pr1', headSha: 'abcdef0123456' },
    ])
    prs.mockResolvedValue([pr({})])
    latest.mockResolvedValue([scan({ findings: [finding({ scanId: 's1' })] })])
    header.mockRejectedValueOnce(new Error('db down'))

    await expect(
      prSecurityReminderService.buildAgentReminder('t-1')
    ).rejects.toThrow('db down')
    expect(mark).not.toHaveBeenCalled()
  })

  it('stamps a superseded or fully-dispositioned scan without rendering it', async () => {
    // s0 is an older FINDINGS scan on pr1 that a newer CLEAN scan replaced;
    // s2 on pr2 is the latest but every finding was dispositioned already.
    unnotified.mockResolvedValueOnce([
      { id: 's0', pullRequestId: 'pr1', headSha: '0000000aaaa' },
      { id: 's2', pullRequestId: 'pr2', headSha: '2222222bbbb' },
    ])
    prs.mockResolvedValue([pr({}), pr({ id: 'pr2', number: 13 })])
    latest.mockResolvedValue([
      scan({ id: 's1', status: 'CLEAN' }),
      scan({
        id: 's2',
        pullRequestId: 'pr2',
        findings: [finding({ scanId: 's2', disposition: 'ACCEPTED_RISK' })],
      }),
    ])
    expect(await prSecurityReminderService.buildAgentReminder('t-1')).toBeNull()
    expect(mark).toHaveBeenCalledWith(['s0', 's2'], expect.any(Date))
  })
})

describe('LUM-738 supplyChain surface — reminder', () => {
  it('skips persisting findings in the open list, counts dependency and persisting rows per PR, and keeps dependencies out of externalFindings', async () => {
    prs.mockResolvedValue([pr({})])
    latest.mockResolvedValue([
      scan({
        id: 's1',
        stages: {
          secrets: 'RAN',
          external: 'RAN',
          supplyChain: 'RAN',
          judge: 'RAN',
        },
        partial: false,
        findings: [
          finding({
            id: 'dep-new',
            scanId: 's1',
            kind: 'DEPENDENCY',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:osv-scanner:GHSA-1',
            line: null,
            persisting: false,
          }),
          finding({
            id: 'dep-old',
            scanId: 's1',
            kind: 'DEPENDENCY',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:osv-scanner:GHSA-2',
            line: null,
            persisting: true,
          }),
          finding({
            id: 'sg-old',
            scanId: 's1',
            kind: 'VULNERABILITY',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:semgrep:r',
            persisting: true,
          }),
          finding({ id: 'det', scanId: 's1', persisting: false }),
        ],
      }),
    ])
    const state = await prSecurityReminderService.loadOpenFindingsForTask('t-1')
    expect(state.findings.map(f => f.id)).toEqual(['det', 'dep-new'])
    expect(state.scans).toEqual([
      expect.objectContaining({
        prNumber: 12,
        externalFindings: 1,
        openFindings: 2,
        dependencyFindings: 2,
        persistingFindings: 2,
      }),
    ])
  })
})
