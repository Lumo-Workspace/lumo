/**
 * @jest-environment node
 *
 * LUM-788 — `lumo pr scan <number>`: the by-PR security-scan read-out.
 * Header, one block per scan (layer line in the shared task-status grammar,
 * hunt coverage line, findings incl. dispositioned rows with their source),
 * `--full` per-task hunt detail from the shared printer, `--json` passthrough.
 */
import {
  formatPrScan,
  prScan,
  type PrScanEntry,
  type PrScanFinding,
  type PrScanPayload,
} from '@/cli/src/commands/pr-scan'
import { formatTaskStatus } from '@/cli/src/commands/task-status'

jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_test',
    apiUrl: 'https://lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

function finding(over: Partial<PrScanFinding> = {}): PrScanFinding {
  return {
    id: 'f1',
    kind: 'SECRET',
    ruleId: 'secret:aws-access-key-id',
    severity: 'HIGH',
    provenance: 'DETERMINISTIC',
    filePath: 'src/cfg.ts',
    line: 12,
    title: 'AWS access key id',
    detail: 'looks live',
    externalRef: null,
    disposition: null,
    dispositionSource: null,
    dispositionNote: null,
    dispositionedAt: null,
    blocking: true,
    open: true,
    persisting: false,
    queueExit: null,
    falsifierVerdict: null,
    suggestedDisposition: null,
    suggestionOutcome: null,
    secretDowngrade: null,
    cwe: null,
    reachability: null,
    ...over,
  }
}

function scan(over: Partial<PrScanEntry> = {}): PrScanEntry {
  return {
    id: 's1',
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
    externalFailureReason: 'gitleaks exit 2',
    startedAt: '2026-09-15T07:00:00.000Z',
    finishedAt: '2026-09-15T07:04:00.000Z',
    tokenSpent: 61000,
    counts: {
      findings: 0,
      open: 0,
      blocking: 0,
      dispositioned: 0,
      persisting: 0,
      externalFindings: 0,
      dependencyFindings: 0,
    },
    queueExits: {},
    findings: [],
    hunt: null,
    ...over,
  }
}

function payload(over: Partial<PrScanPayload> = {}): PrScanPayload {
  return {
    version: 1,
    pullRequest: {
      repo: 'Lumo-Workspace/lumo',
      number: 1013,
      title: 'feat: size the hunt by diff [LUM-787]',
      url: 'https://github.com/Lumo-Workspace/lumo/pull/1013',
      state: 'merged',
      task: { identifier: 'LUM-787' },
    },
    scans: [],
    all: false,
    redactedSecrets: 0,
    ...over,
  }
}

const HUNT: NonNullable<PrScanEntry['hunt']> = {
  coverage: {
    total: 3,
    done: 2,
    categories: [
      {
        taskId: 't1',
        category: 'idor',
        stopped: 'done',
        elapsedMs: 41200,
        tokens: 18000,
        candidates: 1,
        attempts: 1,
      },
      {
        taskId: 't2',
        category: 'injection',
        stopped: 'done',
        elapsedMs: 72000,
        tokens: 30000,
        candidates: 0,
        attempts: 2,
      },
      {
        taskId: 't3',
        category: 'race',
        stopped: 'skipped',
        elapsedMs: 0,
        tokens: 0,
        candidates: 0,
        attempts: 1,
      },
    ],
  },
  plannedBy: 'model',
  plannedReason: 'two sinks lit',
  diff: { sourceFiles: 14, sites: 9, taskCap: 4, oversized: true },
  candidates: 2,
  falsifierRejects: 1,
  mechanicallyRejected: 1,
  resolution: {
    kind: 'placement' as const,
    placed: { subgraph: 1, sinkRule: 0, sandbox: 0 },
    unplaced: 1,
    accepted: 1,
    rejected: 1,
  },
  error: null,
  tasks: [
    {
      taskId: 't1',
      stopped: 'done',
      sites: 3,
      model: 'alibaba/qwen3-coder-plus',
      shell: {
        calls: 2,
        refused: 1,
        failed: 0,
        notFound: 0,
        empty: 0,
        commands: [
          { cmd: 'rg -n queryRaw lib/', chars: 900 },
          {
            cmd: 'curl https://evil.test',
            denied: true,
            reason: 'segment is not read-only',
          },
        ],
      },
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
      stopped: 'steps',
      sites: 6,
      model: 'alibaba/qwen3-coder-plus',
      stop: { by: 'steps', spent: 19000, budget: 30000, steps: 4 },
    },
  ],
}

