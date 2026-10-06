/**
 * @jest-environment node
 *
 * LUM-1002: `lumo workspace security-scan` — flag parsing, the table, a
 * turn-off (incl. --disable-all) gated by the confirmation envelope with no
 * PATCH sent, a confirmed / turn-on PATCH, and the server's 403 surfaced.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))

import {
  buildSecurityScanUpdate,
  describeTurnOffs,
  formatSecurityScanSettings,
  workspaceSecurityScan,
  type SecurityScanSettingsView,
} from '@/cli/src/commands/workspace-security-scan'

const ALL_ON: SecurityScanSettingsView = {
  switches: {
    securityScanEnabled: true,
    securityAiReviewEnabled: true,
    securityHuntEnabled: true,
  },
  platform: { managedScan: true, hunt: false },
  effective: { scan: true, managedScan: true, aiReview: true, hunt: false },
}
const ALL_OFF: SecurityScanSettingsView = {
  switches: {
    securityScanEnabled: false,
    securityAiReviewEnabled: false,
    securityHuntEnabled: false,
  },
  platform: { managedScan: true, hunt: false },
  effective: { scan: false, managedScan: false, aiReview: false, hunt: false },
}

let out: string
let err: string
let calls: Array<{ url: string; init: RequestInit | undefined }>

function serve(responses: Array<{ body: unknown; status?: number }>): void {
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
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
afterEach(() => jest.restoreAllMocks())

describe('buildSecurityScanUpdate', () => {
  it('returns null for a plain read', () => {
    expect(buildSecurityScanUpdate({})).toBeNull()
  })
  it('maps --disable-all / --enable-all to { all }', () => {
    expect(buildSecurityScanUpdate({ disableAll: true })).toEqual({
      all: false,
    })
    expect(buildSecurityScanUpdate({ enableAll: true })).toEqual({ all: true })
  })
  it('maps single on/off flags', () => {
    expect(
      buildSecurityScanUpdate({ aiReview: 'off', hunt: 'ON', scan: 'true' })
    ).toEqual({
      securityAiReviewEnabled: false,
      securityHuntEnabled: true,
      securityScanEnabled: true,
    })
  })
  it('rejects bad values and conflicting flags', () => {
    expect(() => buildSecurityScanUpdate({ hunt: 'maybe' })).toThrow(
      /--hunt takes on or off/
    )
    expect(() =>
      buildSecurityScanUpdate({ disableAll: true, enableAll: true })
    ).toThrow(/not both/)
    expect(() =>
      buildSecurityScanUpdate({ disableAll: true, hunt: 'off' })
    ).toThrow(/cannot be combined/)
  })
})

describe('describeTurnOffs', () => {
  it('lists every switch disable-all turns off', () => {
    const lines = describeTurnOffs(ALL_ON.switches, { all: false })
    expect(lines.filter(l => l.startsWith('Will turn OFF'))).toHaveLength(3)
    expect(lines.join('\n')).toMatch(/not scanned/)
  })
  it('is empty when nothing is turned off', () => {
    expect(describeTurnOffs(ALL_ON.switches, { all: true })).toEqual([])
    expect(describeTurnOffs(ALL_OFF.switches, { all: false })).toEqual([])
    expect(
      describeTurnOffs(ALL_OFF.switches, { securityHuntEnabled: true })
    ).toEqual([])
  })
})

describe('formatSecurityScanSettings', () => {
  it('shows setting, platform ceiling and what runs', () => {
    const text = formatSecurityScanSettings(ALL_ON)
    expect(text).toMatch(/Exploit-path hunt\s+on\s+off\s+no/)
    expect(text).toMatch(/AI review\s+on\s+-\s+yes/)
    expect(formatSecurityScanSettings(ALL_OFF)).toMatch(
      /Security scanning is off/
    )
  })
})

describe('workspaceSecurityScan', () => {
  it('reads with GET and prints the table', async () => {
    serve([{ body: ALL_ON }])
    expect(await workspaceSecurityScan({})).toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(
      'https://api.lumo.test/api/workspaces/me/security-scan'
    )
    expect(out).toMatch(/Security scan \(master\)/)
  })

  it('--disable-all without --confirm exits 4 and sends no PATCH', async () => {
    serve([{ body: ALL_ON }])
    expect(await workspaceSecurityScan({ disableAll: true })).toBe(4)
    expect(calls).toHaveLength(1)
    expect(out).toMatch(/confirmation_required/)
    expect(out).toMatch(/--confirm/)
  })

  it('--disable-all --confirm sends { all: false }', async () => {
    serve([{ body: ALL_ON }, { body: ALL_OFF }])
    expect(
      await workspaceSecurityScan({ disableAll: true, confirm: true })
    ).toBeUndefined()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.init?.method).toBe('PATCH')
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ all: false })
    expect(out).toMatch(/saved/)
  })

  it('--enable-all needs no confirmation', async () => {
    serve([{ body: ALL_OFF }, { body: ALL_ON }])
    expect(await workspaceSecurityScan({ enableAll: true })).toBeUndefined()
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ all: true })
  })

  it('surfaces the OWNER-only 403', async () => {
    serve([
      { body: ALL_ON },
      {
        body: { error: 'Only admins can update workspace settings' },
        status: 403,
      },
    ])
    expect(await workspaceSecurityScan({ hunt: 'on', confirm: true })).toBe(1)
    expect(err).toMatch(/Only admins/)
  })

  it('--json prints the payload', async () => {
    serve([{ body: ALL_ON }])
    await workspaceSecurityScan({ json: true })
    expect(JSON.parse(out)).toEqual(ALL_ON)
  })
})
