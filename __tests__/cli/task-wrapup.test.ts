/**
 * @jest-environment node
 *
 * LUM-841: `lumo task wrapup [task]` — the whole wrap-up in one read.
 * Sections come out in wrap-up order; crossings are rendered ready to relay;
 * the command only ever GETs and never supplies a step flag or receipt; any
 * failed read keeps the readiness verdict from reading as ready.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

const planMock = jest.fn()
jest.mock('@/cli/src/lib/worktree-cleanup', () => {
  const actual = jest.requireActual('@/cli/src/lib/worktree-cleanup')
  return {
    ...actual,
    planTaskWorktreeCleanup: (...args: unknown[]) => planMock(...args),
  }
})

import {
  assessReadiness,
  formatWrapup,
  taskWrapup,
  type WrapupInput,
} from '@/cli/src/commands/task-wrapup'
import type { TaskStatusResponse } from '@/cli/src/commands/task-status'
import type { OpenCrossing } from '@/cli/src/lib/open-crossings'

/** The approval flag itself — not the `--confirmed` ruling value. */
const CONFIRM_FLAG = /--confirm(?![-\w])/

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

type Criterion = TaskStatusResponse['criteria'][number]

function criterion(over: Partial<Criterion> = {}): Criterion {
  return {
    id: 'crit-1',
    statement: 'wrapup prints every section',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest x',
    evidenceRequired: false,
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    verdictStale: false,
    checkMismatch: false,
    machinePassed: true,
    latestVerdict: {
      round: 1,
      verdict: 'PASS',
      evidencePointer: null,
      rejectionReason: null,
      rejectionReasonEnum: null,
      recordedAt: '2026-09-25T00:00:00.000Z',
    },
    confirmedAt: '2026-09-25T00:00:00.000Z',
    ...over,
  }
}

function statusData(
  over: Partial<TaskStatusResponse> = {}
): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't1',
      identifier: 'LUM-9001',
      title: 'Wrap me up',
      status: 'IN_REVIEW',
    },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [criterion()],
    machineVerification: { total: 1, machineVerified: 1, humanOverridden: 0 },
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    securityFindings: {
      open: 0,
      blocking: 0,
      unconfirmedPrs: [],
      scans: [
        {
          prNumber: 77,
          status: 'CLEAN',
          stages: { secrets: 'DONE' },
          partial: false,
          error: null,
          externalFindings: 0,
          openFindings: 0,
        },
      ],
    },
    ...over,
  } as TaskStatusResponse
}

function crossing(over: Partial<OpenCrossing> = {}): OpenCrossing {
  return {
    id: 'cx-1',
    category: 'TEST_FILE_DELETED',
    severity: 'MEDIUM',
    detail: 'deleted __tests__/old.test.ts',
    attribution: {
      workspaceMemberId: null,
      sessionId: null,
      agent: null,
      worktreeBranch: null,
      model: null,
    },
    advisory: false,
    blocking: true,
    rejudge: null,
    occurrenceCount: 2,
    reversible: false,
    explanations: ['the helper it covered was removed'],
    ...over,
  }
}

function input(over: Partial<WrapupInput> = {}): WrapupInput {
  return {
    identifier: 'LUM-9001',
    status: { ok: true, value: statusData() },
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
    crossings: { status: 'ok', crossings: [], gateEnabled: true },
    worktrees: {
      mainRoot: '/repo',
      items: [
        {
          path: '/repo/.worktrees/LUM-9001-x',
          branch: 'lumo/LUM-9001-x',
          removable: true,
        },
      ],
    },
    dispositionUrl:
      'https://api.lumo.test/workspace/lumo/my-tasks/LUM-9001#boundary-crossings',
    ...over,
  }
}

