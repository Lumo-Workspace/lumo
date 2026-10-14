/** @jest-environment node */
/**
 * LUM-780: `lumo task status` says WHY an advisory crossing no longer blocks
 * when a SYSTEM re-judge produced it — the evidence line rides after the
 * advisory marker. Against an older server (no `rejudge` field) the line is
 * exactly what it was before.
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
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'
import {
  fetchOpenCrossings,
  type OpenCrossing,
} from '@/cli/src/lib/open-crossings'

const PAYLOAD: TaskStatusResponse = {
  version: 1,
  task: { id: 't-1', identifier: 'LUM-9', title: 'x', status: 'IN_PROGRESS' },
  currentRound: 0,
  maxRounds: 3,
  escalated: false,
  criteria: [],
  history: [],
  nextActions: [],
  lastRoundFailures: [],
} as unknown as TaskStatusResponse

const attribution = {
  workspaceMemberId: null,
  sessionId: null,
  agent: null,
  worktreeBranch: null,
  model: null,
}

const EVIDENCE =
  'rule text is still in the current CLAUDE.md/AGENTS.md source: "Never delete files in prisma/migrations/"'

const rejudged: OpenCrossing = {
  id: 'bx-rejudged',
  ref: 'bx-rejudged',
  category: 'POLICY_WEAKENING',
  severity: 'MEDIUM',
  detail:
    'The policy compiler stopped treating this rule as deterministic+blocking',
  attribution,
  advisory: true,
  blocking: false,
  rejudge: EVIDENCE,
}
const plainAdvisory: OpenCrossing = {
  ...rejudged,
  id: 'bx-plain',
  category: 'HARDCODED_SECRET',
  severity: 'LOW',
  detail: 'AWS access key ID in docs/x.md (placeholder value)',
  rejudge: null,
}
const blocking: OpenCrossing = {
  ...rejudged,
  id: 'bx-block',
  category: 'TEST_FILE_DELETED',
  detail: 'rm __tests__/gone.test.ts',
  advisory: false,
  blocking: true,
  rejudge: null,
}

describe('task status — re-judged advisory rows (LUM-780)', () => {
  it('prints the re-judge evidence after the advisory marker, and nothing extra on other rows', () => {
    const out = formatTaskStatus(PAYLOAD, {
      openCrossings: {
        status: 'ok',
        gateEnabled: true,
        crossings: [blocking, rejudged, plainAdvisory],
      },
    })
    // LUM-1091: one item per crossing — the gate in parentheses on the
    // bullet line, the re-judge evidence as its own labelled row under it.
    const item = (cat: string) => {
      const tail = out.split(cat)[1]!
      return cat + tail.split('\n  • ')[0]!.split('\n  Disposition')[0]!
    }
    const rejudgedItem = item('POLICY_WEAKENING')
    expect(rejudgedItem).toContain(
      'POLICY_WEAKENING (advisory — does not block DONE)\n'
    )
    expect(rejudgedItem.replace(/\s+/g, ' ')).toContain(
      `Re-judged: ${EVIDENCE}`
    )
    const plainItem = item('HARDCODED_SECRET')
    expect(plainItem).toContain('(advisory — does not block DONE)')
    expect(plainItem).not.toContain('Re-judged')
    const blockingItem = item('TEST_FILE_DELETED')
    expect(blockingItem).toContain('TEST_FILE_DELETED (blocks DONE)')
    expect(blockingItem).not.toContain('Re-judged')
    // a single bullet glyph for every row
    expect(out).not.toContain('◦')
    expect(out).toContain(
      'Open boundary crossings (3 undispositioned: 1 blocking DONE, 2 advisory / non-blocking)'
    )
  })
})

describe('fetchOpenCrossings — the rejudge field (LUM-780)', () => {
  afterEach(() => jest.restoreAllMocks())

  function jsonResponse(body: unknown): Response {
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response
  }

  it('reads the evidence off the server trail; a missing / malformed trail reads as null', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        gateEnabled: true,
        crossings: [
          {
            id: 'a',
            category: 'POLICY_WEAKENING',
            severity: 'MEDIUM',
            detail: 'd',
            disposition: null,
            advisory: true,
            rejudge: { reason: 'RULE_TEXT_PRESENT', evidence: EVIDENCE },
          },
          {
            id: 'b',
            category: 'HARDCODED_SECRET',
            severity: 'LOW',
            detail: 'd',
            disposition: null,
            advisory: true,
            // older server — no field at all
          },
          {
            id: 'c',
            category: 'HARDCODED_SECRET',
            severity: 'LOW',
            detail: 'd',
            disposition: null,
            advisory: true,
            rejudge: { evidence: 42 },
          },
        ],
      })
    )
    const result = await fetchOpenCrossings(
      'https://api.test',
      'lum_x',
      'LUM-9'
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('expected ok')
    const byId = (id: string) => result.crossings.find(c => c.id === id)!
    expect(byId('a').rejudge).toBe(EVIDENCE)
    expect(byId('b').rejudge).toBeNull()
    expect(byId('c').rejudge).toBeNull()
  })
})
