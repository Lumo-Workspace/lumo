import {
  isRewardHackEnabled,
  isRewardHackEnabledForWorkspace,
  rewardHackMonthlyCapUsd,
  rewardHackWorkspaceAllowlist,
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

  describe('LUMO_REWARD_HACK_WORKSPACES rollout allowlist', () => {
    const ON = { LUMO_REWARD_HACK: 'on' }

    it('a listed workspace is on', () => {
      const env = { ...ON, LUMO_REWARD_HACK_WORKSPACES: 'ws-a, ws-b' }
      expect(isRewardHackEnabledForWorkspace('ws-a', env)).toBe(true)
      expect(isRewardHackEnabledForWorkspace('ws-b', env)).toBe(true)
    })

    it('a workspace not listed, or no workspace, is off', () => {
      const env = { ...ON, LUMO_REWARD_HACK_WORKSPACES: 'ws-a' }
      expect(isRewardHackEnabledForWorkspace('ws-c', env)).toBe(false)
      expect(isRewardHackEnabledForWorkspace(null, env)).toBe(false)
      expect(isRewardHackEnabledForWorkspace(undefined, env)).toBe(false)
    })

    it('an unset, empty or whitespace-only allowlist means every workspace', () => {
      for (const raw of [undefined, '', '   ', ' , ,']) {
        const env = { ...ON, LUMO_REWARD_HACK_WORKSPACES: raw }
        expect(rewardHackWorkspaceAllowlist(env)).toBeNull()
        expect(isRewardHackEnabledForWorkspace('ws-any', env)).toBe(true)
      }
    })

    it('the platform switch off is off regardless of the allowlist', () => {
      for (const env of [
        { LUMO_REWARD_HACK_WORKSPACES: 'ws-a' },
        { LUMO_REWARD_HACK: 'off', LUMO_REWARD_HACK_WORKSPACES: 'ws-a' },
        {},
      ]) {
        expect(isRewardHackEnabledForWorkspace('ws-a', env)).toBe(false)
      }
    })
  })
})
