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
  describeGatedChanges,
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
  canEdit: true,
}
const ALL_OFF: SecurityScanSettingsView = {
  switches: {
    securityScanEnabled: false,
    securityAiReviewEnabled: false,
    securityHuntEnabled: false,
  },
  platform: { managedScan: true, hunt: false },
  effective: { scan: false, managedScan: false, aiReview: false, hunt: false },
  canEdit: true,
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

  it('a non-OWNER changing anything is refused before any envelope or PATCH', async () => {
    serve([{ body: { ...ALL_ON, canEdit: false } }])
    expect(await workspaceSecurityScan({ disableAll: true })).toBe(1)
    expect(calls).toHaveLength(1)
    expect(out).not.toMatch(/confirmation_required/)
    expect(err).toMatch(/only workspace owners/)
  })

  it('a non-OWNER can still read', async () => {
    serve([{ body: { ...ALL_ON, canEdit: false } }])
    expect(await workspaceSecurityScan({})).toBeUndefined()
    expect(out).toMatch(/Security scan \(master\)/)
  })

  it('an older server without canEdit falls back to the server 403', async () => {
    const { canEdit: _drop, ...legacy } = ALL_ON
    void _drop
    serve([
      { body: legacy },
      {
        body: { error: 'Only admins can update workspace settings' },
        status: 403,
      },
    ])
    expect(await workspaceSecurityScan({ hunt: 'on' })).toBe(1)
    expect(calls).toHaveLength(2)
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
    expect(JSON.parse(out)).toEqual({ version: 1, ...ALL_ON })
  })
})

describe('LUM-1130 --request-changes', () => {
  const RC_ON: SecurityScanSettingsView = {
    ...ALL_ON,
    switches: { ...ALL_ON.switches, securityRequestChangesEnabled: true },
  }
  const RC_OFF: SecurityScanSettingsView = {
    ...ALL_ON,
    switches: { ...ALL_ON.switches, securityRequestChangesEnabled: false },
  }

  it('maps the flag and refuses it with --enable-all / --disable-all', () => {
    expect(buildSecurityScanUpdate({ requestChanges: 'on' })).toEqual({
      securityRequestChangesEnabled: true,
    })
    expect(() =>
      buildSecurityScanUpdate({ enableAll: true, requestChanges: 'on' })
    ).toThrow(/--request-changes/)
    expect(() => buildSecurityScanUpdate({ requestChanges: 'x' })).toThrow(
      /--request-changes takes on or off/
    )
  })

  it('turning it on or off is gated; leaving it alone is not', () => {
    const on = describeGatedChanges(RC_OFF.switches, {
      securityRequestChangesEnabled: true,
    })
    expect(on.join('\n')).toMatch(/Will turn ON: Request-changes workflow/)
    const off = describeGatedChanges(RC_ON.switches, {
      securityRequestChangesEnabled: false,
    })
    expect(off.join('\n')).toMatch(/Will turn OFF: Request-changes workflow/)
    // LUM-1140: the envelope says Lumo's change requests are withdrawn
    expect(off.join('\n')).toMatch(
      /dismisses its standing “Changes requested” reviews/
    )
    expect(
      describeGatedChanges(RC_ON.switches, { securityHuntEnabled: false }).join(
        '\n'
      )
    ).not.toMatch(/dismisses its standing/)
    expect(
      describeGatedChanges(RC_ON.switches, {
        securityRequestChangesEnabled: true,
      })
    ).toEqual([])
    expect(describeGatedChanges(RC_OFF.switches, { all: true })).toEqual([])
  })

  it('--request-changes on without --confirm exits 4 and sends no PATCH', async () => {
    serve([{ body: RC_OFF }])
    expect(await workspaceSecurityScan({ requestChanges: 'on' })).toBe(4)
    expect(calls).toHaveLength(1)
    expect(out).toMatch(/confirmation_required/)
  })

  it('--request-changes on --confirm PATCHes the switch and prints it', async () => {
    serve([{ body: RC_OFF }, { body: RC_ON }])
    expect(
      await workspaceSecurityScan({ requestChanges: 'on', confirm: true })
    ).toBeUndefined()
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      securityRequestChangesEnabled: true,
    })
    expect(out).toMatch(/Request-changes workflow: on/)
  })

  it('an older server without the field prints no request-changes line', () => {
    expect(formatSecurityScanSettings(ALL_ON)).not.toMatch(/Request-changes/)
  })
})

