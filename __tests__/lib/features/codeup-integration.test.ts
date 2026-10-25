/**
 * @jest-environment node
 *
 * LUM-1315 — `codeup-integration` rolls out at stage dogfood: only the
 * dogfood cohort sees it.
 */
import { FEATURES } from '@/lib/features/config'
import { featureStage, isFeatureEnabled } from '@/lib/features/is-enabled'

const env = {
  LUMO_DOGFOOD_WORKSPACE_IDS: 'ws-dog, ws-dog-2',
  LUMO_BETA_WORKSPACE_IDS: 'ws-beta',
}

describe('codeup-integration flag', () => {
  it('is registered at stage dogfood', () => {
    expect(FEATURES['codeup-integration'].stage).toBe('dogfood')
    expect(featureStage('codeup-integration')).toBe('dogfood')
  })

  it('is on for dogfood workspaces only', () => {
    expect(isFeatureEnabled('codeup-integration', 'ws-dog', env)).toBe(true)
    expect(isFeatureEnabled('codeup-integration', 'ws-dog-2', env)).toBe(true)
    expect(isFeatureEnabled('codeup-integration', 'ws-beta', env)).toBe(false)
    expect(isFeatureEnabled('codeup-integration', 'ws-other', env)).toBe(false)
    expect(isFeatureEnabled('codeup-integration', null, env)).toBe(false)
  })

  it('is off for everyone when the cohort env is unset', () => {
    expect(isFeatureEnabled('codeup-integration', 'ws-dog', {})).toBe(false)
  })
})

describe('featureStage', () => {
  it('returns the configured stage of a feature', () => {
    expect(featureStage('reward-hack-scan')).toBe(
      FEATURES['reward-hack-scan'].stage
    )
  })
})
