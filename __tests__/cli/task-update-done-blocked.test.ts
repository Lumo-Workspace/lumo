/**
 * @jest-environment node
 *
 * LUM-755: when `task update --status done --confirm` is refused by a server
 * DONE gate (send-back / boundary crossing / blocking security finding) the
 * CLI does not just echo the 409 text — it exits 5 with a structured
 * DONE_BLOCKED error on stdout: the message verbatim, a blockers[] assembled
 * from the task-status + boundary-crossings read models, and remediation
 * lines that point only at human-side or explain-only paths. There is no CLI
 * path to clear a blocker, and none is suggested.
 */
// LUM-825: DONE also cleans up the task's local git worktrees; these suites
// test the API flow, so never let it touch the real checkout's worktrees.
jest.mock('@/cli/src/lib/worktree-cleanup', () => ({
  ...jest.requireActual('@/cli/src/lib/worktree-cleanup'),
  planTaskWorktreeCleanup: jest.fn(() => null),
}))
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/tag-resolver', () => ({
  resolveTagRefs: jest.fn(async () => []),
}))

import { taskUpdate } from '@/cli/src/commands/task-update'
import {
  EXIT_BLOCKED,
  buildRemediation,
  isDoneGateRefusal,
} from '@/cli/src/lib/blocked-error'

type Route = (url: string, init?: RequestInit) => unknown

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

const CROSSING_MSG =
  'Cannot move this task to DONE — 1 undispositioned boundary-crossing (forbidden action taken during this task): 1 TEST_FILE_DELETED. A human must disposition it (false positive or confirmed) on the task timeline, or open the gate for this workspace.'
const SENDBACK_MSG =
  'Cannot move this task to DONE — 1 unresolved send-back on the acceptance contract:\n• Envelope is emitted\nResolve them (see `lumo task status`) and re-verify, or have a human override.'
const FINDING_MSG =
  'Cannot move this task to DONE — 1 undispositioned HIGH security finding (secrets.aws-key ×1). A human must mark each as false positive or accepted risk.'

const statusPayload = (opts: {
  failCriterion?: boolean
  finding?: boolean
}) => ({
  version: 1,
  task: { id: 't1', identifier: 'LUM-1', title: 'T', status: 'IN_REVIEW' },
  currentRound: 1,
  maxRounds: 3,
  escalated: false,
  criteria: [
    {
      id: 'crit-1',
      statement: 'Envelope is emitted',
      verifierType: 'MACHINE',
      checkpointer: 'npx jest x',
      evidenceRequired: false,
      judgeSteps: null,
      source: 'AGENT_DRAFT',
      addedAtRound: 0,
      verdictStale: false,
      checkMismatch: false,
      machinePassed: false,
      latestVerdict: opts.failCriterion
        ? {
            round: 1,
            verdict: 'FAIL',
            evidencePointer: null,
            rejectionReason: 'exit 1',
            rejectionReasonEnum: null,
            recordedAt: 'now',
          }
        : null,
    },
  ],
  machineVerification: { total: 1, machineVerified: 0, humanOverridden: 0 },
  verificationHistory: [],
  lastRoundFailures: [],
  nextActions: opts.finding
    ? [
        {
          kind: 'SECURITY_FINDING',
          findingId: 'f-1',
          statement: 'AWS key committed',
          severity: 'HIGH',
          provenance: 'DETERMINISTIC',
          blocking: true,
          prNumber: 958,
          ruleId: 'secrets.aws-key',
          filePath: 'lib/x.ts',
          line: 12,
        },
        {
          kind: 'SECURITY_FINDING',
          findingId: 'f-2',
          statement: 'advisory only',
          severity: 'LOW',
          provenance: 'LLM_JUDGE',
          blocking: false,
          prNumber: 958,
          ruleId: 'judge.style',
          filePath: 'lib/y.ts',
          line: null,
        },
      ]
    : [],
})

const crossingsPayload = {
  crossings: [
    {
      id: 'cx-1',
      category: 'TEST_FILE_DELETED',
      severity: 'MEDIUM',
      detail: 'deleted __tests__/cli/old.test.ts',
      disposition: null,
      attribution: null,
    },
    {
      id: 'cx-2',
      category: 'PUSH_TO_MAIN',
      severity: 'HIGH',
      detail: 'already dispositioned',
      disposition: 'FALSE_POSITIVE',
      attribution: null,
    },
  ],
}

