/**
 * @jest-environment node
 *
 * LUM-842: the short status block that state-changing commands print so the
 * agent no longer follows each of them with `lumo task status`.
 */
import {
  assessDigest,
  digestClearsDone,
  fetchStatusDigest,
  formatStatusDigest,
  readStatusDigest,
  type StatusRead,
} from '../../src/lib/status-digest'
import type { OpenCrossingsResult } from '../../src/lib/open-crossings'
import type { TaskStatusResponse } from '../../src/commands/task-status'

function status(over: Partial<TaskStatusResponse> = {}): StatusRead {
  return {
    ok: true,
    value: {
      version: 2,
      task: { id: 't', identifier: 'LUM-9', title: 'T', status: 'IN_PROGRESS' },
      nextActions: [],
      securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
      ...over,
    } as TaskStatusResponse,
  }
}

const NO_CROSSINGS: OpenCrossingsResult = {
  status: 'ok',
  crossings: [],
  gateEnabled: true,
}

function crossing(id: string, blocking: boolean) {
  return {
    id,
    ref: id,
    category: 'TEST_FILE_DELETED',
    severity: 'MEDIUM' as const,
    detail: 'd',
    attribution: {
      workspaceMemberId: null,
      sessionId: null,
      agent: null,
      worktreeBranch: null,
      model: null,
    },
    advisory: !blocking,
    blocking,
    rejudge: null,
  }
}