describe('LUM-1142 --allow-author-approval', () => {
  const AA_ON: SecurityScanSettingsView = {
    ...ALL_ON,
    switches: { ...ALL_ON.switches, securityAllowAuthorApproval: true },
  }
  const AA_OFF: SecurityScanSettingsView = {
    ...ALL_ON,
    switches: { ...ALL_ON.switches, securityAllowAuthorApproval: false },
  }

  it('maps the flag and refuses it with --enable-all / --disable-all', () => {
    expect(buildSecurityScanUpdate({ allowAuthorApproval: 'off' })).toEqual({
      securityAllowAuthorApproval: false,
    })
    expect(() =>
      buildSecurityScanUpdate({ disableAll: true, allowAuthorApproval: 'on' })
    ).toThrow(/--allow-author-approval/)
    expect(() =>
      buildSecurityScanUpdate({ allowAuthorApproval: 'maybe' })
    ).toThrow(/--allow-author-approval takes on or off/)
  })

  it('turning it on (widening who can approve) and off are gated; leaving it alone is not', () => {
    const on = describeGatedChanges(AA_OFF.switches, {
      securityAllowAuthorApproval: true,
    })
    expect(on.join('\n')).toMatch(
      /Will turn ON: PR authors may resolve \/ approve by command/
    )
    const off = describeGatedChanges(AA_ON.switches, {
      securityAllowAuthorApproval: false,
    })
    expect(off.join('\n')).toMatch(
      /Will turn OFF: PR authors may resolve \/ approve by command/
    )
    expect(
      describeGatedChanges(AA_ON.switches, {
        securityAllowAuthorApproval: true,
      })
    ).toEqual([])
    expect(describeGatedChanges(AA_OFF.switches, { all: true })).toEqual([])
  })

  it('--allow-author-approval on without --confirm exits 4 and sends no PATCH', async () => {
    serve([{ body: AA_OFF }])
    expect(await workspaceSecurityScan({ allowAuthorApproval: 'on' })).toBe(4)
    expect(calls).toHaveLength(1)
    expect(out).toMatch(/confirmation_required/)
  })

  it('--allow-author-approval off --confirm PATCHes the switch and prints it', async () => {
    serve([{ body: AA_ON }, { body: AA_OFF }])
    expect(
      await workspaceSecurityScan({
        allowAuthorApproval: 'off',
        confirm: true,
      })
    ).toBeUndefined()
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      securityAllowAuthorApproval: false,
    })
    expect(out).toMatch(/PR authors may resolve \/ approve by command: off/)
  })

  it('an older server without the field prints no author line', () => {
    expect(formatSecurityScanSettings(ALL_ON)).not.toMatch(/PR authors/)
  })
})

describe('LUM-1134 --learnings-scope', () => {
  const withScope = (
    scope: 'local' | 'global' | 'auto'
  ): SecurityScanSettingsView => ({
    ...ALL_ON,
    switches: { ...ALL_ON.switches, securityLearningsScope: scope },
  })

  it('maps the flag (case-insensitive) and refuses a bad value or --enable-all / --disable-all', () => {
    expect(buildSecurityScanUpdate({ learningsScope: 'Global' })).toEqual({
      securityLearningsScope: 'global',
    })
    expect(() => buildSecurityScanUpdate({ learningsScope: 'org' })).toThrow(
      /--learnings-scope takes local, global or auto/
    )
    expect(() =>
      buildSecurityScanUpdate({ disableAll: true, learningsScope: 'local' })
    ).toThrow(/--learnings-scope/)
  })

  it('switching to global is gated (public repositories would read private ones’ learnings); local and auto are not', () => {
    const toGlobal = describeGatedChanges(withScope('auto').switches, {
      securityLearningsScope: 'global',
    })
    expect(toGlobal.join('\n')).toMatch(
      /Will change: Learnings scope auto → global/
    )
    expect(toGlobal.join('\n')).toMatch(/public repositories/)
    expect(
      describeGatedChanges(withScope('global').switches, {
        securityLearningsScope: 'global',
      })
    ).toEqual([])
    for (const scope of ['local', 'auto'] as const)
      expect(
        describeGatedChanges(withScope('global').switches, {
          securityLearningsScope: scope,
        })
      ).toEqual([])
  })

  it('--learnings-scope global without --confirm exits 4 and sends no PATCH', async () => {
    serve([{ body: withScope('auto') }])
    expect(await workspaceSecurityScan({ learningsScope: 'global' })).toBe(4)
    expect(calls).toHaveLength(1)
    expect(out).toMatch(/confirmation_required/)
  })

  it('--learnings-scope local PATCHes the scope and prints it', async () => {
    serve([{ body: withScope('auto') }, { body: withScope('local') }])
    expect(
      await workspaceSecurityScan({ learningsScope: 'local' })
    ).toBeUndefined()
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      securityLearningsScope: 'local',
    })
    expect(out).toMatch(/Learnings scope: local/)
  })

  it('an older server without the field prints no learnings-scope line', () => {
    expect(formatSecurityScanSettings(ALL_ON)).not.toMatch(/Learnings scope/)
  })
})

