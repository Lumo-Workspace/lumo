/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))

import {
  taskStatus,
  formatTaskStatus,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'
import { readCredentials } from '@/cli/src/lib/config'

const mockCreds = readCredentials as jest.Mock

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const PAYLOAD: TaskStatusResponse = {
  version: 1,
  task: {
    id: 't-1',
    identifier: 'LUM-9',
    title: 'do the thing',
    status: 'IN_PROGRESS',
  },
  currentRound: 1,
  maxRounds: 3,
  escalated: false,
  criteria: [
    {
      id: 'c-1',
      statement: 'route rejects bad input',
      verifierType: 'MACHINE',
      checkpointer: 'npx jest x.test.ts',
      evidenceRequired: false,
      source: 'AGENT_DRAFT',
      addedAtRound: 0,
      verdictStale: false,
      checkMismatch: false,
      latestVerdict: {
        round: 1,
        verdict: 'FAIL',
        evidencePointer: 'cmd:npx jest x.test.ts#exit=1',
        rejectionReason: '3 tests failed',
        rejectionReasonEnum: 'CRITERION_UNMET',
        recordedAt: '2026-06-02T10:00:00.000Z',
      },
    },
    {
      id: 'c-2',
      statement: 'gap found during review',
      verifierType: 'MACHINE',
      checkpointer: 'npx jest gap.test.ts',
      evidenceRequired: false,
      source: 'REVIEW_ADDED',
      addedAtRound: 1,
      verdictStale: false,
      checkMismatch: false,
      latestVerdict: null,
    },
    {
      id: 'c-3',
      statement: 'copy reads well',
      verifierType: 'HUMAN',
      checkpointer: null,
      evidenceRequired: false,
      source: 'AGENT_DRAFT',
      addedAtRound: 0,
      verdictStale: false,
      checkMismatch: false,
      latestVerdict: {
        round: 1,
        verdict: 'PASS',
        evidencePointer: 'file:app/page.tsx:1',
        rejectionReason: null,
        rejectionReasonEnum: null,
        recordedAt: '2026-06-02T10:00:01.000Z',
      },
    },
  ],
  verificationHistory: [
    { round: 1, recordedAt: '2026-06-02T10:00:00.000Z', passed: 1, failed: 1 },
  ],
  lastRoundFailures: [
    {
      criterionId: 'c-1',
      statement: 'route rejects bad input',
      rejectionReason: '3 tests failed',
      rejectionReasonEnum: 'CRITERION_UNMET',
    },
  ],
  nextActions: [
    {
      criterionId: 'c-1',
      statement: 'route rejects bad input',
      verifierType: 'MACHINE',
      checkpointer: 'npx jest x.test.ts',
      source: 'AGENT_DRAFT',
      addedAtRound: 0,
      rejectionReason: '3 tests failed',
    },
    {
      criterionId: 'c-2',
      statement: 'gap found during review',
      verifierType: 'MACHINE',
      checkpointer: 'npx jest gap.test.ts',
      source: 'REVIEW_ADDED',
      addedAtRound: 1,
      rejectionReason: null,
    },
  ],
}

let writeSpy: jest.SpyInstance
let errSpy: jest.SpyInstance
const OLD_SESSION = process.env.CLAUDE_CODE_SESSION_ID

beforeEach(() => {
  jest.clearAllMocks()
  mockCreds.mockReturnValue({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })
  delete process.env.CLAUDE_CODE_SESSION_ID
  writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  writeSpy.mockRestore()
  errSpy.mockRestore()
  if (OLD_SESSION === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = OLD_SESSION
})

function stdout(): string {
  return writeSpy.mock.calls.map(c => c[0]).join('')
}
function stderr(): string {
  return errSpy.mock.calls.map(c => c.join(' ')).join('\n')
}

describe('taskStatus — task resolution', () => {
  it('errors when not logged in', async () => {
    mockCreds.mockReturnValue(null)
    expect(await taskStatus('LUM-9')).toBe(1)
    expect(stderr()).toContain('not logged in')
  })

  it('errors with guidance when no task given and no session env', async () => {
    expect(await taskStatus(undefined)).toBe(1)
    expect(stderr()).toContain('lumo task status <LUM-N>')
    expect(stderr()).toContain('lumo session attach')
  })

  it('resolves the session-bound task when no identifier is given', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async url => {
        const u = String(url)
        if (u.includes('/api/sessions/'))
          return jsonResponse(200, { taskIdentifier: 'LUM-9' })
        return jsonResponse(200, PAYLOAD)
      })
    expect(await taskStatus(undefined)).toBeUndefined()
    expect(
      fetchSpy.mock.calls.some(c =>
        String(c[0]).includes('/api/tasks/LUM-9/status')
      )
    ).toBe(true)
  })

  it('errors with guidance when the session is unbound', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, { taskIdentifier: null }))
    expect(await taskStatus(undefined)).toBe(1)
    expect(stderr()).toContain('not bound')
    expect(stderr()).toContain('lumo session attach')
  })

  it('an explicit identifier overrides the session binding', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, PAYLOAD))
    expect(await taskStatus('LUM-7')).toBeUndefined()
    // The status fetch targets the explicit id; the session-binding endpoint
    // is never consulted. (A second read — open boundary crossings — also
    // fires; we only assert the binding was bypassed.)
    expect(String(fetchSpy.mock.calls[0]![0])).toContain(
      '/api/tasks/LUM-7/status'
    )
    expect(
      fetchSpy.mock.calls.some(c => String(c[0]).includes('/api/sessions/'))
    ).toBe(false)
  })

  it('surfaces a 404 with the workspace slug', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(404, {}))
    expect(await taskStatus('LUM-404')).toBe(1)
    expect(stderr()).toContain('not found in workspace lumo')
  })
})

