/**
 * LUM-866 — how the per-workspace switches combine with the platform env.
 */
import {
  DEFAULT_WORKSPACE_SECURITY_SWITCHES,
  platformSecurityCeiling,
  resolveSecurityLayers,
} from '@/ee/security/security-scan/workspace-switches'

const ALL_ON = DEFAULT_WORKSPACE_SECURITY_SWITCHES
/** LUM-1025: Vercel Sandbox configured — the layers' default-on baseline. */
const SANDBOX = { VERCEL: '1' }

describe('LUM-866 env is the ceiling', () => {
  it('everything on by default: a missing row reads as all on', () => {
    expect(resolveSecurityLayers(null, SANDBOX)).toEqual({
      scan: true,
      managedScan: true,
      aiReview: true,
      hunt: true,
      rewardHack: false,
      aiReviewTurnedOff: false,
      huntTurnedOff: false,
      rewardHackTurnedOff: false,
    })
    expect(resolveSecurityLayers(undefined, SANDBOX)).toEqual(
      resolveSecurityLayers(ALL_ON, SANDBOX)
    )
  })

  it('LUMO_SECURITY_HUNT=off turns the hunt off even with the workspace switch on', () => {
    expect(
      resolveSecurityLayers(ALL_ON, { ...SANDBOX, LUMO_SECURITY_HUNT: 'off' })
    ).toMatchObject({ scan: true, aiReview: true, hunt: false })
  })

  it('LUMO_MANAGED_SCAN=off turns the managed scan off even with the workspace scan on', () => {
    expect(
      resolveSecurityLayers(ALL_ON, { ...SANDBOX, LUMO_MANAGED_SCAN: 'off' })
    ).toMatchObject({ scan: true, managedScan: false, hunt: true })
  })

  it('a workspace switch can only turn a layer off, never on', () => {
    const env = {
      ...SANDBOX,
      LUMO_SECURITY_HUNT: 'off',
      LUMO_MANAGED_SCAN: 'off',
    }
    for (const scan of [true, false])
      for (const aiReview of [true, false])
        for (const hunt of [true, false]) {
          const got = resolveSecurityLayers(
            {
              securityScanEnabled: scan,
              securityAiReviewEnabled: aiReview,
              securityHuntEnabled: hunt,
            },
            env
          )
          expect(got.hunt).toBe(false)
          expect(got.managedScan).toBe(false)
        }
  })

  it('the scan switch is the master: off turns every layer off', () => {
    expect(
      resolveSecurityLayers({ ...ALL_ON, securityScanEnabled: false }, SANDBOX)
    ).toEqual({
      scan: false,
      managedScan: false,
      aiReview: false,
      hunt: false,
      rewardHack: false,
      aiReviewTurnedOff: false,
      huntTurnedOff: false,
      rewardHackTurnedOff: false,
    })
  })

  it('LUM-892 a layer the customer turned off is flagged as turned off', () => {
    expect(
      resolveSecurityLayers(
        { ...ALL_ON, securityAiReviewEnabled: false },
        SANDBOX
      )
    ).toMatchObject({ aiReviewTurnedOff: true, huntTurnedOff: false })
    expect(
      resolveSecurityLayers({ ...ALL_ON, securityHuntEnabled: false }, SANDBOX)
    ).toMatchObject({ aiReviewTurnedOff: false, huntTurnedOff: true })
    // The platform does not offer the hunt: nothing to show as turned off.
    expect(
      resolveSecurityLayers(
        { ...ALL_ON, securityHuntEnabled: false },
        { ...SANDBOX, LUMO_SECURITY_HUNT: 'off' }
      )
    ).toMatchObject({ huntTurnedOff: false })
  })

  it('AI review and hunt switch independently under an enabled scan', () => {
    expect(
      resolveSecurityLayers(
        { ...ALL_ON, securityAiReviewEnabled: false },
        SANDBOX
      )
    ).toMatchObject({ aiReview: false, hunt: true })
    expect(
      resolveSecurityLayers({ ...ALL_ON, securityHuntEnabled: false }, SANDBOX)
    ).toMatchObject({ aiReview: true, hunt: false })
  })

  it('platformSecurityCeiling reports what the env allows', () => {
    expect(platformSecurityCeiling(SANDBOX)).toEqual({
      managedScan: true,
      hunt: true,
      rewardHack: false,
      sandbox: true,
    })
    expect(
      platformSecurityCeiling({
        ...SANDBOX,
        LUMO_SECURITY_HUNT: 'off',
        LUMO_MANAGED_SCAN: 'off',
      })
    ).toEqual({
      managedScan: false,
      hunt: false,
      rewardHack: false,
      sandbox: true,
    })
  })
})

