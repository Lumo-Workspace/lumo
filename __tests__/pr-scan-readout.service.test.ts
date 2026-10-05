/**
 * @jest-environment node
 *
 * LUM-788 — the by-PR scan read-out behind `lumo pr scan`. Repositories are
 * mocked; the gate (policy / queue exits) runs for real against the default
 * policy so `blocking` / `queueExit` are the production rules, not a stub.
 */
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { listByPullRequest: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findByNumberInWorkspace: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findSecuritySwitches: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findSecurityBaseline: jest.fn().mockResolvedValue(null),
  },
}))

import { prScanReadoutService } from '@/lib/services/pr-scan-readout.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

const listScans = prSecurityScanRepository.listByPullRequest as jest.Mock

/**
 * A synthetic GitHub-token-shaped value, assembled at runtime so the literal
 * never sits in the tree (the repo's own secret detector would flag it).
 */
const SAMPLE_TOKEN = ['ghp_', 'abcdefghijklmnopqrstuvwxyz', '0123456789'].join(
  ''
)
const findPrs = pullRequestRepository.findByNumberInWorkspace as jest.Mock

const PR = {
  id: 'pr-1',
  repo: 'Lumo-Workspace/lumo',
  number: 1013,
  title: 'feat: size the hunt by diff [LUM-787]',
  url: 'https://github.com/Lumo-Workspace/lumo/pull/1013',
  state: 'merged',
  mergedAt: new Date('2026-09-15T08:00:00Z'),
  task: { number: 787, team: { identifier: 'LUM' } },
}

const finding = (over: object) => ({
  id: 'f1',
  scanId: 's1',
  kind: 'SECRET',
  ruleId: 'secret:aws-access-key-id',
  severity: 'HIGH',
  provenance: 'DETERMINISTIC',
  filePath: 'src/cfg.ts',
  line: 12,
  title: 'AWS access key id',
  detail: 'looks like a live key',
  fingerprint: 'fp-1',
  externalRef: null,
  disposition: null,
  dispositionNote: null,
  dispositionedById: null,
  dispositionedAt: null,
  inheritedFromFindingId: null,
  cwe: null,
  reachability: null,
  callChain: null,
  falsifierVerdict: null,
  suggestedDisposition: null,
  suggestedReason: null,
  suggestionOutcome: null,
  persisting: false,
  secretDowngrade: null,
  createdAt: new Date('2026-09-15T07:00:00Z'),
  ...over,
})

const scan = (over: object) => ({
  id: 's1',
  pullRequestId: 'pr-1',
  workspaceId: 'ws-1',
  headSha: 'abcdef0123456789',
  status: 'FINDINGS',
  trigger: 'PR_EVENT',
  judgeStatus: 'RAN',
  truncated: false,
  stages: {
    secrets: 'RAN',
    external: 'FAILED',
    supplyChain: 'RAN',
    judge: 'RAN',
    hunt: 'RAN',
  },
  partial: false,
  detectorVersion: 'secrets@1;judge@1',
  error: 'external: gitleaks exit 2',
  startedAt: new Date('2026-09-15T07:00:00Z'),
  finishedAt: new Date('2026-09-15T07:04:00Z'),
  tokenSpent: 61_000,
  huntAudit: null,
  findings: [],
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  findPrs.mockResolvedValue([PR])
  listScans.mockResolvedValue([])
})