let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

function setStdoutTTY(value: boolean) {
  Object.defineProperty(process.stdout, 'isTTY', {
    value,
    configurable: true,
    writable: true,
  })
}

function route(handler: Route) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    handler(String(url), init)
  )
}

const gateRoutes =
  (opts: {
    gateMsg: string
    status?: unknown
    crossings?: unknown
    crossingsStatus?: number
    statusStatus?: number
  }): Route =>
  (url, init) => {
    if (init?.method === 'PATCH') return jsonRes(409, { error: opts.gateMsg })
    if (url.endsWith('/api/tasks/LUM-1/status'))
      return jsonRes(opts.statusStatus ?? 200, opts.status ?? statusPayload({}))
    if (url.endsWith('/api/tasks/LUM-1/boundary-crossings'))
      return jsonRes(
        opts.crossingsStatus ?? 200,
        opts.crossings ?? { crossings: [] }
      )
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
  }

function blocked() {
  const parsed = JSON.parse(stdout.join('')) as {
    status: string
    code: string
    command: string
    task: string
    message: string
    blockers: Array<Record<string, unknown> & { kind: string }>
    unconfirmed: string[]
    remediation: string[]
    dispositionUrl: string
  }
  expect(parsed.status).toBe('blocked')
  expect(parsed.code).toBe('DONE_BLOCKED')
  expect(parsed.command).toBe('task update')
  expect(parsed.task).toBe('LUM-1')
  return parsed
}

beforeEach(() => {
  jest.clearAllMocks()
  stdout = []
  stderr = []
  setStdoutTTY(false)
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    stdout.push(String(s))
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((...a) => {
    stderr.push(a.join(' '))
  })
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
  if (stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutTTY)
  else delete (process.stdout as { isTTY?: boolean }).isTTY
})

