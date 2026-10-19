/**
 * @jest-environment node
 *
 * LUM-841 → LUM-1233: DONE readiness. `lumo task wrapup` was removed; its
 * readiness verdict and DONE section now end `lumo task status` when the task
 * is READY. The read only ever GETs and never supplies a step flag or
 * receipt; any failed read keeps the verdict from reading as ready (and the
 * section away).
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
  type ReadinessInput,
} from '@/cli/src/lib/done-readiness'
import {
  taskStatus,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'
import type { OpenCrossing } from '@/cli/src/lib/open-crossings'

/** The approval flag itself — not the `--confirmed` ruling value. */
const CONFIRM_FLAG = /--confirm(?![-\w])/

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function statusData(
  over: Partial<TaskStatusResponse> = {}
): TaskStatusResponse {
  return {
    version: 2,
    task: {
      id: 't1',
      identifier: 'LUM-9001',
      title: 'Wrap me up',
      status: 'IN_REVIEW',
    },
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
    ref: over.id ?? 'cx-1',
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

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
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
    ...over,
  }
}

describe('DONE readiness (formerly lumo task wrapup)', () => {
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

    test('task status shows DONE readiness only when READY, and never self-approves', async () => {
      route()
      const code = await taskStatus('LUM-9001')
      expect(code).toBeUndefined()
      // every request is a plain GET — no receipt, no PATCH
      expect(fetchMock).toHaveBeenCalled()
      for (const [url, init] of fetchMock.mock.calls) {
        expect((init as RequestInit | undefined)?.method ?? 'GET').toBe('GET')
        expect(String(url)).not.toContain('/receipt')
        expect(String(url)).not.toContain('/verify')
      }
      const out = stdout.join('')
      expect(out).not.toContain('--confirm-read')
      expect(out).not.toContain('--receipt')
      // blocked by the crossing → no readiness section, no approval command
      expect(out).not.toContain('DONE readiness')
      expect(out).not.toMatch(CONFIRM_FLAG)

      // LUM-1106: once nothing is left and every linked PR is merged, DONE
      // is one step — the plain command, no --confirm anywhere
      stdout = []
      route({
        '/boundary-crossings': jsonResponse(200, {
          gateEnabled: true,
          crossings: [],
        }),
      })
      await taskStatus('LUM-9001')
      const ready = stdout.join('')
      expect(ready).toContain('\nDONE readiness\n')
      expect(ready).toContain('Readiness: READY — one step')
      expect(ready).not.toMatch(CONFIRM_FLAG)
      // LUM-1091: the command alone on its line, right under the instruction
      expect(ready).toContain(
        '  All PRs merged, nothing blocks DONE — run it as-is (status only), no approval step:\n    lumo task update LUM-9001 --status done\n'
      )

      // no linked PR: READY, but the DONE envelope still applies — the only
      // --confirm is its confirmCommand, printed as the user's approval
      stdout = []
      route({
        '/boundary-crossings': jsonResponse(200, {
          gateEnabled: true,
          crossings: [],
        }),
        '/by-identifier/': jsonResponse(200, {
          task: {
            identifier: 'LUM-9001',
            title: 'Wrap me up',
            status: 'IN_REVIEW',
            pullRequests: [],
          },
        }),
      })
      await taskStatus('LUM-9001')
      const noPr = stdout.join('')
      expect(noPr).toContain('Readiness: READY — relay the DONE envelope')
      const confirms = noPr.split('\n').filter(l => CONFIRM_FLAG.test(l))
      expect(confirms).toEqual([
        '    lumo task update LUM-9001 --status done --confirm',
      ])
      expect(noPr).toContain(
        '  Show the user the lines above. Only after they approve, run:\n    lumo task update LUM-9001 --status done --confirm\n'
      )
    })

    test('--json carries the readiness verdict and the next command', async () => {
      route({
        '/boundary-crossings': jsonResponse(200, {
          gateEnabled: true,
          crossings: [],
        }),
      })
      await taskStatus('LUM-9001', { json: true })
      const body = JSON.parse(stdout.join('')) as {
        readiness: { level: string; nextCommand: string | null }
      }
      expect(body.readiness.level).toBe('READY')
      expect(body.readiness.nextCommand).toBe(
        'lumo task update LUM-9001 --status done'
      )
    })

    test('a failed read keeps the readiness section away (fail closed)', async () => {
      const cases: Array<[string, Record<string, unknown>]> = [
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
        await taskStatus('LUM-9001')
        const out = stdout.join('')
        expect(out).not.toContain('DONE readiness')
        expect(out).not.toContain('Readiness: READY')
        expect(out).not.toMatch(CONFIRM_FLAG)
      }
    })

    test('an unknown task is an error, not a report', async () => {
      route({ '/status': jsonResponse(404, {}) })
      const code = await taskStatus('LUM-404')
      expect(code).toBe(1)
      expect(stdout.join('')).toBe('')
    })
  })

  describe('assessReadiness', () => {
    test('a proven defect is BLOCKED', () => {
      const r = assessReadiness(
        input({
          status: {
            ok: true,
            value: statusData({
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
      expect(r.reasons.join('\n')).toMatch(/proven defect/)
    })

    test('an unmerged PR is NOT_YET', () => {
      const open = input()
      if (open.task.ok) open.task.value.pullRequests![0]!.state = 'open'
      const r = assessReadiness(open)
      expect(r.level).toBe('NOT_YET')
      expect(r.reasons.join('\n')).toContain('#77 OPEN')
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