describe('prScanReadoutService.getForPullRequest', () => {
  it('404s when the workspace knows no such PR (another workspace reads the same)', async () => {
    findPrs.mockResolvedValue([])
    await expect(
      prScanReadoutService.getForPullRequest('ws-1', {
        number: 1013,
        all: false,
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(findPrs).toHaveBeenCalledWith('ws-1', 1013, null)
    expect(listScans).not.toHaveBeenCalled()
  })

  it('409s with the candidate repos when the number exists in several and no repo narrowed it', async () => {
    findPrs.mockResolvedValue([
      { ...PR, id: 'a', repo: 'org/one' },
      { ...PR, id: 'b', repo: 'org/two' },
    ])
    await expect(
      prScanReadoutService.getForPullRequest('ws-1', {
        number: 1013,
        all: false,
      })
    ).rejects.toMatchObject({ status: 409, repos: ['org/one', 'org/two'] })
  })

  it('reads the latest head by default and the whole history with all=true, passing --repo through', async () => {
    await prScanReadoutService.getForPullRequest('ws-1', {
      number: 1013,
      repo: 'Lumo-Workspace/lumo',
      all: false,
    })
    expect(findPrs).toHaveBeenCalledWith('ws-1', 1013, 'Lumo-Workspace/lumo')
    expect(listScans).toHaveBeenCalledWith('pr-1', 1)

    await prScanReadoutService.getForPullRequest('ws-1', {
      number: 1013,
      all: true,
    })
    expect(listScans).toHaveBeenLastCalledWith('pr-1', null)
  })

  it('renders a PR with no linked task, and an empty scan list, without inventing anything', async () => {
    findPrs.mockResolvedValue([{ ...PR, task: null, state: 'open' }])
    const view = await prScanReadoutService.getForPullRequest('ws-1', {
      number: 1013,
      all: false,
    })
    expect(view.pullRequest).toEqual({
      repo: 'Lumo-Workspace/lumo',
      number: 1013,
      title: 'feat: size the hunt by diff [LUM-787]',
      url: 'https://github.com/Lumo-Workspace/lumo/pull/1013',
      state: 'open',
      task: null,
    })
    expect(view.scans).toEqual([])
    expect(view.all).toBe(false)
  })

  it('builds the scan view: stages, P8 external reason, counts, dispositions with their source, blocking under the default policy — and never evidence', async () => {
    findPrs.mockResolvedValue([{ ...PR, state: 'open', mergedAt: null }])
    listScans.mockResolvedValue([
      scan({
        findings: [
          finding({}),
          finding({
            id: 'f2',
            ruleId: 'secret:generic-api-key',
            severity: 'LOW',
            secretDowngrade: 'PLACEHOLDER_VALUE',
            disposition: 'FALSE_POSITIVE',
            dispositionNote: 'doc example',
            dispositionedById: 'm1',
            dispositionedAt: new Date('2026-09-15T07:30:00Z'),
          }),
          finding({
            id: 'f3',
            kind: 'VULNERABILITY',
            ruleId: 'ext:codeql:js/sql-injection',
            provenance: 'EXTERNAL_TOOL',
            severity: 'MEDIUM',
            disposition: 'ACCEPTED_RISK',
            inheritedFromFindingId: 'f0',
          }),
          finding({
            id: 'f4',
            kind: 'DEPENDENCY',
            ruleId: 'dep:osv:GHSA-1',
            provenance: 'EXTERNAL_TOOL',
            severity: 'HIGH',
            persisting: true,
          }),
          finding({
            id: 'f5',
            kind: 'VULNERABILITY',
            ruleId: 'hunt:idor',
            provenance: 'LLM_JUDGE',
            severity: 'MEDIUM',
            falsifierVerdict: 'INCONCLUSIVE',
            suggestedDisposition: 'FALSE_POSITIVE',
            suggestionOutcome: 'CONFIRMED',
            disposition: 'FALSE_POSITIVE',
          }),
        ],
      }),
    ])
    const view = await prScanReadoutService.getForPullRequest('ws-1', {
      number: 1013,
      all: false,
    })
    expect(view.pullRequest.task).toEqual({ identifier: 'LUM-787' })
    const s = view.scans[0]!
    expect(s.stages).toEqual({
      secrets: 'RAN',
      external: 'FAILED',
      supplyChain: 'RAN',
      judge: 'RAN',
      hunt: 'RAN',
    })
    expect(s.externalFailureReason).toBe('gitleaks exit 2')
    expect(s.tokenSpent).toBe(61_000)
    expect(s.counts).toEqual({
      findings: 5,
      open: 1,
      blocking: 1,
      dispositioned: 3,
      persisting: 1,
      externalFindings: 1,
      dependencyFindings: 1,
    })
    const byId = new Map(s.findings.map(f => [f.id, f]))
    expect(byId.get('f1')).toMatchObject({
      open: true,
      blocking: true,
      disposition: null,
      dispositionSource: null,
    })
    expect(byId.get('f2')).toMatchObject({
      open: false,
      blocking: false,
      disposition: 'FALSE_POSITIVE',
      dispositionSource: 'HUMAN',
      dispositionNote: 'doc example',
      dispositionedAt: '2026-09-15T07:30:00.000Z',
      secretDowngrade: 'PLACEHOLDER_VALUE',
    })
    expect(byId.get('f3')).toMatchObject({
      disposition: 'ACCEPTED_RISK',
      dispositionSource: 'INHERITED',
    })
    expect(byId.get('f4')).toMatchObject({
      open: false,
      persisting: true,
      blocking: false,
    })
    expect(byId.get('f5')).toMatchObject({
      dispositionSource: 'SUGGESTED_CONFIRMED',
      falsifierVerdict: 'INCONCLUSIVE',
    })
    for (const f of s.findings) expect(f).not.toHaveProperty('evidence')
    expect(s.hunt).toMatchObject({ coverage: null, tasks: [], diff: null })
  })

  it('never publishes an unprefixed (stage A raw) error as the external reason', async () => {
    listScans.mockResolvedValue([
      scan({ error: 'ENOTFOUND api.github.com', findings: [] }),
    ])
    const view = await prScanReadoutService.getForPullRequest('ws-1', {
      number: 1013,
      all: false,
    })
    expect(view.scans[0]!.externalFailureReason).toBeNull()
  })

  it('derives queue exits on a merged PR (LUM-775) instead of listing the row as open', async () => {
    // Merged PR, no baseline → an advisory LLM row leaves the queue as
    // MERGED_UNREVIEWED; a DETERMINISTIC HIGH stays (policy-blocking rows wait
    // for a human).
    listScans.mockResolvedValue([
      scan({
        findings: [
          finding({}),
          finding({
            id: 'f6',
            kind: 'VULNERABILITY',
            ruleId: 'vuln:xss',
            provenance: 'LLM_JUDGE',
            severity: 'LOW',
          }),
        ],
      }),
    ])
    const view = await prScanReadoutService.getForPullRequest('ws-1', {
      number: 1013,
      all: false,
    })
    const s = view.scans[0]!
    expect(s.queueExits).toEqual({ MERGED_UNREVIEWED: 1 })
    const byId = new Map(s.findings.map(f => [f.id, f]))
    expect(byId.get('f6')).toMatchObject({
      open: false,
      queueExit: 'MERGED_UNREVIEWED',
    })
    expect(byId.get('f1')).toMatchObject({ open: true, queueExit: null })
  })

  it('LUM-798 follow-up tags the first flat tally as legacy rather than upgrading it', async () => {
    listScans.mockResolvedValue([
      scan({
        huntAudit: {
          candidates: 2,
          rejected: [{ reason: 'chain-disconnected' }],
          resolution: { subgraph: 1, sinkRule: 0, sandbox: 0, rejected: 1 },
          falsifierRejects: 0,
          tasks: [],
        },
      }),
    ])
    const view = await prScanReadoutService.getForPullRequest('ws-1', {
      number: 1013,
      all: false,
    })
    expect(view.scans[0]!.hunt!.resolution).toEqual({
      kind: 'legacy',
      subgraph: 1,
      sinkRule: 0,
      sandbox: 0,
      rejected: 1,
    })
  })

  it('reads the hunt audit: coverage, diff sizing, plan facts and the per-task rows with free text redacted and shape-checked', async () => {
    listScans.mockResolvedValue([
      scan({
        huntAudit: {
          candidates: 2,
          rejected: [{ reason: 'edge-not-in-subgraph: x' }],
          resolution: {
            placed: { subgraph: 1, sinkRule: 0, sandbox: 0 },
            unplaced: 1,
            accepted: 1,
            rejected: 1,
          },
          falsifierRejects: 1,
          plannedBy: 'model',
          plannedReason: 'two sinks lit',
          planned: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
          diff: { sourceFiles: 14, sites: 9, taskCap: 4, oversized: false },
          tasks: [
            {
              taskId: 't1',
              objective: 'check the new route',
              category: 'idor',
              stopped: 'done',
              elapsedMs: 41_200,
              tokens: 18_000,
              candidates: 1,
              sites: 3,
              model: 'alibaba/qwen3-coder-plus',
              shell: {
                calls: 2,
                refused: 1,
                failed: 0,
                notFound: 0,
                empty: 0,
                stepClipped: 1,
                commands: [
                  { cmd: 'rg -n queryRaw lib/', chars: 900, clipped: true },
                  {
                    cmd: 'curl https://evil.test[31m',
                    denied: true,
                    reason: 'segment is not read-only',
                  },
                ],
              },
              trace: [
                {
                  i: 1,
                  tool: 'run_shell',
                  text: `token ${SAMPLE_TOKEN} seen`,
                  inputTokens: 1900,
                  outputTokens: 300,
                },
              ],
              stop: {
                by: 'submitted',
                spent: 9800,
                budget: 30000,
                reserve: 4400,
                lastStep: 4300,
                next: 4400,
                steps: 3,
              },
              wrapUp: { ran: false, skipped: 'submitted' },
            },
            {
              taskId: 't2',
              category: 'injection',
              stopped: 'steps',
              elapsedMs: 60_000,
              tokens: 20_000,
              candidates: 0,
              sites: 6,
              model: 'alibaba/qwen3-coder-plus',
              stop: { by: 'steps', spent: 19_000, budget: 30_000, steps: 4 },
            },
            'garbage-row',
          ],
        },
      }),
    ])
    const view = await prScanReadoutService.getForPullRequest('ws-1', {
      number: 1013,
      all: false,
    })
    const hunt = view.scans[0]!.hunt!
    expect(hunt.coverage).toMatchObject({ total: 3, done: 1 })
    expect(hunt.coverage!.categories.map(c => c.taskId)).toEqual(['t1', 't2'])
    expect(hunt.diff).toEqual({
      sourceFiles: 14,
      sites: 9,
      taskCap: 4,
      oversized: false,
    })
    expect(hunt).toMatchObject({
      plannedBy: 'model',
      plannedReason: 'two sinks lit',
      candidates: 2,
      falsifierRejects: 1,
      mechanicallyRejected: 1,
      error: null,
    })
    // LUM-798 — the gate's rejection RATE, readable straight off the scan;
    // LUM-798 follow-up — on two axes, tagged so the older flat shape can
    // never be read as if it measured the same thing.
    expect(hunt.resolution).toEqual({
      kind: 'placement',
      placed: { subgraph: 1, sinkRule: 0, sandbox: 0 },
      unplaced: 1,
      accepted: 1,
      rejected: 1,
    })
    expect(hunt.tasks).toHaveLength(2)
    const t1 = hunt.tasks[0]!
    expect(t1).toMatchObject({
      taskId: 't1',
      stopped: 'done',
      sites: 3,
      model: 'alibaba/qwen3-coder-plus',
      stop: { by: 'submitted', spent: 9800, budget: 30000, next: 4400 },
      wrapUp: { ran: false, skipped: 'submitted' },
    })
    expect(t1.shell!.commands![0]).toEqual({
      cmd: 'rg -n queryRaw lib/',
      chars: 900,
      clipped: true,
    })
    // Control characters stripped; the gate's reason kept.
    expect(t1.shell!.commands![1]).toEqual({
      cmd: 'curl https://evil.test[31m',
      denied: true,
      reason: 'segment is not read-only',
    })
    // LUM-784: a registry secret in the model's step text is masked before it
    // leaves the server, and the payload says so.
    expect(t1.trace![0]!.text).not.toContain(SAMPLE_TOKEN)
    expect(t1.trace![0]!.text).toContain('…(len 40)')
    expect(view.redactedSecrets).toBe(1)
    expect(hunt.tasks[1]).toMatchObject({
      taskId: 't2',
      stopped: 'steps',
      sites: 6,
      stop: { by: 'steps', spent: 19_000, budget: 30_000, steps: 4 },
    })
    expect(hunt.tasks[1]).not.toHaveProperty('shell')
  })

  it('LUM-799 no-progress rows carry their stop reason and both repeat counters', async () => {
    // The two numbers this task adds are only worth computing if they reach a
    // reader: a stop reason the read-out drops is the "computed, carried,
    // never read" shape this layer has already lost four fields to.
    listScans.mockResolvedValue([
      scan({
        huntAudit: {
          candidates: 0,
          rejected: [],
          falsifierRejects: 0,
          planned: [{ id: 't2' }],
          tasks: [
            {
              taskId: 't2',
              objective: 'the loop',
              category: 'idor',
              stopped: 'no-progress',
              elapsedMs: 40_000,
              tokens: 99_000,
              candidates: 1,
              shell: {
                calls: 24,
                refused: 0,
                failed: 0,
                notFound: 0,
                empty: 1,
                repeated: 6,
                commands: [],
              },
              stop: {
                by: 'no-progress',
                spent: 99_000,
                budget: 666_666,
                reserve: 5_000,
                lastStep: 5_000,
                steps: 24,
                repeatSteps: 3,
              },
              wrapUp: { ran: true, submitted: 1, tokens: 5_000 },
            },
          ],
        },
      }),
    ])
    const view = await prScanReadoutService.getForPullRequest('ws-1', {
      number: 1032,
      all: false,
    })
    const hunt = view.scans[0]!.hunt!
    // The coverage line still lists the task: an unknown stop value is
    // DROPPED by the parse, so a task that looped would vanish from the very
    // read-out that has to explain where the tokens went.
    expect(hunt.coverage!.categories).toHaveLength(1)
    expect(hunt.coverage!.categories[0]).toMatchObject({
      taskId: 't2',
      stopped: 'no-progress',
    })
    expect(hunt.tasks[0]).toMatchObject({
      taskId: 't2',
      stopped: 'no-progress',
      stop: { by: 'no-progress', steps: 24, repeatSteps: 3 },
    })
    expect(hunt.tasks[0]!.shell).toMatchObject({ calls: 24, repeated: 6 })
  })

  it('returns hunt: null when the scan has no hunt layer and no audit', async () => {
    listScans.mockResolvedValue([
      scan({ stages: { secrets: 'RAN', judge: 'RAN' }, huntAudit: null }),
    ])
    const view = await prScanReadoutService.getForPullRequest('ws-1', {
      number: 1013,
      all: false,
    })
    expect(view.scans[0]!.hunt).toBeNull()
  })
})

describe('LUM-988 verifier verdict in the read-out', () => {
  it('a rejected LLM_JUDGE row is not open and carries the verdict and reason', async () => {
    findPrs.mockResolvedValue([{ ...PR, state: 'open' }])
    listScans.mockResolvedValue([
      scan({
        findings: [
          finding({
            id: 'rej',
            provenance: 'LLM_JUDGE',
            kind: 'CORRECTNESS',
            ruleId: 'review:logic_error',
            severity: 'MEDIUM',
            verifierVerdict: 'REJECTED',
            verifierReason: 'guarded at src/a.ts:12',
          }),
          finding({
            id: 'kept',
            provenance: 'LLM_JUDGE',
            verifierVerdict: null,
            verifierReason: null,
          }),
        ],
      }),
    ])
    const view = await prScanReadoutService.getForPullRequest('ws-1', {
      number: 1013,
      all: false,
    })
    const [rej, kept] = view.scans[0]!.findings
    expect(rej).toMatchObject({
      open: false,
      blocking: false,
      verifierVerdict: 'REJECTED',
      verifierReason: 'guarded at src/a.ts:12',
    })
    expect(kept).toMatchObject({
      open: true,
      verifierVerdict: null,
      verifierReason: null,
    })
  })
})