describe('formatPrScan', () => {
  it('prints the PR header and, with no scan on record, the fail-closed line (never an implicit clean)', () => {
    const out = formatPrScan(
      payload({
        pullRequest: { ...payload().pullRequest, task: null, state: 'open' },
      })
    )
    expect(out).toBe(
      [
        'PR #1013 · Lumo-Workspace/lumo · open · no linked task',
        'feat: size the hunt by diff [LUM-787]',
        'https://github.com/Lumo-Workspace/lumo/pull/1013',
        '',
        '⚠ No security scan has run for PR #1013 — could not confirm it is clean.',
        '',
      ].join('\n')
    )
  })

  it('renders the latest scan: head line, the shared layer grammar with the P8 reason, the hunt coverage line, and every finding with its standing', () => {
    const out = formatPrScan(
      payload({
        scans: [
          scan({
            counts: {
              findings: 6,
              open: 2,
              blocking: 1,
              dispositioned: 3,
              persisting: 1,
              externalFindings: 1,
              dependencyFindings: 1,
            },
            queueExits: { MERGED_UNREVIEWED: 1 },
            hunt: HUNT,
            findings: [
              finding(),
              finding({
                id: 'f2',
                ruleId: 'secret:generic-api-key',
                severity: 'LOW',
                secretDowngrade: 'PLACEHOLDER_VALUE',
                blocking: false,
                open: false,
                disposition: 'FALSE_POSITIVE',
                dispositionSource: 'HUMAN',
                dispositionNote: 'doc example',
              }),
              finding({
                id: 'f3',
                kind: 'VULNERABILITY',
                ruleId: 'ext:codeql:js/sql-injection',
                provenance: 'EXTERNAL_TOOL',
                severity: 'MEDIUM',
                line: null,
                blocking: false,
                open: false,
                disposition: 'ACCEPTED_RISK',
                dispositionSource: 'INHERITED',
              }),
              finding({
                id: 'f4',
                kind: 'DEPENDENCY',
                ruleId: 'dep:osv:GHSA-1',
                provenance: 'EXTERNAL_TOOL',
                filePath: 'package-lock.json',
                line: null,
                blocking: false,
                open: false,
                persisting: true,
              }),
              finding({
                id: 'f5',
                kind: 'VULNERABILITY',
                ruleId: 'hunt:idor',
                provenance: 'LLM_JUDGE',
                severity: 'MEDIUM',
                blocking: false,
                open: false,
                disposition: 'FALSE_POSITIVE',
                dispositionSource: 'SUGGESTED_CONFIRMED',
                falsifierVerdict: 'INCONCLUSIVE',
              }),
              finding({
                id: 'f6',
                kind: 'VULNERABILITY',
                ruleId: 'vuln:xss',
                provenance: 'LLM_JUDGE',
                severity: 'LOW',
                blocking: false,
                open: false,
                queueExit: 'MERGED_UNREVIEWED',
                suggestedDisposition: 'FALSE_POSITIVE',
              }),
            ],
          }),
        ],
      })
    )
    const lines = out.split('\n')
    expect(lines[0]).toBe(
      'PR #1013 · Lumo-Workspace/lumo · merged · task LUM-787'
    )
    expect(lines[4]).toBe(
      'Scan abcdef0 · FINDINGS · started 2026-09-15T07:00:00.000Z · finished 2026-09-15T07:04:00.000Z · trigger PR_EVENT · 61,000 tokens'
    )
    expect(lines[5]).toBe(
      '  Secrets: checked · Code scan: ✗ failed (1 external finding) · Dependencies: checked (1 dependency finding, 1 already on main) · AI review: checked · Exploit paths: checked · 1 left the queue (1 merged unreviewed) — gitleaks exit 2'
    )
    // LUM-814: the judge's own arithmetic sits under the layer line, ahead of
    // the hunt's detail — stage order, matching the segments above.
    expect(lines[6]).toBe('    AI review budget: not recorded on this scan')
    expect(lines[7]).toBe(
      '    Exploit paths 2/3 done · t1 idor 41.2s done · t2 injection 72.0s done (2 attempts) · t3 race skipped'
    )
    expect(lines[8]).toBe(
      '  Findings: 6 (2 open · 1 blocks DONE · 3 dispositioned · 1 already on main)'
    )
    expect(lines.slice(9, 15)).toEqual([
      '    [HIGH] DETERMINISTIC secret:aws-access-key-id — src/cfg.ts:12 — AWS access key id (blocks DONE)',
      '    [LOW] DETERMINISTIC secret:generic-api-key — src/cfg.ts:12 — AWS access key id — placeholder value, downgraded (FALSE_POSITIVE · human · "doc example")',
      '    [MEDIUM] EXTERNAL_TOOL ext:codeql:js/sql-injection — src/cfg.ts — AWS access key id (ACCEPTED_RISK · inherited from an earlier scan of this PR)',
      '    [HIGH] EXTERNAL_TOOL dep:osv:GHSA-1 — package-lock.json — AWS access key id (already on main)',
      '    [MEDIUM] LLM_JUDGE hunt:idor — src/cfg.ts:12 — AWS access key id (FALSE_POSITIVE · AI-suggested, human-confirmed · falsifier INCONCLUSIVE)',
      '    [LOW] LLM_JUDGE vuln:xss — src/cfg.ts:12 — AWS access key id (merged unreviewed · AI suggests FALSE_POSITIVE)',
    ])
    // Default read-out stops at the findings — the per-task detail is --full.
    expect(out).not.toContain('Hunt:')
    expect(out).not.toContain('stop:')
  })

  it('--full appends the hunt header (plan, diff sizing, gate counts) and the shared per-task detail — idle tasks included', () => {
    const out = formatPrScan(payload({ scans: [scan({ hunt: HUNT })] }), {
      full: true,
    })
    const lines = out.split('\n')
    const at = lines.indexOf(
      '  Hunt: planned by model — two sinks lit · diff 14 source files · 9 sites · task cap 4 · oversized (a corner of the diff was covered) · candidates 2 · mechanically rejected 1 · placed by subgraph 1 · sink rule 0 · sandbox 0 · unplaced 1 · survived 1 · rejected 1 · falsifier rejects 1'
    )
    expect(at).toBeGreaterThan(0)
    expect(lines.slice(at + 1, at + 9)).toEqual([
      '    t1 done · alibaba/qwen3-coder-plus · 3 sites · 2 cmds (gate refused 1, sandbox failed 0, not found 0, empty 0)',
      '          rg -n queryRaw lib/  [900 chars]',
      '        ✗ curl https://evil.test   ← segment is not read-only',
      '        stop: submitted · spent 9800/30000 · reserve 4400 · last step 4300 · next 4400 · 3 steps',
      '        wrap-up: not made (submitted)',
      '    t2 steps · alibaba/qwen3-coder-plus · 6 sites · no shell commands',
      '        stop: steps · spent 19000/30000 · reserve 0 · last step ? · 4 steps',
      '',
    ])
  })

  it('LUM-798 a scan written before the gate counted resolutions prints as it always did', () => {
    const out = formatPrScan(
      payload({ scans: [scan({ hunt: { ...HUNT, resolution: null } })] }),
      { full: true }
    )
    expect(out).toContain('mechanically rejected 1 · falsifier rejects 1')
    expect(out).not.toContain('placed by')
  })

  it('LUM-798 follow-up prints the first tally shape as legacy, never mixed in', () => {
    // A row from between the two deploys counts a placement only when the
    // candidate also survived, so its tiers are not the same measurement.
    // Saying so beats silently presenting them as if they were.
    const out = formatPrScan(
      payload({
        scans: [
          scan({
            hunt: {
              ...HUNT,
              resolution: {
                kind: 'legacy' as const,
                subgraph: 1,
                sinkRule: 0,
                sandbox: 0,
                rejected: 1,
              },
            },
          }),
        ],
      }),
      { full: true }
    )
    expect(out).toContain(
      'resolved by subgraph 1 · sink rule 0 · sandbox 0 · rejected 1 (legacy tally — placements counted only on acceptance)'
    )
    expect(out).not.toContain('placed by')
  })

  it('says when a scan has no findings, when tokens were not metered, and lists every head under --all', () => {
    const out = formatPrScan(
      payload({
        all: true,
        scans: [
          scan({ status: 'CLEAN', tokenSpent: null, finishedAt: null }),
          scan({
            id: 's0',
            headSha: '0123456abcdef',
            status: 'FAILED',
            stages: { secrets: 'RAN', judge: 'FAILED' },
            externalFailureReason: null,
            partial: true,
          }),
        ],
      })
    )
    expect(out).toContain('2 scans on record, newest first')
    expect(out).toContain(
      'Scan abcdef0 · CLEAN · started 2026-09-15T07:00:00.000Z · not finished · trigger PR_EVENT · tokens not metered'
    )
    expect(out).toContain('  Findings: none on this scan')
    expect(out).toContain(
      'Scan 0123456 · FAILED · started 2026-09-15T07:00:00.000Z · finished 2026-09-15T07:04:00.000Z · trigger PR_EVENT · 61,000 tokens'
    )
    expect(out).toContain('  Secrets: checked · AI review: ✗ failed · partial')
  })

  it('strips control characters from server-supplied text before printing', () => {
    const out = formatPrScan(
      payload({
        pullRequest: {
          ...payload().pullRequest,
          title: 'evil[31m title',
        },
        scans: [
          scan({
            counts: { ...scan().counts, findings: 1, open: 1, blocking: 1 },
            findings: [finding({ title: 'x[0my', ruleId: 'a\u0000b' })],
          }),
        ],
      })
    )
    expect(out).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/)
    expect(out).toContain('evil[31m title')
  })

  it('renders the layer line with the very same grammar `lumo task status` uses for the same scan', () => {
    const shared = {
      stages: {
        secrets: 'RAN',
        external: 'RAN',
        supplyChain: 'RAN',
        judge: 'SKIPPED',
        hunt: 'PARTIAL',
      },
      partial: true,
      externalFindings: 2,
      dependencyFindings: 1,
      persistingFindings: 1,
      queueExits: { RESOLVED_ON_MAIN: 2 },
    }
    const status = formatTaskStatus({
      version: 1,
      task: { id: 't', identifier: 'LUM-1', title: 'x', status: 'DONE' },
      currentRound: 0,
      maxRounds: 3,
      escalated: false,
      criteria: [],
      machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
      verificationHistory: [],
      lastRoundFailures: [],
      nextActions: [],
      securityFindings: {
        open: 0,
        blocking: 0,
        unconfirmedPrs: [],
        scans: [
          {
            prNumber: 1013,
            status: 'FINDINGS',
            error: null,
            openFindings: 0,
            ...shared,
          },
        ],
      },
    })
    const statusLine = status
      .split('\n')
      .find(l => l.startsWith('  PR #1013 · scan FINDINGS'))!
    const scanOut = formatPrScan(
      payload({
        scans: [
          scan({
            stages: shared.stages,
            partial: true,
            externalFailureReason: null,
            queueExits: shared.queueExits,
            counts: {
              ...scan().counts,
              externalFindings: 2,
              dependencyFindings: 1,
              persisting: 1,
            },
          }),
        ],
      })
    )
    const scanLine = scanOut.split('\n')[5]!
    expect(statusLine.replace('  PR #1013 · scan FINDINGS · ', '')).toBe(
      scanLine.replace(/^  /, '')
    )
  })
})

