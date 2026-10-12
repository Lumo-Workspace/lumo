/**
 * @jest-environment node
 *
 * LUM-1091 — the three long reports (`task status`, `task wrapup`,
 * `pr scan`) share one layout: plain section headings, labelled rows instead
 * of `·`-joined lines, at most three levels of indent, prose wrapped at the
 * report width, every shell command on a line of its own. `--json` is left
 * byte-for-byte as it was, and colour only appears on a TTY.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))

import {
  formatTaskStatus,
  taskStatus,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'
import { formatWrapup, type WrapupInput } from '@/cli/src/commands/task-wrapup'
import {
  formatPrScan,
  prScan,
  type PrScanFinding,
  type PrScanPayload,
} from '@/cli/src/commands/pr-scan'
import {
  fetchOpenCrossings,
  type OpenCrossing,
} from '@/cli/src/lib/open-crossings'
import { stringWidth } from '@/cli/src/lib/ui'

const STATUS: TaskStatusResponse = {
  version: 2,
  task: {
    id: 't1',
    identifier: 'LUM-9001',
    title: 'Wrap me up',
    status: 'IN_REVIEW',
  },
  cost: { tokenCost: 1_234_000, activeTimeSec: 8040 },
  struggleTrail: {
    pullRequests: [
      { number: 77, url: 'u' },
      { number: 81, url: 'u' },
    ],
    reopens: [{ from: 'IN_REVIEW', to: 'IN_PROGRESS', at: '2026-10-01' }],
  },
  trend: {
    cost: [
      { sessionId: 's1', total: 400_000, loopCount: 1, at: 'a' },
      { sessionId: 's2', total: 834_000, loopCount: 2, at: 'b' },
    ],
    rework: { reopens: 1, extraPrCycles: 1, total: 2 },
  },
  nextActions: [
    {
      kind: 'SECURITY_FINDING',
      findingId: 'f1',
      statement: 'secret:aws-access-key-id — AWS access key id',
      severity: 'HIGH',
      provenance: 'DETERMINISTIC',
      blocking: true,
      prNumber: 77,
      ruleId: 'secret:aws-access-key-id',
      filePath: 'src/cfg.ts',
      line: 12,
      secretDowngrade: null,
    },
    {
      kind: 'SECURITY_FINDING',
      findingId: 'f2',
      statement:
        'review:CORRECTNESS — pager skips the last page when the total is a multiple of the page size',
      severity: 'MEDIUM',
      provenance: 'LLM_JUDGE',
      blocking: false,
      prNumber: 77,
      ruleId: 'review:CORRECTNESS',
      filePath: 'lib/pager.ts',
      line: 40,
    },
    {
      kind: 'TEST_CASE',
      statement: 'No test case recorded on this task yet',
      command:
        'lumo task testcase add LUM-9001 --title "<title>" --step "<step>" --expected "<result>"',
      advisory: true,
    },
    {
      kind: 'TEST_CASE_VERDICT',
      signal: 'UNPROVEN_PASS',
      number: 3,
      title: 'manual smoke',
      ceilingReason: 'no-evidence',
      advisory: true,
    },
    {
      kind: 'TEST_CASE_VERDICT',
      signal: 'PROVEN_DEFECT',
      number: 4,
      title: 'login redirect',
      advisory: true,
    },
  ],
  securityFindings: {
    open: 2,
    blocking: 1,
    unconfirmedPrs: [{ number: 81, reason: 'NONE' }],
    scans: [
      {
        prNumber: 77,
        status: 'FINDINGS',
        stages: {
          secrets: 'RAN',
          external: 'FAILED',
          supplyChain: 'RAN',
          judge: 'RAN',
          hunt: 'PARTIAL',
        },
        partial: true,
        partialCauses: ['HUNT_BUDGET'],
        error: 'external: gitleaks exit 2',
        externalFindings: 2,
        openFindings: 2,
        dependencyFindings: 1,
        persistingFindings: 1,
        queueExits: { RESOLVED_ON_MAIN: 1 },
        huntProgress: { coveredFiles: 3, totalFiles: 5 },
        hunt: {
          total: 3,
          done: 2,
          categories: [
            {
              taskId: 't1',
              category: 'idor',
              stopped: 'done',
              elapsedMs: 41200,
              tokens: 1,
              candidates: 0,
              attempts: 1,
            },
            {
              taskId: 't2',
              category: 'injection',
              stopped: 'done',
              elapsedMs: 72000,
              tokens: 1,
              candidates: 1,
              attempts: 2,
            },
          ],
        },
      },
    ],
  },
}

function crossing(over: Partial<OpenCrossing> = {}): OpenCrossing {
  return {
    id: 'cx-1',
    ref: 'LUM-X12',
    category: 'TEST_FILE_DELETED',
    severity: 'MEDIUM',
    detail: 'deleted __tests__/old.test.ts',
    attribution: {
      workspaceMemberId: 'm1',
      sessionId: 'a6be42a4-c9a4-45be',
      agent: 'claude-code',
      worktreeBranch: 'lumo/LUM-9001-x',
      model: 'claude-opus-5-5',
    },
    advisory: false,
    blocking: true,
    rejudge: null,
    occurrenceCount: 2,
    reversible: false,
    explanations: [
      'the helper it covered was removed in the same commit, so the test had nothing left to exercise',
    ],
    ...over,
  }
}

const CROSSINGS = {
  status: 'ok' as const,
  gateEnabled: true,
  crossings: [
    crossing(),
    crossing({
      id: 'cx-2',
      ref: 'LUM-X13',
      category: 'PROJECT_RULE_VIOLATION',
      severity: 'LOW',
      detail: 'console.log in scripts/report.ts',
      advisory: true,
      blocking: false,
      rejudge: 'the line is gone from the PR head',
      occurrenceCount: 1,
      reversible: true,
      explanations: [],
    }),
  ],
}
const URL_ =
  'https://api.test/workspace/lumo/my-tasks/LUM-9001#boundary-crossings'

function wrapupInput(over: Partial<WrapupInput> = {}): WrapupInput {
  return {
    identifier: 'LUM-9001',
    status: { ok: true, value: STATUS },
    task: {
      ok: true,
      value: {
        identifier: 'LUM-9001',
        title: 'Wrap me up',
        status: 'IN_REVIEW',
        pullRequests: [
          {
            number: 77,
            title: 'feat: wrap up',
            url: 'https://github.com/o/r/pull/77',
            state: 'merged',
            headSha: 'abc',
          },
        ],
      },
    },
    crossings: CROSSINGS,
    worktrees: {
      mainRoot: '/repo',
      items: [
        {
          path: '/repo/.worktrees/LUM-9001-x',
          branch: 'lumo/LUM-9001-x',
          removable: false,
          reason: 'cwd',
          detail: 'the current directory is inside it',
        },
      ],
    },
    dispositionUrl: URL_,
    ...over,
  }
}

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

const PR_SCAN: PrScanPayload = {
  version: 1,
  reviewControl: {
    paused: false,
    rounds: 1,
    limit: 3,
    currentHead: 'fff0000000000000',
  },
  pullRequest: {
    repo: 'o/r',
    number: 77,
    title: 'feat: wrap up',
    url: 'https://github.com/o/r/pull/77',
    state: 'open',
    task: { identifier: 'LUM-9001' },
  },
  all: false,
  scans: [
    {
      id: 's1',
      headSha: 'abcdef0123456789',
      status: 'FINDINGS',
      trigger: 'PR_EVENT',
      judgeStatus: 'RAN',
      truncated: true,
      stages: {
        secrets: 'RAN',
        external: 'FAILED',
        supplyChain: 'RAN',
        judge: 'RAN',
        hunt: 'RAN',
      },
      partial: true,
      partialCauses: ['EXTERNAL_FAILED'],
      externalFailureReason: 'gitleaks exit 2',
      startedAt: '2026-09-15T07:00:00.000Z',
      finishedAt: '2026-09-15T07:04:00.000Z',
      tokenSpent: 61000,
      judgeBudget: {
        diffChars: 117408,
        tierChars: 120000,
        reviewedChars: 117408,
        coveredFiles: 12,
        droppedFiles: 0,
      },
      counts: {
        findings: 2,
        open: 1,
        blocking: 1,
        dispositioned: 1,
        persisting: 0,
        externalFindings: 1,
        dependencyFindings: 0,
      },
      queueExits: {},
      findings: [
        finding(),
        finding({
          id: 'f3',
          ruleId: 'semgrep:sql-injection',
          severity: 'MEDIUM',
          provenance: 'EXTERNAL_TOOL',
          filePath: 'lib/db.ts',
          line: 7,
          title: 'string-built SQL',
          blocking: false,
          open: false,
          disposition: 'FALSE_POSITIVE',
          dispositionSource: 'HUMAN',
          dispositionNote: 'parameterised two lines up',
        }),
      ],
      hunt: {
        coverage: {
          total: 1,
          done: 1,
          categories: [
            {
              taskId: 't1',
              category: 'idor',
              stopped: 'done',
              elapsedMs: 41200,
              tokens: 1,
              candidates: 0,
              attempts: 1,
            },
          ],
        },
        plannedBy: 'planner-v2',
        plannedReason: 'auth surface changed',
        diff: { sourceFiles: 5, sites: 12, taskCap: 5, oversized: true },
        candidates: 5,
        falsifierRejects: 1,
        mechanicallyRejected: 3,
        resolution: null,
        error: null,
        tasks: [
          {
            taskId: 't1',
            stopped: 'done',
            shell: {
              calls: 2,
              refused: 1,
              commands: [
                { cmd: 'rg -n userId lib/', chars: 812 },
                { cmd: 'cat .env', denied: true, reason: 'secret path' },
              ],
            },
            stop: { by: 'budget', spent: 1, budget: 2, steps: 5 },
          },
        ],
      },
    },
  ],
}

const ALL_REPORTS: Array<[string, string]> = [
  [
    'task status --full',
    formatTaskStatus(STATUS, {
      full: true,
      openCrossings: CROSSINGS,
      dispositionUrl: URL_,
    }),
  ],
  ['task wrapup (blocked)', formatWrapup(wrapupInput())],
  [
    'task wrapup (ready)',
    formatWrapup(
      wrapupInput({
        status: {
          ok: true,
          value: {
            ...STATUS,
            nextActions: [],
            securityFindings: {
              open: 0,
              blocking: 0,
              unconfirmedPrs: [],
              scans: [],
            },
          },
        },
        crossings: { status: 'ok', gateEnabled: true, crossings: [] },
      })
    ),
  ],
  ['pr scan --full', formatPrScan(PR_SCAN, { full: true })],
]

/** A line that is a shell command, a URL or an envelope line printed verbatim. */
const VERBATIM = /^\s*(lumo |git |https?:\/\/|#\d+ |t\d+ (done|steps)|- rg )/

describe('LUM-1091 long-report layout', () => {
  it.each(ALL_REPORTS)(
    '%s: nests at most three levels deep (2/4/6 spaces)',
    (_name, out) => {
      for (const line of out.split('\n')) {
        const indent = line.length - line.trimStart().length
        expect({ line, indent: indent <= 6 && indent % 2 === 0 }).toEqual({
          line,
          indent: true,
        })
      }
    }
  )

  it.each(ALL_REPORTS)(
    '%s: wraps prose at 100 columns (commands and URLs stay whole)',
    (_name, out) => {
      const long = out
        .split('\n')
        .filter(l => stringWidth(l) > 100 && !VERBATIM.test(l))
      expect(long).toEqual([])
    }
  )

  it.each(ALL_REPORTS)(
    '%s: is plain text when called directly — no ANSI escapes',
    (_name, out) => {
      expect(out).not.toContain('\u001b')
    }
  )

  it('task status: one heading per section, in reading order', () => {
    const out = ALL_REPORTS[0]![1]
    const headings = out
      .split('\n')
      .filter((l, i, all) => i > 0 && all[i - 1] === '' && l !== '')
    expect(headings).toEqual([
      'Cost',
      'Struggle / rework',
      'Trend (2 sessions)',
      'Next actions (1 security finding · 1 bug)',
      'Security scans',
      'Open boundary crossings (2 undispositioned: 1 blocking DONE, 1 advisory / non-blocking)',
    ])
  })

  it('task status: a security finding is split into labelled rows, nothing dropped', () => {
    const out = ALL_REPORTS[0]![1]
    expect(out).toContain(
      [
        '  • [SECURITY] [HIGH] AWS access key id',
        '    Rule:   secret:aws-access-key-id (DETERMINISTIC)',
        '    Where:  src/cfg.ts:12 · PR #77',
        '    Gate:   blocks DONE',
      ].join('\n')
    )
    // the per-PR scan: one labelled row per layer, the reason on its own row
    expect(out).toContain(
      [
        '  PR #77 · scan FINDINGS',
        '    Secrets:        checked',
        "    Code scan:      ⚠ didn't finish (2 external findings) — gitleaks exit 2",
        '    Dependencies:   checked (1 dependency finding, 1 already on main)',
        '    AI review:      checked',
        '    Exploit paths:  ⚠ partly checked (3/5 source files)',
        '      2/3 planned tasks done',
        '      t1  idor       41.2s  done',
        '      t2  injection  72.0s  done (2 attempts)',
        "    Note:           part of this scan hasn't finished on our side — not counted as checked",
        '    Queue:          1 left the queue (1 resolved on main)',
      ].join('\n')
    )
    // crossings: one bullet glyph, ref + gate on the item line, facts below
    expect(out).toContain(
      [
        '  • LUM-X13 [LOW] PROJECT_RULE_VIOLATION (advisory — does not block DONE)',
        '    Re-judged:  the line is gone from the PR head',
        '    Detail:     console.log in scripts/report.ts',
        '    By:         model=claude-opus-5-5 · agent=claude-code/lumo/LUM-9001-x · session=a6be42a4',
      ].join('\n')
    )
    expect(out).not.toContain('◦')
    expect(out).toContain(
      '\n    lumo crossing disposition <id> --false-positive | --confirmed\n'
    )
  })

  it('task wrapup: every command sits on a line of its own', () => {
    const out = ALL_REPORTS[1]![1]
    const commandLines = out.split('\n').filter(l => /\blumo \w/.test(l))
    for (const l of commandLines) expect(l.trimStart()).toMatch(/^lumo /)
    expect(out).not.toContain(' → lumo')
    expect(out).not.toContain('  |  ')
    expect(out).toContain(
      [
        '  • [TEST CASE] TC4 login redirect — implementation defect, with evidence (advisory)',
        '    Blocks DONE until the user rules on that run — one of:',
        '      lumo task testcase disposition LUM-9001/TC4 --known-defect',
        '      lumo task testcase disposition LUM-9001/TC4 --not-a-defect',
      ].join('\n')
    )
    expect(out).toContain(
      [
        '  The user rules all 2 false-positive:',
        '    lumo crossing disposition LUM-X12 LUM-X13 --false-positive --task LUM-9001',
        '  The user rules all 2 confirmed:',
        '    lumo crossing disposition LUM-X12 LUM-X13 --confirmed --task LUM-9001',
      ].join('\n')
    )
    // the envelope's keep line: the removal command moves to its own line
    expect(out).toMatch(
      /remove it later\n {4}from elsewhere:\n {6}git -C \/repo worktree remove \/repo\/\.worktrees\/LUM-9001-x\n/
    )
  })

  it('task wrapup READY: the DONE command is alone on its line, under the instruction', () => {
    const out = ALL_REPORTS[2]![1]
    expect(out).toContain(
      '  Show the user the lines above. Only after they approve, run:\n    lumo task update LUM-9001 --status done --confirm\n'
    )
  })

  it('pr scan: header and scan facts are labelled rows; review commands on their own lines', () => {
    const out = ALL_REPORTS[3]![1]
    expect(out.startsWith('PR #77  feat: wrap up\n  Repo:   o/r\n')).toBe(true)
    expect(out).toContain(
      [
        'AI review',
        '  Automatic:  enabled · 1/3 rounds',
        '  Run a review now (incremental or full):',
        '    lumo pr scan 77 --repo o/r --review incremental',
        '    lumo pr scan 77 --repo o/r --review full',
        '  Resume automatic review:',
        '    lumo pr scan 77 --repo o/r --resume',
        '  ⚠ Latest head has no scan yet; the results below are for an earlier commit.',
      ].join('\n')
    )
    expect(out).toContain(
      [
        'Scan abcdef0 · FINDINGS',
        '  Started:        2026-09-15T07:00:00.000Z',
        '  Finished:       2026-09-15T07:04:00.000Z',
        '  Trigger:        PR_EVENT',
        '  Tokens:         61,000',
        '  Secrets:        checked',
        "  Code scan:      ⚠ didn't finish (1 external finding) — gitleaks exit 2",
        '  Dependencies:   checked',
        '  AI review:      checked',
        '    AI review has not covered every file yet',
        '    AI review budget: diff 117,408 chars · tier 120,000 · 2,592 left, 2.2%',
        '  Exploit paths:  checked',
      ].join('\n')
    )
    expect(out).toContain(
      [
        '    • [MEDIUM] string-built SQL',
        '      Rule:      semgrep:sql-injection (EXTERNAL_TOOL)',
        '      Where:     lib/db.ts:7',
        '      Standing:  FALSE_POSITIVE · human · "parameterised two lines up"',
      ].join('\n')
    )
    // --full: hunt audit as rows, task detail re-based (✗ kept, blank mark → -)
    expect(out).toMatch(/^ {4}Mechanically rejected: +3$/m)
    expect(out).toContain('      - rg -n userId lib/  [812 chars]')
    expect(out).toContain('      ✗ cat .env   ← secret path')
  })
})

describe('LUM-1091 --json is untouched by the new layout', () => {
  let out: string[]
  beforeEach(() => {
    out = []
    jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk))
        return true
      })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  function route(): void {
    global.fetch = jest.fn(async (url: string) => {
      const body = url.endsWith('/boundary-crossings')
        ? {
            gateEnabled: true,
            crossings: [
              {
                id: 'cx-1',
                ref: 'LUM-X12',
                category: 'TEST_FILE_DELETED',
                severity: 'MEDIUM',
                detail: 'deleted a test',
                disposition: null,
              },
            ],
          }
        : url.includes('/pull-requests/')
          ? PR_SCAN
          : STATUS
      return { ok: true, status: 200, json: async () => body } as Response
    }) as unknown as typeof fetch
  }

  it('task status --json is the server payload plus openCrossings, byte for byte', async () => {
    route()
    await taskStatus('LUM-9001', { json: true, full: true })
    const read = await fetchOpenCrossings(
      'https://api.test',
      'lum_x',
      'LUM-9001'
    )
    expect(read.status).toBe('ok')
    const openCrossings = read.status === 'ok' ? read.crossings : null
    expect(out.join('')).toBe(
      JSON.stringify({ ...STATUS, openCrossings }, null, 2) + '\n'
    )
  })

  it('pr scan --json is the server payload, byte for byte', async () => {
    route()
    await prScan('77', { json: true, full: true })
    expect(out.join('')).toBe(JSON.stringify(PR_SCAN, null, 2) + '\n')
  })
})

