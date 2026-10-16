/**
 * @jest-environment node
 *
 * LUM-1189 — `lumo task scans <task>`: every linked PR's scans, rendered by
 * the same printer as `lumo pr scan` (no fork), under a task header. Also
 * the finding rows the two commands share now carry the call chain, the
 * verifier's confirmation and the AI suggestion's reason.
 */
import {
  callChainLines,
  formatPrScan,
  type PrScanEntry,
  type PrScanFinding,
  type PrScanPayload,
} from '@/cli/src/commands/pr-scan'
import {
  formatTaskScans,
  isTaskScansPayload,
  taskScans,
  type TaskScansPayload,
} from '@/cli/src/commands/task-scans'

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
    kind: 'VULN',
    ruleId: 'hunt:sqli',
    severity: 'HIGH',
    provenance: 'LLM_HUNT',
    filePath: 'src/db.ts',
    line: 40,
    title: 'SQL built from request input',
    detail: 'query string reaches raw SQL',
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
    cwe: 'CWE-89',
    reachability: 'REACHABLE',
    ...over,
  }
}

function scan(findings: PrScanFinding[], over: Partial<PrScanEntry> = {}) {
  const entry: PrScanEntry = {
    id: 's1',
    headSha: 'aaaaaaa1',
    status: 'FINDINGS',
    trigger: 'PR_EVENT',
    judgeStatus: 'RAN',
    truncated: false,
    stages: { secrets: 'RAN', judge: 'RAN', hunt: 'RAN' },
    partial: false,
    externalFailureReason: null,
    startedAt: '2026-10-15T07:00:00.000Z',
    finishedAt: '2026-10-15T07:04:00.000Z',
    tokenSpent: null,
    counts: {
      findings: findings.length,
      open: findings.filter(f => f.open).length,
      blocking: findings.filter(f => f.blocking).length,
      dispositioned: findings.filter(f => f.disposition !== null).length,
      persisting: 0,
      externalFindings: 0,
      dependencyFindings: 0,
    },
    queueExits: {},
    findings,
    hunt: null,
    ...over,
  }
  return entry
}

function prPayload(
  number: number,
  title: string,
  scans: PrScanEntry[]
): PrScanPayload {
  return {
    version: 1,
    pullRequest: {
      repo: 'Lumo-Workspace/lumo',
      number,
      title,
      url: `https://github.com/Lumo-Workspace/lumo/pull/${number}`,
      state: 'open',
      task: { identifier: 'LUM-1189' },
    },
    scans,
    all: false,
    redactedSecrets: 0,
  }
}

const TWO_PRS: TaskScansPayload = {
  version: 1,
  task: { identifier: 'LUM-1189' },
  pullRequests: [
    prPayload(1501, 'fix: two', [
      scan([
        finding({
          id: 'f2',
          disposition: 'ACCEPTED_RISK',
          dispositionSource: 'HUMAN',
          dispositionNote: 'internal only',
          dispositionedAt: '2026-10-16T09:00:00.000Z',
          blocking: false,
          open: false,
        }),
      ]),
    ]),
    prPayload(1500, 'feat: one\u001b[2J', [
      scan(
        [
          finding({
            callChain: [
              { from: 'GET /api/x', to: 'svc.read' },
              { from: 'svc.read', to: 'db.raw\u0007' },
            ],
            suggestedDisposition: 'FALSE_POSITIVE',
            suggestedReason: 'input is a constant',
            verifierVerdict: 'CONFIRMED',
            verifierReason: 'reachable from the route',
          }),
        ],
        {
          partial: true,
          partialCauses: ['hunt-over-cap'],
          huntOverCap: { sourceFiles: 80, capFiles: 40 },
        }
      ),
    ]),
  ],
  totals: { pullRequests: 2, scanned: 2, open: 1, blocking: 1 },
  all: false,
  redactedSecrets: 0,
  scanningOff: false,
}