describe('LUM-1137 --auto-pause-after', () => {
  const withPauseAfter = (n: number): SecurityScanSettingsView => ({
    ...ALL_ON,
    switches: { ...ALL_ON.switches, securityReviewAutoPauseAfter: n },
  })

  it('maps a whole number 0–100 and refuses anything else or --enable-all', () => {
    expect(buildSecurityScanUpdate({ autoPauseAfter: '0' })).toEqual({
      securityReviewAutoPauseAfter: 0,
    })
    expect(buildSecurityScanUpdate({ autoPauseAfter: ' 12 ' })).toEqual({
      securityReviewAutoPauseAfter: 12,
    })
    for (const bad of ['-1', '101', '2.5', 'five', ''])
      expect(() => buildSecurityScanUpdate({ autoPauseAfter: bad })).toThrow(
        /--auto-pause-after takes a whole number from 0 to 100/
      )
    expect(() =>
      buildSecurityScanUpdate({ enableAll: true, autoPauseAfter: '5' })
    ).toThrow(/--auto-pause-after/)
  })

  it('PATCHes the value (no confirmation) and prints it', async () => {
    serve([{ body: withPauseAfter(5) }, { body: withPauseAfter(0) }])
    expect(await workspaceSecurityScan({ autoPauseAfter: '0' })).toBeUndefined()
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      securityReviewAutoPauseAfter: 0,
    })
    expect(out).toMatch(/Automatic review: every push · never pauses/)
  })

  it('prints the limit, and nothing for an older server', () => {
    expect(formatSecurityScanSettings(withPauseAfter(5))).toMatch(
      /Automatic review: every push · pauses after 5 reviewed commits/
    )
    expect(formatSecurityScanSettings(ALL_ON)).not.toMatch(/Automatic review/)
  })
})