describe('LUM-1091 colour only on a TTY, applied after sanitizing', () => {
  const desc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  let out: string[]
  beforeEach(() => {
    out = []
    jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk))
        return true
      })
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...STATUS,
        task: { ...STATUS.task, title: 'evil \u001b[31mred\u001b[0m title' },
      }),
    })) as unknown as typeof fetch
  })
  afterEach(() => {
    jest.restoreAllMocks()
    if (desc) Object.defineProperty(process.stdout, 'isTTY', desc)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    delete process.env.NO_COLOR
  })

  it('a TTY gets bold headings and dim labels; server text still carries no ESC of its own', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    })
    delete process.env.NO_COLOR
    await taskStatus('LUM-9001')
    const text = out.join('')
    expect(text).toContain(
      '\u001b[1mNext actions (1 security finding · 1 bug)\u001b[22m'
    )
    expect(text).toContain('\u001b[2mRule:\u001b[22m')
    // the title's own escape sequences were stripped before styling
    expect(text.split('\n')[0]).not.toContain('\u001b')
  })

  it('NO_COLOR on a TTY, and any non-TTY, stays plain', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    })
    process.env.NO_COLOR = '1'
    await taskStatus('LUM-9001')
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
    })
    delete process.env.NO_COLOR
    await taskStatus('LUM-9001')
    expect(out.join('')).not.toContain('\u001b')
  })
})