describe('status digest', () => {
  it('status digest renders status and blockers in a few lines', () => {
    const lines = formatStatusDigest({
      identifier: 'LUM-9',
      status: status({
        nextActions: [
          {
            kind: 'SECURITY_FINDING',
            findingId: 'f1',
            statement: 's',
            severity: 'HIGH',
            provenance: 'DETERMINISTIC',
            blocking: true,
            prNumber: 7,
            ruleId: 'r',
            filePath: 'a.ts',
            line: 1,
          },
          {
            kind: 'TEST_CASE_VERDICT',
            signal: 'PROVEN_DEFECT',
            number: 2,
            title: 'x',
            advisory: true,
          },
          { kind: 'TEST_CASE', statement: 's', command: 'c', advisory: true },
        ],
      }),
      crossings: {
        status: 'ok',
        gateEnabled: true,
        crossings: [crossing('cx-1', true), crossing('cx-2', false)],
      },
    })

    expect(lines.length).toBeLessThanOrEqual(4)
    expect(lines[0]).toContain('same read as `lumo task status LUM-9`')
    expect(lines[1]).toBe('  LUM-9 IN_PROGRESS')
    expect(lines[2]).toBe(
      '  Blocks DONE: 1 boundary crossing (cx-1) — the user rules · 1 blocking security finding · 1 proven test-case defect'
    )
    expect(lines.join('\n')).not.toContain('cx-2') // advisory: not a blocker
  })

  it('status digest renders a clean task as nothing on record', () => {
    const lines = formatStatusDigest({
      identifier: 'LUM-9',
      status: status({
        task: { id: 't', identifier: 'LUM-9', title: 'T', status: 'IN_REVIEW' },
      }),
      crossings: NO_CROSSINGS,
    })
    expect(lines.slice(1)).toEqual([
      '  LUM-9 IN_REVIEW',
      '  Blocks DONE: nothing on record',
    ])
  })

  it('status digest fails closed when the status read failed', () => {
    const lines = formatStatusDigest({
      identifier: 'LUM-9',
      status: { ok: false, reason: 'HTTP 500' },
      crossings: NO_CROSSINGS,
    })
    expect(lines[1]).toContain('Could not read the current status (HTTP 500)')
    expect(lines.join('\n')).not.toContain('nothing on record')
  })

  it('status digest fails closed on a null security-findings read', () => {
    const lines = formatStatusDigest({
      identifier: 'LUM-9',
      status: status({ securityFindings: null }),
      crossings: NO_CROSSINGS,
    })
    expect(lines.join('\n')).toContain('Could not confirm security findings')
    expect(lines.join('\n')).not.toContain('nothing on record')
  })

  it('status digest fails closed when the crossings read failed', () => {
    const lines = formatStatusDigest({
      identifier: 'LUM-9',
      status: status(),
      crossings: { status: 'error', reason: 'HTTP 502' },
    })
    const out = lines.join('\n')
    expect(out).toContain('Could not confirm boundary crossings (HTTP 502)')
    expect(out).not.toContain('nothing on record')
  })

  it('status digest fails closed on a malformed or unreachable status response', async () => {
    const saved = global.fetch
    try {
      global.fetch = jest.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith('/status') ? { unexpected: true } : { crossings: [] },
      })) as unknown as typeof fetch
      let lines = await fetchStatusDigest('https://x.test', 'tok', 'LUM-9')
      expect(lines[1]).toContain('unexpected response shape')

      global.fetch = jest.fn(async () => {
        throw new Error('ECONNRESET')
      }) as unknown as typeof fetch
      lines = await fetchStatusDigest('https://x.test', 'tok', 'LUM-9')
      expect(lines[1]).toContain(
        'Could not read the current status (ECONNRESET)'
      )
      expect(lines.join('\n')).not.toContain('nothing on record')
    } finally {
      global.fetch = saved
    }
  })

  it('status digest reads the same GET /status endpoint as lumo task status', async () => {
    const saved = global.fetch
    try {
      const body = (status() as { value: TaskStatusResponse }).value
      const fetchMock = jest.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith('/status') ? body : { crossings: [], gateEnabled: true },
      }))
      global.fetch = fetchMock as unknown as typeof fetch
      const lines = await fetchStatusDigest('https://x.test', 'tok', 'LUM-9')
      expect(fetchMock.mock.calls.map(c => c[0]).sort()).toEqual([
        'https://x.test/api/tasks/LUM-9/boundary-crossings',
        'https://x.test/api/tasks/LUM-9/status',
      ])
      expect(lines[2]).toBe('  Blocks DONE: nothing on record')
    } finally {
      global.fetch = saved
    }
  })

  // LUM-1106: the verdict `task update --status done` acts on for one step.
  it('digest verdict clears DONE only when every read succeeded and nothing blocks', () => {
    const clear = (input: Parameters<typeof assessDigest>[0]) =>
      digestClearsDone(assessDigest(input))
    const id = 'LUM-9'
    expect(
      clear({ identifier: id, status: status(), crossings: NO_CROSSINGS })
    ).toBe(true)
    // an advisory (non-blocking) crossing does not hold DONE
    expect(
      clear({
        identifier: id,
        status: status(),
        crossings: {
          status: 'ok',
          gateEnabled: true,
          crossings: [crossing('a', false)],
        },
      })
    ).toBe(true)
    expect(
      clear({
        identifier: id,
        status: status(),
        crossings: {
          status: 'ok',
          gateEnabled: true,
          crossings: [crossing('b', true)],
        },
      })
    ).toBe(false)
    expect(
      clear({
        identifier: id,
        status: { ok: false, reason: 'HTTP 500' },
        crossings: NO_CROSSINGS,
      })
    ).toBe(false)
    expect(
      clear({
        identifier: id,
        status: status(),
        crossings: { status: 'error', reason: 'x' },
      })
    ).toBe(false)
    expect(
      clear({
        identifier: id,
        status: status({ securityFindings: null }),
        crossings: NO_CROSSINGS,
      })
    ).toBe(false)
    expect(
      clear({
        identifier: id,
        status: status({
          nextActions: [
            {
              kind: 'TEST_CASE_VERDICT',
              signal: 'PROVEN_DEFECT',
              number: 1,
              title: 't',
              advisory: true,
            },
          ],
        }),
        crossings: NO_CROSSINGS,
      })
    ).toBe(false)
  })

  it('readStatusDigest returns the printed lines and the same verdict', async () => {
    const fetchMock = jest.fn(async (url: string) =>
      url.endsWith('/status')
        ? {
            ok: true,
            status: 200,
            json: async () => (status() as { value: unknown }).value,
          }
        : { ok: true, status: 200, json: async () => ({ crossings: [] }) }
    )
    global.fetch = fetchMock as unknown as typeof fetch
    const r = await readStatusDigest('https://x', 'tok', 'LUM-9')
    expect(r.clearsDone).toBe(true)
    expect(r.lines).toContain('  Blocks DONE: nothing on record')
  })
})