describe('taskStatus — output', () => {
  it('--json emits the versioned payload verbatim', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, PAYLOAD))
    expect(await taskStatus('LUM-9', { json: true })).toBeUndefined()
    const parsed = JSON.parse(stdout())
    expect(parsed.version).toBe(1)
    expect(parsed.currentRound).toBe(1)
    expect(parsed.criteria).toHaveLength(3)
    expect(parsed.verificationHistory).toHaveLength(1)
    expect(parsed.nextActions).toHaveLength(2)
  })

  it('human output shows verdicts, history, failures, and next actions', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, PAYLOAD))
    expect(await taskStatus('LUM-9')).toBeUndefined()
    const out = stdout()
    expect(out).toContain('LUM-9  do the thing')
    expect(out).toContain('verification round 1/3')
    expect(out).toContain('✗ FAIL@r1 — 3 tests failed')
    expect(out).toContain('✓ PASS@r1')
    expect(out).toContain('(no verdict yet)')
    expect(out).toContain('r1 · 2026-06-02T10:00:00.000Z · 1 PASS / 1 FAIL')
    expect(out).toContain('Last round (r1) failures:')
    expect(out).toContain('Next actions (2 unmet):')
    expect(out).toContain('check: npx jest x.test.ts')
    expect(out).toContain('lumo verify')
  })

  it('REVIEW_ADDED criteria are explicitly marked in the rendered rows', () => {
    const out = formatTaskStatus(PAYLOAD)
    const reviewRow = out
      .split('\n')
      .find(l => l.includes('gap found during review'))!
    expect(reviewRow).toContain('REVIEW_ADDED@r1')
  })

  it('escalated payload prints the stop warning', () => {
    const out = formatTaskStatus({
      ...PAYLOAD,
      currentRound: 3,
      escalated: true,
    })
    expect(out).toContain('Escalated')
    expect(out).toContain('human')
  })

  it('empty contract points at criteria drafting', () => {
    const out = formatTaskStatus({
      ...PAYLOAD,
      criteria: [],
      verificationHistory: [],
      lastRoundFailures: [],
      nextActions: [],
      currentRound: 0,
    })
    expect(out).toContain('No acceptance criteria')
    expect(out).toContain('lumo task criteria set LUM-9')
  })

  it('all-met contract hands off to human adjudication', () => {
    const met = PAYLOAD.criteria.map(c => ({
      ...c,
      latestVerdict: {
        round: 1,
        verdict: 'PASS' as const,
        evidencePointer: null,
        rejectionReason: null,
        rejectionReasonEnum: null,
        recordedAt: '2026-06-02T10:00:00.000Z',
      },
    }))
    const out = formatTaskStatus({
      ...PAYLOAD,
      criteria: met,
      lastRoundFailures: [],
      nextActions: [],
    })
    expect(out).toContain('awaiting human adjudication')
  })

  it('strips ANSI from server-provided free text in human output', () => {
    const out = formatTaskStatus({
      ...PAYLOAD,
      criteria: [
        {
          ...PAYLOAD.criteria[0]!,
          statement: 'evil \x1b[31mred\x1b[0m statement',
        },
      ],
    })
    expect(out).not.toContain('\x1b')
    expect(out).toContain('red')
  })
})