describe('task update done blocked', () => {
  it('isDoneGateRefusal recognises the three gate messages and nothing else', () => {
    expect(isDoneGateRefusal(CROSSING_MSG)).toBe(true)
    expect(isDoneGateRefusal(SENDBACK_MSG)).toBe(true)
    expect(isDoneGateRefusal(FINDING_MSG)).toBe(true)
    expect(isDoneGateRefusal('Only the owner can delete a document')).toBe(
      false
    )
    expect(isDoneGateRefusal(null)).toBe(false)
  })

  it('boundary crossing: exit 5, JSON on stdout with the open crossing only, message verbatim, nothing on stderr', async () => {
    route(gateRoutes({ gateMsg: CROSSING_MSG, crossings: crossingsPayload }))
    const code = await taskUpdate('LUM-1', { status: 'done', confirm: true })
    expect(code).toBe(5)
    expect(EXIT_BLOCKED).toBe(5)
    const err = blocked()
    expect(err.message).toBe(CROSSING_MSG)
    expect(err.blockers).toEqual([
      {
        kind: 'BOUNDARY_CROSSING',
        id: 'cx-1',
        severity: 'MEDIUM',
        category: 'TEST_FILE_DELETED',
        detail: 'deleted __tests__/cli/old.test.ts',
      },
    ])
    expect(err.unconfirmed).toEqual([])
    expect(err.dispositionUrl).toBe(
      'https://api.lumo.test/workspace/lumo/my-tasks/LUM-1#boundary-crossings'
    )
    expect(err.remediation.join('\n')).toContain(
      'lumo crossing explain cx-1 --note'
    )
    // LUM-769: the user's CLI path is named, next to the web panel link.
    expect(err.remediation.join('\n')).toContain(
      'lumo crossing disposition cx-1 --false-positive'
    )
    expect(err.remediation.join('\n')).toContain(err.dispositionUrl)
    expect(stderr).toEqual([])
  })

  it('send-back + blocking security finding: both blocker kinds from the status read model; advisory findings excluded', async () => {
    route(
      gateRoutes({
        gateMsg: SENDBACK_MSG,
        status: statusPayload({ failCriterion: true, finding: true }),
      })
    )
    const code = await taskUpdate('LUM-1', { status: 'done', confirm: true })
    expect(code).toBe(5)
    const err = blocked()
    expect(err.blockers).toEqual([
      {
        kind: 'SEND_BACK',
        criterionId: 'crit-1',
        statement: 'Envelope is emitted',
        failedAtRound: 1,
        rejectionReason: 'exit 1',
      },
      {
        kind: 'SECURITY_FINDING',
        findingId: 'f-1',
        severity: 'HIGH',
        ruleId: 'secrets.aws-key',
        filePath: 'lib/x.ts',
        line: 12,
        prNumber: 958,
        statement: 'AWS key committed',
      },
    ])
    const text = err.remediation.join('\n')
    expect(text).toContain('lumo verify LUM-1')
    expect(text).toMatch(/false positive|accepted risk/)
    expect(text).not.toContain('crossing explain')
  })

  it('remediation never offers a CLI path that clears a blocker', () => {
    // LUM-769: a boundary crossing may name `lumo crossing disposition` — the
    // USER's exit-4 path, never a ready-to-run approval — while send-backs and
    // security findings still get no CLI clear path at all.
    const lines = buildRemediation(
      [
        {
          kind: 'SEND_BACK',
          criterionId: 'c',
          statement: 's',
          failedAtRound: 1,
          rejectionReason: null,
        },
        {
          kind: 'BOUNDARY_CROSSING',
          id: 'cx',
          severity: 'HIGH',
          category: 'X',
          detail: 'd',
        },
        {
          kind: 'SECURITY_FINDING',
          findingId: 'f',
          severity: 'HIGH',
          ruleId: 'r',
          filePath: 'p',
          line: null,
          prNumber: 1,
          statement: 's',
        },
      ],
      [],
      { identifier: 'LUM-1', dispositionUrl: 'https://x/#boundary-crossings' }
    )
    expect(lines.length).toBe(3)
    const allowed = [
      'lumo verify',
      'lumo crossing explain',
      'lumo crossing disposition',
      'lumo task status',
    ]
    for (const l of lines) {
      // No line hands the agent a ready-to-run approval flag.
      expect(l).not.toMatch(/--confirm\b|--force|--yes/)
      for (const m of l.match(/lumo [a-z]+(?: [a-z]+)?/g) ?? []) {
        expect(allowed.some(a => m.startsWith(a))).toBe(true)
      }
    }
    const byKind = Object.fromEntries(
      lines.map(l => [l.split(':')[0], l])
    ) as Record<string, string>
    expect(byKind.SEND_BACK).not.toContain('crossing disposition')
    expect(byKind.SECURITY_FINDING).not.toContain('lumo ')
    expect(byKind.BOUNDARY_CROSSING).toContain('never self-approve')
    expect(lines.join('\n')).toMatch(/human/i)
  })

  it('an enrichment read that fails is reported in unconfirmed[], not hidden', async () => {
    route(gateRoutes({ gateMsg: CROSSING_MSG, crossingsStatus: 500 }))
    const code = await taskUpdate('LUM-1', { status: 'done', confirm: true })
    expect(code).toBe(5)
    const err = blocked()
    expect(err.blockers).toEqual([])
    expect(err.unconfirmed.join('\n')).toMatch(/boundary-crossings.*HTTP 500/)
    expect(err.remediation.join('\n')).toMatch(/could not confirm/i)
  })

  it('a non-gate 409 keeps the plain exit-1 text on stderr', async () => {
    route((url, init) => {
      if (init?.method === 'PATCH')
        return jsonRes(409, { error: 'Only the owner can delete a document' })
      throw new Error(`unexpected ${url}`)
    })
    const code = await taskUpdate('LUM-1', { status: 'done', confirm: true })
    expect(code).toBe(1)
    expect(stdout.join('')).toBe('')
    expect(stderr.join('\n')).toContain('Only the owner can delete a document')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('TTY: the same error as readable text, still exit 5', async () => {
    setStdoutTTY(true)
    route(gateRoutes({ gateMsg: CROSSING_MSG, crossings: crossingsPayload }))
    const code = await taskUpdate('LUM-1', { status: 'done', confirm: true })
    expect(code).toBe(5)
    const out = stdout.join('')
    expect(() => JSON.parse(out)).toThrow()
    expect(out).toContain('DONE_BLOCKED')
    expect(out).toContain('[MEDIUM] TEST_FILE_DELETED')
    expect(out).toContain('cx-1')
    expect(out).toContain('#boundary-crossings')
  })
})
