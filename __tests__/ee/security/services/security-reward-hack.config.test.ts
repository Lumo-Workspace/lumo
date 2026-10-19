import {
  isRewardHackEnabledForWorkspace,
  rewardHackMonthlyCapUsd,
} from '@/ee/security/services/security-reward-hack.config'

describe('reward-hack config', () => {
  it('monthly cap defaults to 25 and falls back on invalid values', () => {
    expect(rewardHackMonthlyCapUsd({})).toBe(25)
    for (const bad of ['x', '', '0', '-5', 'Infinity', 'NaN']) {
      expect(
        rewardHackMonthlyCapUsd({ LUMO_REWARD_HACK_MONTHLY_CAP_USD: bad })
      ).toBe(25)
    }
    expect(
      rewardHackMonthlyCapUsd({ LUMO_REWARD_HACK_MONTHLY_CAP_USD: '40.5' })
    ).toBe(40.5)
  })

  describe('LUM-1260 rollout stage (reward-hack-scan is dogfood)', () => {
    const DOGFOOD = { LUMO_DOGFOOD_WORKSPACE_IDS: 'ws-a, ws-b' }

    it('a dogfood workspace is on', () => {
      expect(isRewardHackEnabledForWorkspace('ws-a', DOGFOOD)).toBe(true)
      expect(isRewardHackEnabledForWorkspace('ws-b', DOGFOOD)).toBe(true)
    })

    it('any other workspace, a beta one, or no workspace is off', () => {
      const env = { ...DOGFOOD, LUMO_BETA_WORKSPACE_IDS: 'ws-beta' }
      expect(isRewardHackEnabledForWorkspace('ws-c', env)).toBe(false)
      expect(isRewardHackEnabledForWorkspace('ws-beta', env)).toBe(false)
      expect(isRewardHackEnabledForWorkspace(null, env)).toBe(false)
      expect(isRewardHackEnabledForWorkspace(undefined, env)).toBe(false)
    })

    it('the removed LUMO_REWARD_HACK / _WORKSPACES env vars have no effect', () => {
      const legacy = {
        LUMO_REWARD_HACK: 'on',
        LUMO_REWARD_HACK_WORKSPACES: 'ws-c',
      }
      expect(isRewardHackEnabledForWorkspace('ws-c', legacy)).toBe(false)
      expect(
        isRewardHackEnabledForWorkspace('ws-a', {
          ...DOGFOOD,
          LUMO_REWARD_HACK: 'off',
        })
      ).toBe(true)
    })
  })
})
