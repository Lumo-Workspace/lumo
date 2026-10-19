import { isFeatureEnabled } from '@/lib/features/is-enabled'

/**
 * LUM-1234 — platform switch and cost ceiling of the reward-hack layer
 * ("Agent behavior"). Import-light on purpose: read by the workspace switch
 * resolver and by stage A, so it pulls in nothing else.
 */

/** Default monthly spend ceiling per workspace, in USD. */
export const REWARD_HACK_DEFAULT_MONTHLY_CAP_USD = 25

type Env = Record<string, string | undefined>

/**
 * The platform ceiling of the layer for one workspace: its rollout stage in
 * `lib/features/config.ts` (`reward-hack-scan`). LUM-1260 replaced the
 * `LUMO_REWARD_HACK` / `LUMO_REWARD_HACK_WORKSPACES` env switches; to turn
 * the layer off everywhere, set that stage to `off` and deploy.
 */
export function isRewardHackEnabledForWorkspace(
  workspaceId: string | null | undefined,
  env: Env = process.env
): boolean {
  return isFeatureEnabled('reward-hack-scan', workspaceId, env)
}

/**
 * Monthly spend ceiling per workspace. A missing, non-numeric or
 * non-positive value falls back to the default.
 */
export function rewardHackMonthlyCapUsd(env: Env = process.env): number {
  const raw = env.LUMO_REWARD_HACK_MONTHLY_CAP_USD
  if (raw === undefined || raw.trim() === '') {
    return REWARD_HACK_DEFAULT_MONTHLY_CAP_USD
  }
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : REWARD_HACK_DEFAULT_MONTHLY_CAP_USD
}
