/**
 * @jest-environment node
 *
 * LUM-1191: `lumo spot-check` — read-only view of the run-review pool.
 * Rate readout (numerator + denominator, no percentage when thin), one row
 * per sampled run with task / case / environment / recorded time / runner,
 * --json passthrough, and no write path.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))

import { fmtTimestamp } from '../../cli/src/lib/format'
import {
  formatSpotCheck,
  formatSpotCheckRate,
  spotCheck,
  type SpotCheckView,
} from '@/cli/src/commands/spot-check'

let out: string
let err: string
let calls: Array<{ url: string; init: RequestInit | undefined }>
const realFetch = global.fetch

function serve(body: unknown, status = 200) {
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  out = ''
  err = ''
  calls = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((s: unknown) => {
    err += String(s)
  })
})
afterEach(() => {
  global.fetch = realFetch
  jest.restoreAllMocks()
})

const VIEW: SpotCheckView = {
  poolSize: 7,
  rate: { status: 'insufficient', reviewed: 2, rejected: 1, minSample: 10 },
  sample: [
    {
      runId: 'run-1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Login',
      caseNumber: 3,
      caseTitle: 'login works',
      environment: 'PRODUCTION',
      commitSha: 'abcdef1234',
      commitDirty: true,
      recordedAt: '2026-09-23T08:00:00.000Z',
      executedBy: 'Alice Chen',
      sourceSessionId: '86dce765-aaaa-bbbb',
      pr: { number: 42, url: 'https://github.com/x/y/pull/42' },
    },
    {
      runId: 'run-2',
      taskIdentifier: 'LUM-7',
      taskTitle: 'Logout',
      caseNumber: 1,
      caseTitle: 'logout\u001b[31m clears',
      environment: 'LOCAL',
      commitSha: null,
      commitDirty: null,
      recordedAt: '2026-09-22T01:02:00.000Z',
      executedBy: null,
      sourceSessionId: null,
      pr: null,
    },
  ],
}

const WEB = 'https://api.lumo.test/workspace/lumo/run-reviews'

describe('formatSpotCheckRate', () => {
  it('withholds a percentage below the minimum sample', () => {
    const s = formatSpotCheckRate(VIEW.rate)
    expect(s).toContain('2 of the 10 needed, 1 sent back so far')
    expect(s).not.toMatch(/%/)
  })

  it('shows numerator and denominator next to a measured rate', () => {
    expect(
      formatSpotCheckRate({
        status: 'measured',
        reviewed: 20,
        rejected: 3,
        rate: 0.15,
      })
    ).toBe(
      'False-report rate: 3 of 20 reviewed passes sent back — 15% false-report rate'
    )
  })
})

describe('formatSpotCheck', () => {
  it('lists each sampled run: handle, case, env, recorded time, runner, commit, PR', () => {
    const text = formatSpotCheck(VIEW, WEB, { tty: false, color: false })
    const lines = text.split('\n')
    expect(lines[1]).toBe(
      '7 unreviewed passes in the pool · showing a random sample of 2'
    )
    const row1 = lines.find(l => l.startsWith('LUM-42/TC3'))!
    expect(row1).toContain('login works')
    expect(row1).toContain('PRODUCTION')
    expect(row1).toContain(fmtTimestamp('2026-09-23T08:00:00.000Z'))
    expect(row1).toContain('by Alice Chen via session 86dce765')
    expect(row1).toContain('@abcdef1+dirty')
    expect(row1).toContain('#42')
    const row2 = lines.find(l => l.startsWith('LUM-7/TC1'))!
    expect(row2).toContain('runner not recorded')
    // untrusted titles are sanitised (no raw escape sequences)
    expect(row2).not.toContain('\u001b')
    expect(text).toContain(`open ${WEB} in the browser`)
  })

  it('leaves the runner column blank (not "nobody") for an older server', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { executedBy, ...withoutRunner } = VIEW.sample[0]!
    const old = { ...VIEW, sample: [withoutRunner] }
    const row = formatSpotCheck(old, WEB, { tty: false, color: false })
      .split('\n')
      .find(l => l.startsWith('LUM-42/TC3'))!
    expect(row).not.toContain('runner not recorded')
    expect(row).not.toContain('Alice')
  })

  it('says the pool is empty but still prints the rate', () => {
    const text = formatSpotCheck(
      { sample: [], poolSize: 0, rate: VIEW.rate },
      WEB
    )
    expect(text).toContain('False-report rate')
    expect(text).toContain('No unreviewed passes in the pool.')
  })
})

describe('spotCheck', () => {
  it('reads GET /api/test-case-reviews with the bearer token and prints the table', async () => {
    serve(VIEW)
    expect(await spotCheck()).toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.lumo.test/api/test-case-reviews')
    expect(calls[0]!.init?.method ?? 'GET').toBe('GET')
    expect(
      (calls[0]!.init?.headers as Record<string, string>).Authorization
    ).toBe('Bearer tok')
    expect(out).toContain('LUM-42/TC3')
    expect(out).toContain(WEB)
  })

  it('--json prints the server payload as-is', async () => {
    serve(VIEW)
    await spotCheck({ json: true })
    expect(JSON.parse(out)).toEqual(VIEW)
  })

  it('surfaces an auth failure as an error and exit 1', async () => {
    serve({ error: 'Unauthorized' }, 401)
    expect(await spotCheck()).toBe(1)
    expect(err).not.toBe('')
    expect(out).toBe('')
  })

  it('has no write path — every mode only GETs the read route', async () => {
    serve(VIEW)
    await spotCheck()
    await spotCheck({ json: true })
    serve({ error: 'Unauthorized' }, 401)
    await spotCheck()
    expect(calls).toHaveLength(3)
    for (const c of calls) {
      expect(c.url).toBe('https://api.lumo.test/api/test-case-reviews')
      expect(c.init?.method ?? 'GET').toBe('GET')
      expect(c.init?.body).toBeUndefined()
    }
  })
})