describe('LUM-1025 no Vercel Sandbox on this deployment', () => {
  it('the managed scan and hunt are off and the ceiling says why', () => {
    expect(platformSecurityCeiling({})).toEqual({
      managedScan: false,
      hunt: false,
      rewardHack: false,
      sandbox: false,
    })
    expect(resolveSecurityLayers(ALL_ON, {})).toMatchObject({
      scan: true,
      aiReview: true,
      managedScan: false,
      hunt: false,
      huntTurnedOff: false,
    })
  })
})

describe('LUM-1234 reward-hack layer switches', () => {
  const ON = { ...SANDBOX, LUMO_REWARD_HACK: 'on' }

  it('runs when the platform allows it and the workspace has it on', () => {
    const got = resolveSecurityLayers({ ...ALL_ON }, ON)
    expect(got.rewardHack).toBe(true)
    expect(got.rewardHackTurnedOff).toBe(false)
    expect(platformSecurityCeiling(ON).rewardHack).toBe(true)
  })

  it('is off, and not "turned off", when the platform has it off', () => {
    const got = resolveSecurityLayers({ ...ALL_ON }, SANDBOX)
    expect(got.rewardHack).toBe(false)
    expect(got.rewardHackTurnedOff).toBe(false)
    expect(platformSecurityCeiling(SANDBOX).rewardHack).toBe(false)
  })

  it('the workspace switching it off is "turned off" while the platform allows it', () => {
    const got = resolveSecurityLayers(
      { ...ALL_ON, securityRewardHackEnabled: false },
      ON
    )
    expect(got.rewardHack).toBe(false)
    expect(got.rewardHackTurnedOff).toBe(true)
  })

  it('workspace off with the platform off is not "turned off"', () => {
    const got = resolveSecurityLayers(
      { ...ALL_ON, securityRewardHackEnabled: false },
      SANDBOX
    )
    expect(got.rewardHackTurnedOff).toBe(false)
  })

  it('the master scan switch off turns it off', () => {
    const got = resolveSecurityLayers(
      { ...ALL_ON, securityScanEnabled: false },
      ON
    )
    expect(got.rewardHack).toBe(false)
    expect(got.rewardHackTurnedOff).toBe(false)
  })

  it('does not need the sandbox', () => {
    expect(
      resolveSecurityLayers({ ...ALL_ON }, { LUMO_REWARD_HACK: 'on' })
        .rewardHack
    ).toBe(true)
  })
})

describe('LUM-1234 LUMO_REWARD_HACK_WORKSPACES rollout allowlist', () => {
  const ON = { ...SANDBOX, LUMO_REWARD_HACK: 'on' }
  const LISTED = { ...ON, LUMO_REWARD_HACK_WORKSPACES: 'ws-a,ws-b' }

  it('a listed workspace gets the layer', () => {
    expect(
      resolveSecurityLayers({ ...ALL_ON }, LISTED, 'ws-a').rewardHack
    ).toBe(true)
    expect(platformSecurityCeiling(LISTED, 'ws-b').rewardHack).toBe(true)
  })

  it('a workspace not listed sees it as not offered, never as turned off by it', () => {
    const got = resolveSecurityLayers({ ...ALL_ON }, LISTED, 'ws-c')
    expect(got.rewardHack).toBe(false)
    expect(got.rewardHackTurnedOff).toBe(false)
    const off = resolveSecurityLayers(
      { ...ALL_ON, securityRewardHackEnabled: false },
      LISTED,
      'ws-c'
    )
    expect(off.rewardHackTurnedOff).toBe(false)
    expect(platformSecurityCeiling(LISTED, 'ws-c').rewardHack).toBe(false)
    // The other layers' ceiling is not affected.
    expect(platformSecurityCeiling(LISTED, 'ws-c')).toMatchObject({
      managedScan: true,
      hunt: true,
    })
  })

  it('a set allowlist with no workspace to check reads as off', () => {
    expect(platformSecurityCeiling(LISTED).rewardHack).toBe(false)
  })

  it('an empty or whitespace allowlist means every workspace', () => {
    for (const raw of ['', '  ', ' , ']) {
      const env = { ...ON, LUMO_REWARD_HACK_WORKSPACES: raw }
      expect(resolveSecurityLayers({ ...ALL_ON }, env, 'ws-z').rewardHack).toBe(
        true
      )
    }
  })

  it('the platform switch off is off for a listed workspace too', () => {
    const env = { ...SANDBOX, LUMO_REWARD_HACK_WORKSPACES: 'ws-a' }
    expect(resolveSecurityLayers({ ...ALL_ON }, env, 'ws-a').rewardHack).toBe(
      false
    )
    expect(platformSecurityCeiling(env, 'ws-a').rewardHack).toBe(false)
  })
})