describe('LUM-1234 --reward-hack (Agent behavior)', () => {
  const WITH_RH: SecurityScanSettingsView = {
    ...ALL_ON,
    switches: { ...ALL_ON.switches, securityRewardHackEnabled: true },
    platform: { ...ALL_ON.platform, rewardHack: true },
    effective: { ...ALL_ON.effective, rewardHack: true },
  }

  it('maps the flag and refuses it with --enable-all / --disable-all', () => {
    expect(buildSecurityScanUpdate({ rewardHack: 'off' })).toEqual({
      securityRewardHackEnabled: false,
    })
    expect(() => buildSecurityScanUpdate({ rewardHack: 'maybe' })).toThrow(
      /--reward-hack takes on or off/
    )
    expect(() =>
      buildSecurityScanUpdate({ enableAll: true, rewardHack: 'on' })
    ).toThrow(/--reward-hack/)
  })

  it('turning it off is gated — alone and through --disable-all', () => {
    expect(
      describeTurnOffs(WITH_RH.switches, { securityRewardHackEnabled: false })
    ).toContain('Will turn OFF: Agent behavior (reward-hack check)')
    expect(describeTurnOffs(WITH_RH.switches, { all: false })).toContain(
      'Will turn OFF: Agent behavior (reward-hack check)'
    )
    expect(
      describeTurnOffs(WITH_RH.switches, { securityRewardHackEnabled: true })
    ).toEqual([])
  })

  it('--reward-hack off without --confirm exits 4 and sends no PATCH', async () => {
    serve([{ body: WITH_RH }])
    const code = await workspaceSecurityScan({ rewardHack: 'off' })
    expect(code).toBe(4)
    expect(calls.some(c => c.init?.method === 'PATCH')).toBe(false)
  })

  it('--reward-hack off --confirm PATCHes the switch', async () => {
    serve([
      { body: WITH_RH },
      {
        body: {
          ...WITH_RH,
          switches: { ...WITH_RH.switches, securityRewardHackEnabled: false },
          effective: { ...WITH_RH.effective, rewardHack: false },
        },
      },
    ])
    await workspaceSecurityScan({ rewardHack: 'off', confirm: true })
    const patch = calls.find(c => c.init?.method === 'PATCH')!
    expect(JSON.parse(String(patch.init!.body))).toEqual({
      securityRewardHackEnabled: false,
    })
    expect(out).toMatch(/Agent behavior\s+off\s+on\s+no/)
  })

  it('shows its row with the platform ceiling; an older server shows none', () => {
    expect(formatSecurityScanSettings(WITH_RH)).toMatch(
      /Agent behavior\s+on\s+on\s+yes/
    )
    expect(
      formatSecurityScanSettings({
        ...WITH_RH,
        platform: { ...WITH_RH.platform, rewardHack: false },
        effective: { ...WITH_RH.effective, rewardHack: false },
      })
    ).toMatch(/Agent behavior\s+on\s+off\s+no/)
    expect(formatSecurityScanSettings(ALL_ON)).not.toMatch(/Agent behavior/)
  })
})

describe('LUM-1259 --local-scan-log', () => {
  const LOG_ON: SecurityScanSettingsView = {
    ...ALL_ON,
    switches: { ...ALL_ON.switches, securityLocalScanLogEnabled: true },
  }
  const LOG_OFF: SecurityScanSettingsView = {
    ...ALL_ON,
    switches: { ...ALL_ON.switches, securityLocalScanLogEnabled: false },
  }

  it('parses on / off into the switch', () => {
    expect(buildSecurityScanUpdate({ localScanLog: 'on' })).toEqual({
      securityLocalScanLogEnabled: true,
    })
    expect(buildSecurityScanUpdate({ localScanLog: 'OFF' })).toEqual({
      securityLocalScanLogEnabled: false,
    })
    expect(() => buildSecurityScanUpdate({ localScanLog: 'yes' })).toThrow(
      '--local-scan-log takes on or off'
    )
    expect(() =>
      buildSecurityScanUpdate({ localScanLog: 'on', enableAll: true })
    ).toThrow('--local-scan-log')
  })

  it('turning it ON is confirmed (unpushed-commit metadata); turning it off is not', () => {
    const on = describeGatedChanges(LOG_OFF.switches, {
      securityLocalScanLogEnabled: true,
    })
    expect(on.join('\n')).toMatch(/Will turn ON: Local scan log/)
    expect(on.join('\n')).toMatch(
      /never code, secret values or commit messages/
    )
    expect(on.join('\n')).toMatch(/never block or clear Done/)
    expect(
      describeGatedChanges(LOG_ON.switches, {
        securityLocalScanLogEnabled: false,
      })
    ).toEqual([])
    // `all` never touches it.
    expect(describeGatedChanges(LOG_OFF.switches, { all: true })).toEqual([])
  })

  it('on without --confirm exits 4 and sends no PATCH; with --confirm it PATCHes', async () => {
    serve([{ body: LOG_OFF }])
    expect(await workspaceSecurityScan({ localScanLog: 'on' })).toBe(4)
    expect(calls).toHaveLength(1)
    calls = []
    serve([{ body: LOG_OFF }, { body: LOG_ON }])
    expect(
      await workspaceSecurityScan({ localScanLog: 'on', confirm: true })
    ).toBeUndefined()
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      securityLocalScanLogEnabled: true,
    })
    expect(out).toMatch(/Local scan log \(per commit\): on/)
  })

  it('an older server without the field prints no local scan log line', () => {
    expect(formatSecurityScanSettings(ALL_ON)).not.toMatch(/Local scan log/)
    expect(formatSecurityScanSettings(LOG_OFF)).toMatch(
      /Local scan log \(per commit\): off/
    )
  })
})