describe('prScan (command)', () => {
  const stdout = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true)
  const stderr = jest.spyOn(console, 'error').mockImplementation(() => {})
  const fetchMock = jest.fn()

  beforeEach(() => {
    stdout.mockClear()
    stderr.mockClear()
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('rejects a non-numeric number and a malformed --repo before any request', async () => {
    expect(await prScan('abc')).toBe(1)
    expect(await prScan('1013', { repo: 'nope' })).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('builds the URL from the number, --repo and --all, and emits the raw payload under --json', async () => {
    const data = payload()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => data,
    })
    await prScan('1013', { repo: 'Lumo-Workspace/lumo', all: true, json: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://lumo.test/api/pull-requests/1013/scans?repo=Lumo-Workspace%2Flumo&all=1',
      { headers: { Authorization: 'Bearer lum_test' } }
    )
    expect(stdout).toHaveBeenCalledWith(JSON.stringify(data, null, 2) + '\n')
  })

  it('prints the prose read-out plus the LUM-784 redaction notice when the server redacted something', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload({ redactedSecrets: 2 }),
    })
    await prScan('1013')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://lumo.test/api/pull-requests/1013/scans',
      expect.anything()
    )
    expect(log.mock.calls[0]![0]).toContain(
      '2 suspected credentials were redacted'
    )
    expect(stdout.mock.calls[0]![0]).toContain('PR #1013 · Lumo-Workspace/lumo')
    log.mockRestore()
  })

  it('maps 404 to a not-found error and 409 to the --repo candidates', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    })
    expect(await prScan('99')).toBe(1)
    expect(stderr.mock.calls[0]![0]).toBe(
      'Error: PR #99 not found in workspace lumo'
    )

    stderr.mockClear()
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'PR #7 exists in several repos — pass --repo <owner/repo>',
        repos: ['a/one', 'a/two'],
      }),
    })
    expect(await prScan('7')).toBe(1)
    expect(stderr.mock.calls.map(c => c[0])).toEqual([
      'Error: PR #7 exists in several repos — pass --repo <owner/repo>',
      '  lumo pr scan 7 --repo a/one',
      '  lumo pr scan 7 --repo a/two',
    ])
  })
})

