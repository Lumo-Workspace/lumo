/**
 * @jest-environment node
 *
 * LUM-771 — the CLI's view of "what blocks DONE" mirrors the server gate
 * (`assertNoUnacknowledgedBoundaryCrossings`, LUM-590/635): an advisory
 * crossing never blocks, and with the workspace gate disabled only HIGH
 * crossings do. Before this fix every `disposition == null` row was listed as a
 * BOUNDARY_CROSSING blocker and told the agent it had to be dispositioned.
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { blocksDone, fetchOpenCrossings } from '@/cli/src/lib/open-crossings'
import { collectDoneBlockers } from '@/cli/src/lib/blocked-error'

const API = 'https://api.test'
const TOKEN = 'lum_x'
const TASK = 'LUM-9'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const rows = [
  {
    id: 'adv',
    category: 'PROJECT_RULE_VIOLATION',
    severity: 'MEDIUM',
    detail: 'advisory rule',
    disposition: null,
    advisory: true,
  },
  {
    id: 'med',
    category: 'TEST_FILE_DELETED',
    severity: 'MEDIUM',
    detail: 'medium',
    disposition: null,
    advisory: false,
  },
  {
    id: 'high',
    category: 'HARDCODED_SECRET',
    severity: 'HIGH',
    detail: 'high',
    disposition: null,
    advisory: false,
  },
  {
    id: 'closed',
    category: 'HARDCODED_SECRET',
    severity: 'HIGH',
    detail: 'ruled',
    disposition: 'CONFIRMED',
    advisory: false,
  },
]

function route(gateEnabled: boolean | undefined) {
  jest
    .spyOn(global, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/boundary-crossings')) {
        const body: Record<string, unknown> = { crossings: rows }
        if (gateEnabled !== undefined) body.gateEnabled = gateEnabled
        return jsonResponse(200, body)
      }
      if (url.endsWith('/status'))
        return jsonResponse(200, { criteria: [], nextActions: [] })
      return jsonResponse(404, {})
    })
}

afterEach(() => jest.restoreAllMocks())

describe('LUM-771 CLI blockers mirror the DONE gate', () => {
  it('blocksDone is the server predicate: not advisory, and HIGH when the gate is off', () => {
    expect(blocksDone({ advisory: true, severity: 'HIGH' }, true)).toBe(false)
    expect(blocksDone({ advisory: false, severity: 'LOW' }, true)).toBe(true)
    expect(blocksDone({ advisory: false, severity: 'MEDIUM' }, false)).toBe(
      false
    )
    expect(blocksDone({ advisory: false, severity: 'HIGH' }, false)).toBe(true)
  })

  it('fetchOpenCrossings carries advisory + gateEnabled and marks each open row blocking or not', async () => {
    route(true)
    const result = await fetchOpenCrossings(API, TOKEN, TASK)
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.gateEnabled).toBe(true)
    expect(result.crossings.map(c => [c.id, c.advisory, c.blocking])).toEqual([
      ['high', false, true],
      ['med', false, true],
      ['adv', true, false],
    ])
  })

  it('an older server without gateEnabled defaults to gate on (fail closed)', async () => {
    route(undefined)
    const result = await fetchOpenCrossings(API, TOKEN, TASK)
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.gateEnabled).toBe(true)
    expect(result.crossings.find(c => c.id === 'med')?.blocking).toBe(true)
  })

  it('with the gate on, advisory rows are excluded from blockers and reported as non-blocking', async () => {
    route(true)
    const out = await collectDoneBlockers({
      base: API,
      token: TOKEN,
      identifier: TASK,
    })
    const ids = out.blockers
      .filter(b => b.kind === 'BOUNDARY_CROSSING')
      .map(b => (b as { id: string }).id)
    expect(ids).toEqual(['high', 'med'])
    expect(out.nonBlocking.map(c => c.id)).toEqual(['adv'])
    expect(out.unconfirmed).toEqual([])
  })

  it('with the gate off, only HIGH rows are blockers; MEDIUM and advisory are non-blocking', async () => {
    route(false)
    const out = await collectDoneBlockers({
      base: API,
      token: TOKEN,
      identifier: TASK,
    })
    const ids = out.blockers
      .filter(b => b.kind === 'BOUNDARY_CROSSING')
      .map(b => (b as { id: string }).id)
    expect(ids).toEqual(['high'])
    expect(out.nonBlocking.map(c => c.id).sort()).toEqual(['adv', 'med'])
  })
})
