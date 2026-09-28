/**
 * LUM-866 — how the per-workspace switches combine with the platform env.
 */
import {
  DEFAULT_WORKSPACE_SECURITY_SWITCHES,
  platformSecurityCeiling,
  resolveSecurityLayers,
} from '@/lib/security-scan/workspace-switches'

const ALL_ON = DEFAULT_WORKSPACE_SECURITY_SWITCHES

describe('LUM-866 env is the ceiling', () => {
  it('everything on by default: a missing row reads as all on', () => {
    expect(resolveSecurityLayers(null, {})).toEqual({
      scan: true,
      managedScan: true,
      aiReview: true,
      hunt: true,
      aiReviewTurnedOff: false,
      huntTurnedOff: false,
    })
    expect(resolveSecurityLayers(undefined, {})).toEqual(
      resolveSecurityLayers(ALL_ON, {})
    )
  })

  it('LUMO_SECURITY_HUNT=off turns the hunt off even with the workspace switch on', () => {
    expect(
      resolveSecurityLayers(ALL_ON, { LUMO_SECURITY_HUNT: 'off' })
    ).toMatchObject({ scan: true, aiReview: true, hunt: false })
  })

  it('LUMO_MANAGED_SCAN=off turns the managed scan off even with the workspace scan on', () => {
    expect(
      resolveSecurityLayers(ALL_ON, { LUMO_MANAGED_SCAN: 'off' })
    ).toMatchObject({ scan: true, managedScan: false, hunt: true })
  })

  it('a workspace switch can only turn a layer off, never on', () => {
    const env = { LUMO_SECURITY_HUNT: 'off', LUMO_MANAGED_SCAN: 'off' }
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
      resolveSecurityLayers({ ...ALL_ON, securityScanEnabled: false }, {})
    ).toEqual({
      scan: false,
      managedScan: false,
      aiReview: false,
      hunt: false,
      aiReviewTurnedOff: false,
      huntTurnedOff: false,
    })
  })

  it('LUM-892 a layer the customer turned off is flagged as turned off', () => {
    expect(
      resolveSecurityLayers({ ...ALL_ON, securityAiReviewEnabled: false }, {})
    ).toMatchObject({ aiReviewTurnedOff: true, huntTurnedOff: false })
    expect(
      resolveSecurityLayers({ ...ALL_ON, securityHuntEnabled: false }, {})
    ).toMatchObject({ aiReviewTurnedOff: false, huntTurnedOff: true })
    // The platform does not offer the hunt: nothing to show as turned off.
    expect(
      resolveSecurityLayers(
        { ...ALL_ON, securityHuntEnabled: false },
        { LUMO_SECURITY_HUNT: 'off' }
      )
    ).toMatchObject({ huntTurnedOff: false })
  })

  it('AI review and hunt switch independently under an enabled scan', () => {
    expect(
      resolveSecurityLayers({ ...ALL_ON, securityAiReviewEnabled: false }, {})
    ).toMatchObject({ aiReview: false, hunt: true })
    expect(
      resolveSecurityLayers({ ...ALL_ON, securityHuntEnabled: false }, {})
    ).toMatchObject({ aiReview: true, hunt: false })
  })

  it('platformSecurityCeiling reports what the env allows', () => {
    expect(platformSecurityCeiling({})).toEqual({
      managedScan: true,
      hunt: true,
    })
    expect(
      platformSecurityCeiling({
        LUMO_SECURITY_HUNT: 'off',
        LUMO_MANAGED_SCAN: 'off',
      })
    ).toEqual({ managedScan: false, hunt: false })
  })
})