/**
 * LUM-814 — the judge's budget arithmetic.
 *
 * The specimens are real: PR 1051 (117,408 chars, 34 source files) and
 * PR 1052 (168,516 chars, 6 source files) both printed `AI review: checked`
 * and nothing else, so the read-out could not tell "2.2% of the tier left"
 * from "rescued from dropping 64% of itself". These cases pin the line that
 * separates them.
 */
describe('formatPrScan judge budget', () => {
  const withBudget = (
    budget: NonNullable<PrScanEntry['judgeBudget']> | null
  ): string => formatPrScan(payload({ scans: [scan({ judgeBudget: budget })] }))

  it('LUM-814 judge budget line prints chars, tier and remaining headroom when the diff was reviewed whole', () => {
    // PR 1051's real arithmetic: nothing dropped, and only 2.2% to spare.
    const out = withBudget({
      diffChars: 117_408,
      tierChars: 120_000,
      reviewedChars: 117_408,
      coveredFiles: 34,
      droppedFiles: 0,
    })
    expect(out).toContain(
      'AI review budget: diff 117,408 chars · tier 120,000 · 2,592 left, 2.2%'
    )
    // The near-miss is visible WITHOUT --full or --json: that is the point.
    expect(out).not.toContain('not recorded')
  })

  it('LUM-814 judge budget line separates two scans that both read "AI review: checked"', () => {
    // PR 1052: a bigger diff, but further from its tier than PR 1051 is.
    const out = withBudget({
      diffChars: 168_516,
      tierChars: 180_000,
      reviewedChars: 168_516,
      coveredFiles: 6,
      droppedFiles: 0,
    })
    expect(out).toContain(
      'AI review budget: diff 168,516 chars · tier 180,000 · 11,484 left, 6.4%'
    )
  })

  it('LUM-814 judge budget line prints the overage and the unreviewed share of the diff when truncated', () => {
    const out = withBudget({
      diffChars: 261_400,
      tierChars: 180_000,
      reviewedChars: 179_100,
      coveredFiles: 29,
      droppedFiles: 12,
    })
    expect(out).toContain(
      'AI review budget: diff 261,400 chars · tier 180,000 · over by 81,400 · 12 of 41 files dropped, 31.5% of the diff unreviewed'
    )
  })

  it('LUM-814 unrecorded budget reads as not recorded, never as a spend of zero', () => {
    // A scan written before the column existed. Fail-closed, same rule as
    // `tokens not metered`: unknown is not "spent nothing".
    expect(withBudget(null)).toContain(
      'AI review budget: not recorded on this scan'
    )
    // An older server omits the field entirely — same reading.
    const out = formatPrScan(payload({ scans: [scan()] }))
    expect(out).toContain('AI review budget: not recorded on this scan')
    expect(out).not.toContain('diff 0 chars')
  })

  it('LUM-814 judge budget line is absent when the scan carries no judge layer at all', () => {
    const out = formatPrScan(
      payload({
        scans: [scan({ stages: { secrets: 'RAN' }, judgeBudget: null })],
      })
    )
    expect(out).not.toContain('AI review budget')
  })

  it('LUM-814 judge budget line names no threshold and no source-file count', () => {
    // Q2/Q3 rulings on this task: no derived-from-nothing "near cap" marker,
    // and no by-source-file-count comparison (LUM-811 retired that rule).
    const out = withBudget({
      diffChars: 117_408,
      tierChars: 120_000,
      reviewedChars: 117_408,
      coveredFiles: 34,
      droppedFiles: 0,
    })
    expect(out).not.toMatch(/near cap|source file/i)
  })
})