describe('LUM-1329 --agent-review-blocks', () => {
  const withLevel = (
    agentReviewBlocking: NonNullable<
      SecurityScanSettingsView['agentReviewBlocking']
    >
  ): SecurityScanSettingsView => ({ ...ALL_ON, agentReviewBlocking })
  const current = (s: SecurityScanSettingsView) => ({
    ...s.switches,
    agentReviewBlocking: s.agentReviewBlocking,
  })

  it('maps the flag (case-insensitive) and refuses a bad value or --enable-all / --disable-all', () => {
    expect(buildSecurityScanUpdate({ agentReviewBlocks: 'Medium' })).toEqual({
      agentReviewBlocking: 'medium',
    })
    expect(() =>
      buildSecurityScanUpdate({ agentReviewBlocks: 'critical' })
    ).toThrow(/--agent-review-blocks takes off, high, medium or low/)
    expect(() =>
      buildSecurityScanUpdate({ enableAll: true, agentReviewBlocks: 'high' })
    ).toThrow(/--agent-review-blocks/)
  })

  it('turning blocking on, widening or narrowing it, and off are all gated; the same level is not', () => {
    const on = describeGatedChanges(current(withLevel('off')), {
      agentReviewBlocking: 'high',
    }).join('\n')
    expect(on).toMatch(
      /Will change: Imported agent reviews block Done — off \(advisory only\) → HIGH/
    )
    expect(on).toMatch(/blocks Done until someone rules on it/)
    const off = describeGatedChanges(current(withLevel('medium')), {
      agentReviewBlocking: 'off',
    }).join('\n')
    expect(off).toMatch(/MEDIUM and HIGH → off/)
    expect(off).toMatch(/no longer block Done/)
    expect(
      describeGatedChanges(current(withLevel('high')), {
        agentReviewBlocking: 'low',
      }).join('\n')
    ).toMatch(/HIGH → every severity/)
    expect(
      describeGatedChanges(current(withLevel('custom')), {
        agentReviewBlocking: 'high',
      }).join('\n')
    ).toMatch(/custom \(set through the API\) → HIGH/)
    expect(
      describeGatedChanges(current(withLevel('high')), {
        agentReviewBlocking: 'high',
      })
    ).toEqual([])
  })

  it('--agent-review-blocks high without --confirm exits 4 and sends no PATCH', async () => {
    serve([{ body: withLevel('off') }])
    expect(await workspaceSecurityScan({ agentReviewBlocks: 'high' })).toBe(4)
    expect(calls).toHaveLength(1)
    expect(out).toMatch(/confirmation_required/)
    expect(out).toMatch(/off \(advisory only\) → HIGH/)
  })

  it('--agent-review-blocks high --confirm PATCHes the level and prints it', async () => {
    serve([{ body: withLevel('off') }, { body: withLevel('high') }])
    expect(
      await workspaceSecurityScan({ agentReviewBlocks: 'high', confirm: true })
    ).toBeUndefined()
    expect(calls[1]!.init?.method).toBe('PATCH')
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      agentReviewBlocking: 'high',
    })
    expect(out).toMatch(/Imported agent reviews block Done: HIGH/)
  })

  it('a non-OWNER is refused before any envelope or PATCH', async () => {
    serve([{ body: { ...withLevel('off'), canEdit: false } }])
    expect(await workspaceSecurityScan({ agentReviewBlocks: 'high' })).toBe(1)
    expect(calls).toHaveLength(1)
    expect(err).toMatch(/only workspace owners/)
  })

  it('an older server without the setting refuses the flag and prints no line', async () => {
    serve([{ body: ALL_ON }])
    expect(
      await workspaceSecurityScan({ agentReviewBlocks: 'high', confirm: true })
    ).toBe(1)
    expect(calls).toHaveLength(1)
    expect(err).toMatch(/does not support --agent-review-blocks/)
    expect(formatSecurityScanSettings(ALL_ON)).not.toMatch(/agent reviews/)
  })

  it('show prints the current level', () => {
    expect(formatSecurityScanSettings(withLevel('off'))).toMatch(
      /Imported agent reviews block Done: off \(advisory only\)/
    )
    expect(formatSecurityScanSettings(withLevel('medium'))).toMatch(
      /Imported agent reviews block Done: MEDIUM and HIGH/
    )
  })
})
