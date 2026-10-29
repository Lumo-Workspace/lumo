/**
 * LUM-866 — how the per-workspace switches combine with the platform env.
 */
import {
  DEFAULT_WORKSPACE_SECURITY_SWITCHES,
  AI_REVIEW_DEFAULT_OFF_SINCE,
  platformSecurityCeiling,
  resolveSecurityLayers,
  switchDefaultsFor,
} from '@/ee/security/security-scan/workspace-switches'

const ALL_ON = {
  ...DEFAULT_WORKSPACE_SECURITY_SWITCHES,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
}
/** LUM-1025: Vercel Sandbox configured — the layers' default-on baseline. */
const SANDBOX = { VERCEL: '1' }

describe('LUM-866 env is the ceiling', () => {
  it('LUM-1328: a missing row reads as a new workspace — scan on, AI review and hunt off', () => {
    expect(resolveSecurityLayers(null, SANDBOX)).toEqual({
      scan: true,
      managedScan: true,
      aiReview: false,
      hunt: false,
      rewardHack: false,
      aiReviewTurnedOff: true,
      huntTurnedOff: true,
      rewardHackTurnedOff: false,
    })
    expect(resolveSecurityLayers(undefined, SANDBOX)).toEqual(
      resolveSecurityLayers(DEFAULT_WORKSPACE_SECURITY_SWITCHES, SANDBOX)
    )
  })

  it('LUM-1328: new workspaces start with AI review and hunt off, everything else unchanged', () => {
    expect(DEFAULT_WORKSPACE_SECURITY_SWITCHES).toMatchObject({
      securityScanEnabled: true,
      securityAiReviewEnabled: false,
      securityHuntEnabled: false,
      securityRewardHackEnabled: true,
      securityRequestChangesEnabled: false,
    })
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
  // LUM-1260: the platform ceiling is the `reward-hack-scan` rollout stage
  // (dogfood), so "platform on" means the workspace is in the dogfood cohort.
  const ON = { ...SANDBOX, LUMO_DOGFOOD_WORKSPACE_IDS: 'ws-a' }

  it('runs when the platform allows it and the workspace has it on', () => {
    const got = resolveSecurityLayers({ ...ALL_ON }, ON, 'ws-a')
    expect(got.rewardHack).toBe(true)
    expect(got.rewardHackTurnedOff).toBe(false)
    expect(platformSecurityCeiling(ON, 'ws-a').rewardHack).toBe(true)
  })

  it('is off, and not "turned off", when the platform has it off', () => {
    const got = resolveSecurityLayers({ ...ALL_ON }, SANDBOX, 'ws-a')
    expect(got.rewardHack).toBe(false)
    expect(got.rewardHackTurnedOff).toBe(false)
    expect(platformSecurityCeiling(SANDBOX, 'ws-a').rewardHack).toBe(false)
  })

  it('the workspace switching it off is "turned off" while the platform allows it', () => {
    const got = resolveSecurityLayers(
      { ...ALL_ON, securityRewardHackEnabled: false },
      ON,
      'ws-a'
    )
    expect(got.rewardHack).toBe(false)
    expect(got.rewardHackTurnedOff).toBe(true)
  })

  it('workspace off with the platform off is not "turned off"', () => {
    const got = resolveSecurityLayers(
      { ...ALL_ON, securityRewardHackEnabled: false },
      SANDBOX,
      'ws-a'
    )
    expect(got.rewardHackTurnedOff).toBe(false)
  })

  it('the master scan switch off turns it off', () => {
    const got = resolveSecurityLayers(
      { ...ALL_ON, securityScanEnabled: false },
      ON,
      'ws-a'
    )
    expect(got.rewardHack).toBe(false)
    expect(got.rewardHackTurnedOff).toBe(false)
  })

  it('does not need the sandbox', () => {
    expect(
      resolveSecurityLayers(
        { ...ALL_ON },
        { LUMO_DOGFOOD_WORKSPACE_IDS: 'ws-a' },
        'ws-a'
      ).rewardHack
    ).toBe(true)
  })
})

describe('LUM-1260 reward-hack rollout stage (dogfood)', () => {
  const DOGFOOD = { ...SANDBOX, LUMO_DOGFOOD_WORKSPACE_IDS: 'ws-a,ws-b' }

  it('a dogfood workspace gets the layer', () => {
    expect(
      resolveSecurityLayers({ ...ALL_ON }, DOGFOOD, 'ws-a').rewardHack
    ).toBe(true)
    expect(platformSecurityCeiling(DOGFOOD, 'ws-b').rewardHack).toBe(true)
  })

  it('any other workspace sees it as not offered, never as turned off by it', () => {
    const got = resolveSecurityLayers({ ...ALL_ON }, DOGFOOD, 'ws-c')
    expect(got.rewardHack).toBe(false)
    expect(got.rewardHackTurnedOff).toBe(false)
    const off = resolveSecurityLayers(
      { ...ALL_ON, securityRewardHackEnabled: false },
      DOGFOOD,
      'ws-c'
    )
    expect(off.rewardHackTurnedOff).toBe(false)
    expect(platformSecurityCeiling(DOGFOOD, 'ws-c').rewardHack).toBe(false)
    // The other layers' ceiling is not affected.
    expect(platformSecurityCeiling(DOGFOOD, 'ws-c')).toMatchObject({
      managedScan: true,
      hunt: true,
    })
  })

  it('no workspace to check reads as off', () => {
    expect(platformSecurityCeiling(DOGFOOD).rewardHack).toBe(false)
  })

  it('an unset dogfood cohort is off for every workspace', () => {
    expect(
      resolveSecurityLayers({ ...ALL_ON }, SANDBOX, 'ws-a').rewardHack
    ).toBe(false)
  })

  it('the removed LUMO_REWARD_HACK / _WORKSPACES env vars have no effect', () => {
    const legacy = {
      ...SANDBOX,
      LUMO_REWARD_HACK: 'on',
      LUMO_REWARD_HACK_WORKSPACES: 'ws-c',
    }
    expect(
      resolveSecurityLayers({ ...ALL_ON }, legacy, 'ws-c').rewardHack
    ).toBe(false)
  })
})

describe('LUM-1328 switchDefaultsFor', () => {
  it('a workspace created before the change started with AI review and hunt on', () => {
    const before = new Date(AI_REVIEW_DEFAULT_OFF_SINCE.getTime() - 1)
    expect(switchDefaultsFor(before)).toEqual({
      ...DEFAULT_WORKSPACE_SECURITY_SWITCHES,
      securityAiReviewEnabled: true,
      securityHuntEnabled: true,
    })
  })
  it('a newer (or unknown) workspace has the current defaults', () => {
    expect(switchDefaultsFor(AI_REVIEW_DEFAULT_OFF_SINCE)).toEqual(
      DEFAULT_WORKSPACE_SECURITY_SWITCHES
    )
    expect(switchDefaultsFor(null)).toEqual(DEFAULT_WORKSPACE_SECURITY_SWITCHES)
  })
})