// ── LUM-448: open boundary crossings surfaced in the terminal ──────────────
import fs from 'fs'
import path from 'path'

/** A boundary-crossings GET body (LUM-435 read model), trimmed to the few
 *  fields the terminal reads. `disposition: null` ⇒ open. */
const CROSSINGS_BODY = {
  crossings: [
    {
      id: 'bx-low',
      category: 'INFRA_TERMINATION',
      severity: 'LOW',
      detail: 'ran kill on a stray dev process',
      disposition: null,
    },
    {
      id: 'bx-high',
      category: 'TEST_TAMPERING',
      severity: 'HIGH',
      detail: 'weakened assertion in checkpointer test\nsecond line ignored',
      disposition: null,
    },
    {
      id: 'bx-closed',
      category: 'HARDCODED_SECRET',
      severity: 'HIGH',
      detail: 'already reviewed',
      disposition: 'FALSE_POSITIVE',
    },
  ],
}

/** Route fetch by URL: the status endpoint vs. the boundary-crossings endpoint. */
function routedFetch(crossingsBody: unknown = CROSSINGS_BODY) {
  return jest.spyOn(global, 'fetch').mockImplementation(async url => {
    const u = String(url)
    if (u.includes('/boundary-crossings'))
      return jsonResponse(200, crossingsBody)
    return jsonResponse(200, PAYLOAD)
  })
}

describe('taskStatus — open boundary crossings (LUM-448)', () => {
  it('task status surfaces open boundary crossings with severity', async () => {
    routedFetch()
    expect(await taskStatus('LUM-9')).toBeUndefined()
    const out = stdout()
    // Count of OPEN (undispositioned) crossings — the dispositioned one is excluded.
    expect(out).toContain('Open boundary crossings (2 undispositioned)')
    // Each open crossing shows its severity + category; highest severity first.
    expect(out).toContain('[HIGH] TEST_TAMPERING')
    expect(out).toContain('[LOW] INFRA_TERMINATION')
    expect(out.indexOf('[HIGH]')).toBeLessThan(out.indexOf('[LOW]'))
    // Only the first line of a multi-line detail is surfaced.
    expect(out).not.toContain('second line ignored')
    // The dispositioned crossing never appears.
    expect(out).not.toContain('HARDCODED_SECRET')
    // Points at the human-only web disposition panel (no CLI clear path).
    expect(out).toContain('#boundary-crossings')

    // --json carries the same open crossings structurally, with severity.
    writeSpy.mock.calls.length = 0
    routedFetch()
    expect(await taskStatus('LUM-9', { json: true })).toBeUndefined()
    const parsed = JSON.parse(stdout())
    expect(Array.isArray(parsed.openCrossings)).toBe(true)
    expect(parsed.openCrossings).toHaveLength(2)
    expect(
      parsed.openCrossings.map((c: { severity: string }) => c.severity)
    ).toEqual(['HIGH', 'LOW'])
    expect(parsed.openCrossings[0].category).toBe('TEST_TAMPERING')
  })

  it('omits the crossings block when none are open', async () => {
    routedFetch({ crossings: [] })
    expect(await taskStatus('LUM-9')).toBeUndefined()
    expect(stdout()).not.toContain('Open boundary crossings')
  })

  it('CLI exposes crossings read-only with no disposition write path', () => {
    // Structural guard: nothing under cli/src may invoke a crossing WRITE path
    // (disposition / remediation), and the crossings reader must never use a
    // mutating HTTP method. Disposition stays web + human-only (LUM-426/435/422)
    // — an agent/CLI bearer cannot clear its own crossing from the terminal.
    const cliSrc = path.resolve(__dirname, '../../cli/src')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts')) files.push(full)
      }
    }
    walk(cliSrc)
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      // No CLI code references the disposition/remediation write endpoints.
      expect(src).not.toMatch(
        /boundary-crossings\/[A-Za-z0-9._${}/-]*disposition/
      )
      expect(src).not.toMatch(
        /boundary-crossings\/[A-Za-z0-9._${}/-]*remediation/
      )
    }

    // The single place the CLI touches crossings only ever GETs them.
    const reader = fs.readFileSync(
      path.resolve(cliSrc, 'lib/open-crossings.ts'),
      'utf8'
    )
    expect(reader).toContain('/boundary-crossings')
    expect(reader).not.toMatch(/method:\s*['"`](POST|PUT|PATCH|DELETE)/)
  })
})