describe('lumo task wrapup (LUM-841)', () => {
  test('wrapup renders every section in wrap-up order', () => {
    const out = formatWrapup(
      input({
        status: {
          ok: true,
          value: statusData({
            criteria: [
              criterion(),
              criterion({
                id: 'crit-2',
                statement: 'second criterion',
                latestVerdict: null,
                machinePassed: false,
              }),
            ],
            nextActions: [
              {
                kind: 'CRITERION',
                criterionId: 'crit-2',
                statement: 'second criterion',
                verifierType: 'MACHINE',
                checkpointer: 'npx jest y',
                judgeSteps: null,
                source: 'AGENT_DRAFT',
                addedAtRound: 0,
                rejectionReason: null,
              },
              {
                kind: 'TEST_CASE_VERDICT',
                signal: 'UNPROVEN_PASS',
                number: 3,
                title: 'manual smoke',
                ceilingReason: 'no-evidence',
                advisory: true,
              },
            ],
          }),
        },
        crossings: {
          status: 'ok',
          crossings: [crossing()],
          gateEnabled: true,
        },
      })
    )
    const order = [
      '[1/5] Contract & verification',
      '[2/5] Test cases',
      '[3/5] Security scans',
      '[4/5] Boundary crossings',
      '[5/5] DONE',
    ].map(h => out.indexOf(h))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)

    // verification: round, unmet criterion, the verify next step
    expect(out).toContain('Criteria: 2 total, 1 unmet · round 1/3')
    expect(out).toContain('○ crit-2  [MACHINE]  second criterion')
    expect(out).toContain('run `lumo verify LUM-9001` (2 rounds left)')
    // test-case signal
    expect(out).toContain('TC3 manual smoke')
    // PR scan state
    expect(out).toContain('PR #77 · scan CLEAN')
    // crossings
    expect(out).toContain('cx-1  [MEDIUM] TEST_FILE_DELETED (blocks DONE)')
    // DONE readiness + envelope preview: PR merge state and worktree cleanup
    expect(out).toContain('Readiness: BLOCKED')
    expect(out).toContain('#77  merged ')
    expect(out).toContain('Will remove worktree /repo/.worktrees/LUM-9001-x')
  })

  test('wrapup renders crossings ready to relay', () => {
    const out = formatWrapup(
      input({
        crossings: {
          status: 'ok',
          gateEnabled: true,
          crossings: [
            crossing(),
            crossing({
              id: 'cx-2',
              severity: 'LOW',
              category: 'PROJECT_RULE_VIOLATION',
              detail: 'console.log in a script',
              advisory: true,
              blocking: false,
              occurrenceCount: 1,
              reversible: true,
              explanations: [],
            }),
          ],
        },
      })
    )
    expect(out).toContain('2 undispositioned: 1 blocking DONE, 1 advisory')
    // everything the user needs to rule on the blocking row
    expect(out).toContain('detail: deleted __tests__/old.test.ts')
    expect(out).toContain('seen ×2 while open')
    expect(out).toContain('irreversible category')
    expect(out).toContain('agent explanations (1, self-report · unverified):')
    expect(out).toContain('- the helper it covered was removed')
    // the advisory row says so, and is covered by the batch commands
    expect(out).toContain(
      'cx-2  [LOW] PROJECT_RULE_VIOLATION (advisory — does not block DONE)'
    )
    expect(out).toContain('Web panel: https://api.lumo.test/workspace/lumo')
  })

  test('wrapup offers one batch disposition command per ruling for several crossings (LUM-845)', () => {
    const out = formatWrapup(
      input({
        crossings: {
          status: 'ok',
          gateEnabled: true,
          crossings: [
            crossing(),
            crossing({ id: 'cx-2', explanations: [] }),
            crossing({ id: 'cx-3', advisory: true, blocking: false }),
          ],
        },
      })
    )
    expect(out).toContain(
      'lumo crossing disposition cx-1 cx-2 cx-3 --false-positive --task LUM-9001'
    )
    expect(out).toContain(
      'lumo crossing disposition cx-1 cx-2 cx-3 --confirmed --task LUM-9001'
    )
    // no per-crossing ruling commands alongside the batch ones
    expect(out).not.toContain('lumo crossing disposition cx-1 --')
    expect(out).not.toContain('lumo crossing disposition cx-2 --')
    expect(out.match(/lumo crossing disposition /g)).toHaveLength(2)
    expect(out).toContain('leave out any id they want to keep OPEN')
  })

  test('wrapup keeps the per-crossing command when there is a single crossing', () => {
    const out = formatWrapup(
      input({
        crossings: {
          status: 'ok',
          gateEnabled: true,
          crossings: [crossing()],
        },
      })
    )
    expect(out).toContain(
      'lumo crossing disposition cx-1 --false-positive --task LUM-9001  |  lumo crossing disposition cx-1 --confirmed --task LUM-9001'
    )
  })

  describe('network', () => {
    let fetchMock: jest.Mock
    let stdout: string[]
    beforeEach(() => {
      stdout = []
      jest
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          stdout.push(String(chunk))
          return true
        })
      jest.spyOn(console, 'error').mockImplementation(() => {})
      planMock.mockReset()
      planMock.mockReturnValue({ mainRoot: '/repo', items: [] })
    })
    afterEach(() => {
      jest.restoreAllMocks()
    })

    function route(overrides: Record<string, unknown> = {}) {
      fetchMock = jest.fn(async (url: string) => {
        for (const [frag, res] of Object.entries(overrides)) {
          if (url.includes(frag)) {
            if (res instanceof Error) throw res
            return res
          }
        }
        if (url.endsWith('/status')) return jsonResponse(200, statusData())
        if (url.includes('/by-identifier/'))
          return jsonResponse(200, {
            task: {
              identifier: 'LUM-9001',
              title: 'Wrap me up',
              status: 'IN_REVIEW',
              pullRequests: [
                {
                  number: 77,
                  title: 'feat',
                  url: null,
                  state: 'merged',
                  headSha: 'abc',
                },
              ],
            },
          })
        if (url.endsWith('/boundary-crossings'))
          return jsonResponse(200, {
            gateEnabled: true,
            crossings: [
              {
                id: 'cx-1',
                category: 'TEST_FILE_DELETED',
                severity: 'MEDIUM',
                detail: 'deleted a test',
                disposition: null,
                occurrenceCount: 1,
                reversible: true,
                explanations: [],
              },
            ],
          })
        return jsonResponse(404, {})
      })
      global.fetch = fetchMock as unknown as typeof fetch
    }

    test('wrapup is read-only and never self-approves', async () => {
      route()
      const code = await taskWrapup('LUM-9001')
      expect(code).toBeUndefined()
      // every request is a plain GET — no verify round, no receipt, no PATCH
      expect(fetchMock).toHaveBeenCalled()
      for (const [url, init] of fetchMock.mock.calls) {
        expect((init as RequestInit | undefined)?.method ?? 'GET').toBe('GET')
        expect(String(url)).not.toContain('/receipt')
        expect(String(url)).not.toContain('/verify')
      }
      const out = stdout.join('')
      expect(out).not.toContain('--confirm-read')
      expect(out).not.toContain('--receipt')
      // blocked by the crossing → no approval command at all
      expect(out).toContain('Readiness: BLOCKED')
      expect(out).not.toMatch(CONFIRM_FLAG)

      // once nothing is left, the only --confirm is the DONE confirmCommand,
      // printed as the user's approval
      stdout = []
      route({
        '/boundary-crossings': jsonResponse(200, {
          gateEnabled: true,
          crossings: [],
        }),
      })
      await taskWrapup('LUM-9001')
      const ready = stdout.join('')
      expect(ready).toContain('Readiness: READY')
      const confirms = ready.split('\n').filter(l => CONFIRM_FLAG.test(l))
      expect(confirms).toEqual([
        '  Show the user the lines above. Only after they approve, run: lumo task update LUM-9001 --status done --confirm',
      ])
    })

    test('wrapup fails closed when a read fails', async () => {
      const cases: Array<[string, Record<string, unknown>]> = [
        ['status', { '/status': jsonResponse(500, {}) }],
        ['crossings', { '/boundary-crossings': new Error('socket hang up') }],
        ['task', { '/by-identifier/': jsonResponse(503, {}) }],
      ]
      for (const [name, override] of cases) {
        stdout = []
        route({
          ...override,
          // no crossings otherwise, so only the failed read can hold READY
          ...(name === 'crossings'
            ? {}
            : {
                '/boundary-crossings': jsonResponse(200, {
                  gateEnabled: true,
                  crossings: [],
                }),
              }),
        })
        await taskWrapup('LUM-9001')
        const out = stdout.join('')
        expect(out).toContain('Readiness: CANNOT CONFIRM')
        expect(out).not.toContain('Readiness: READY')
        expect(out).not.toMatch(CONFIRM_FLAG)
        if (name === 'status')
          expect(out).toContain('Could not read the acceptance status')
        if (name === 'crossings')
          expect(out).toContain('Boundary-crossing check failed')
        if (name === 'task')
          expect(out).toContain('Could not read the task and its linked PRs')
      }
    })

    test('an unknown task is an error, not a report', async () => {
      route({ '/status': jsonResponse(404, {}) })
      const code = await taskWrapup('LUM-404')
      expect(code).toBe(1)
      expect(stdout.join('')).toBe('')
    })
  })

  describe('assessReadiness', () => {
    test('a send-back and a proven defect are BLOCKED', () => {
      const r = assessReadiness(
        input({
          status: {
            ok: true,
            value: statusData({
              criteria: [
                criterion({
                  latestVerdict: {
                    round: 2,
                    verdict: 'FAIL',
                    evidencePointer: null,
                    rejectionReason: 'no',
                    rejectionReasonEnum: null,
                    recordedAt: '',
                  },
                }),
              ],
              nextActions: [
                {
                  kind: 'TEST_CASE_VERDICT',
                  signal: 'PROVEN_DEFECT',
                  number: 1,
                  title: 'x',
                  advisory: true,
                },
              ],
            }),
          },
        })
      )
      expect(r.level).toBe('BLOCKED')
      expect(r.reasons.join('\n')).toMatch(/send-back/)
      expect(r.reasons.join('\n')).toMatch(/proven defect/)
    })

    test('an unmerged PR or a never-verified contract is NOT_YET', () => {
      const unverified = assessReadiness(
        input({
          status: { ok: true, value: statusData({ currentRound: 0 }) },
        })
      )
      expect(unverified.level).toBe('NOT_YET')
      expect(unverified.reasons).toContain('lumo verify has not run')

      const open = input()
      if (open.task.ok) open.task.value.pullRequests![0]!.state = 'open'
      const r = assessReadiness(open)
      expect(r.level).toBe('NOT_YET')
      expect(r.reasons.join('\n')).toContain('#77 open')
    })

    test('an advisory crossing does not hold READY', () => {
      const r = assessReadiness(
        input({
          crossings: {
            status: 'ok',
            gateEnabled: true,
            crossings: [crossing({ advisory: true, blocking: false })],
          },
        })
      )
      expect(r.level).toBe('READY')
    })

    test('a DONE task reads as DONE', () => {
      const done = input()
      if (done.task.ok) done.task.value.status = 'DONE'
      expect(assessReadiness(done).level).toBe('DONE')
    })
  })
})
