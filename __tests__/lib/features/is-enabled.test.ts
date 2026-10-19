import {
  featureCohort,
  isFeatureEnabled,
  isStageEnabled,
} from '@/lib/features/is-enabled'
import { FEATURES } from '@/lib/features/config'

const ENV = {
  LUMO_DOGFOOD_WORKSPACE_IDS: 'ws-lumo',
  LUMO_BETA_WORKSPACE_IDS: 'ws-beta-a, ws-beta-b',
}

describe('LUM-1260 isStageEnabled', () => {
  it('public is on for every workspace, even with no cohorts configured', () => {
    expect(isStageEnabled('public', 'ws-anyone', {})).toBe(true)
    expect(isStageEnabled('public', 'ws-anyone', ENV)).toBe(true)
  })

  it('beta is on for the beta cohort and for dogfood, off for everyone else', () => {
    expect(isStageEnabled('beta', 'ws-beta-a', ENV)).toBe(true)
    expect(isStageEnabled('beta', 'ws-beta-b', ENV)).toBe(true)
    expect(isStageEnabled('beta', 'ws-lumo', ENV)).toBe(true)
    expect(isStageEnabled('beta', 'ws-customer', ENV)).toBe(false)
  })

  it('dogfood is on only for the dogfood cohort', () => {
    expect(isStageEnabled('dogfood', 'ws-lumo', ENV)).toBe(true)
    expect(isStageEnabled('dogfood', 'ws-beta-a', ENV)).toBe(false)
    expect(isStageEnabled('dogfood', 'ws-customer', ENV)).toBe(false)
  })

  it('off is off for everyone, dogfood included', () => {
    expect(isStageEnabled('off', 'ws-lumo', ENV)).toBe(false)
    expect(isStageEnabled('off', 'ws-beta-a', ENV)).toBe(false)
  })

  it('unset or empty cohorts mean nobody gets dogfood or beta (no throw)', () => {
    for (const env of [
      {},
      { LUMO_DOGFOOD_WORKSPACE_IDS: '', LUMO_BETA_WORKSPACE_IDS: '' },
      { LUMO_DOGFOOD_WORKSPACE_IDS: ' , ,', LUMO_BETA_WORKSPACE_IDS: ',' },
    ]) {
      expect(isStageEnabled('dogfood', 'ws-lumo', env)).toBe(false)
      expect(isStageEnabled('beta', 'ws-lumo', env)).toBe(false)
    }
  })

  it('a missing workspace only gets public features', () => {
    for (const ws of [null, undefined, '']) {
      expect(isStageEnabled('public', ws, ENV)).toBe(true)
      expect(isStageEnabled('beta', ws, ENV)).toBe(false)
      expect(isStageEnabled('dogfood', ws, ENV)).toBe(false)
    }
  })
})

describe('LUM-1260 featureCohort', () => {
  it('trims ids and drops blanks', () => {
    expect([
      ...featureCohort('LUMO_BETA_WORKSPACE_IDS', {
        LUMO_BETA_WORKSPACE_IDS: ' a ,b,, c ',
      }),
    ]).toEqual(['a', 'b', 'c'])
    expect(featureCohort('LUMO_BETA_WORKSPACE_IDS', {}).size).toBe(0)
  })
})

describe('LUM-1260 isFeatureEnabled', () => {
  it('reward-hack-scan (dogfood) is on only for the dogfood cohort', () => {
    expect(FEATURES['reward-hack-scan'].stage).toBe('dogfood')
    expect(isFeatureEnabled('reward-hack-scan', 'ws-lumo', ENV)).toBe(true)
    expect(isFeatureEnabled('reward-hack-scan', 'ws-beta-a', ENV)).toBe(false)
    expect(isFeatureEnabled('reward-hack-scan', 'ws-customer', ENV)).toBe(false)
  })
})

describe('LUM-1260 default env', () => {
  it('reads process.env on every call when no env is passed', () => {
    const saved = process.env.LUMO_DOGFOOD_WORKSPACE_IDS
    try {
      process.env.LUMO_DOGFOOD_WORKSPACE_IDS = 'ws-lumo'
      expect(isStageEnabled('dogfood', 'ws-lumo')).toBe(true)
      expect(featureCohort('LUMO_DOGFOOD_WORKSPACE_IDS').has('ws-lumo')).toBe(
        true
      )
      delete process.env.LUMO_DOGFOOD_WORKSPACE_IDS
      expect(isStageEnabled('dogfood', 'ws-lumo')).toBe(false)
    } finally {
      if (saved === undefined) delete process.env.LUMO_DOGFOOD_WORKSPACE_IDS
      else process.env.LUMO_DOGFOOD_WORKSPACE_IDS = saved
    }
  })
})