describe('formatTaskScans', () => {
  it('prints the task header, then both PRs with their scans, findings and ruled history', () => {
    const out = formatTaskScans(TWO_PRS, { width: 200 })
    expect(out).toContain('LUM-1189 · security scans')
    expect(out).toMatch(/PRs:\s+2 linked · 2 scanned/)
    expect(out).toMatch(
      /Findings:\s+1 open · 1 blocks DONE \(latest scan of each PR\)/
    )
    // Both PRs, newest first, each through the `pr scan` printer.
    expect(out.indexOf('PR #1501')).toBeGreaterThan(-1)
    expect(out.indexOf('PR #1500')).toBeGreaterThan(out.indexOf('PR #1501'))
    // Already-ruled history.
    expect(out).toContain('ACCEPTED_RISK · human · "internal only"')
    // Call chain, verifier, AI suggestion with its reason.
    expect(out).toMatch(/Call chain:\s+2 edges/)
    expect(out).toContain('1. GET /api/x → svc.read')
    expect(out).toContain('2. svc.read → db.raw')
    expect(out).toContain('CONFIRMED — "reachable from the route"')
    expect(out).toContain('FALSE_POSITIVE — "input is a constant"')
    // Untrusted text never reaches the terminal with control characters.
    expect(out).not.toContain('\u001b')
    expect(out).not.toContain('\u0007')
  })

  it('reuses formatPrScan verbatim for each PR block (no forked renderer)', () => {
    const out = formatTaskScans(TWO_PRS, { width: 120 })
    for (const pr of TWO_PRS.pullRequests)
      expect(out).toContain(formatPrScan(pr, { width: 120 }).trimEnd())
  })

  it('says a task with no linked PR was not scanned, never clean', () => {
    const out = formatTaskScans({
      ...TWO_PRS,
      pullRequests: [],
      totals: { pullRequests: 0, scanned: 0, open: 0, blocking: 0 },
    })
    expect(out).toContain('No PR is linked to LUM-1189')
    expect(out).toContain('could not be confirmed clean')
    expect(out).not.toContain('PR #')
  })
})

describe('callChainLines / isTaskScansPayload', () => {
  it('numbers each edge and strips control characters', () => {
    expect(
      callChainLines([
        { from: 'a', to: 'b\u001b' },
        { from: 'b', to: 'c' },
      ])
    ).toEqual(['        1. a → b', '        2. b → c'])
    expect(callChainLines([])).toEqual([])
  })

  it('tells the task read-out from an older server’s panel model', () => {
    expect(isTaskScansPayload(TWO_PRS)).toBe(true)
    expect(isTaskScansPayload({ prs: [], blocking: { count: 0 } })).toBe(false)
    expect(isTaskScansPayload(null)).toBe(false)
  })
})

describe('taskScans', () => {
  const original = global.fetch
  const originalError = console.error
  let written = ''
  let writeSpy: jest.SpyInstance
  beforeEach(() => {
    written = ''
    console.error = jest.fn()
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written += String(chunk)
        return true
      })
  })
  afterEach(() => {
    global.fetch = original
    console.error = originalError
    writeSpy.mockRestore()
  })

  function respond(status: number, body: unknown, type = 'application/json') {
    return jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => type },
      json: async () => body,
    })
  }

  it('reads the read-out view of the task route with the bearer token', async () => {
    const fetchMock = respond(200, TWO_PRS)
    global.fetch = fetchMock
    expect(await taskScans('LUM-1189', { all: true })).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://lumo.test/api/tasks/LUM-1189/security-scans?view=readout&all=1',
      { headers: { Authorization: 'Bearer lum_test' } }
    )
    expect(written).toContain('LUM-1189 · security scans')
    expect(written).toContain('PR #1500')
  })

  it('--json prints the versioned payload as-is', async () => {
    global.fetch = respond(200, TWO_PRS)
    await taskScans('LUM-1189', { json: true })
    expect(JSON.parse(written)).toEqual(TWO_PRS)
  })

  it('a 404, an older server and a missing plugin each fail with exit 1', async () => {
    global.fetch = respond(404, { error: 'Task not found' })
    expect(await taskScans('LUM-9')).toBe(1)
    expect(console.error).toHaveBeenCalledWith(
      'Error: task LUM-9 not found in workspace lumo'
    )

    global.fetch = respond(200, { prs: [], blocking: { count: 0 } })
    expect(await taskScans('LUM-9')).toBe(1)

    global.fetch = respond(404, '<html>', 'text/html')
    expect(await taskScans('LUM-9')).toBe(1)
    expect(console.error).toHaveBeenLastCalledWith(
      expect.stringContaining('the security plugin is not installed')
    )

    expect(await taskScans('')).toBe(1)
  })
})
