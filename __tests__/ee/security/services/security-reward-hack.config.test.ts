import {
  isRewardHackEnabled,
  rewardHackMonthlyCapUsd,
} from '@/ee/security/services/security-reward-hack.config'

describe('reward-hack config', () => {
  it('is on only when LUMO_REWARD_HACK is exactly "on"', () => {
    expect(isRewardHackEnabled({})).toBe(false)
    expect(isRewardHackEnabled({ LUMO_REWARD_HACK: 'off' })).toBe(false)
    expect(isRewardHackEnabled({ LUMO_REWARD_HACK: '1' })).toBe(false)
    expect(isRewardHackEnabled({ LUMO_REWARD_HACK: 'on' })).toBe(true)
  })

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
})
