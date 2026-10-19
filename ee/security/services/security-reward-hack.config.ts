/**
 * LUM-1234 — platform switch and cost ceiling of the reward-hack layer
 * ("Agent behavior"). Import-light on purpose: read by the workspace switch
 * resolver and by stage A, so it pulls in nothing else.
 */

/** Default monthly spend ceiling per workspace, in USD. */
export const REWARD_HACK_DEFAULT_MONTHLY_CAP_USD = 25

type Env = Record<string, string | undefined>

/** Platform kill switch: the layer runs only when `LUMO_REWARD_HACK=on`. */
export function isRewardHackEnabled(env: Env = process.env): boolean {
  return env.LUMO_REWARD_HACK === 'on'
}

/**
 * Staged rollout: `LUMO_REWARD_HACK_WORKSPACES` lists the workspace ids
 * (comma-separated) the platform switch applies to. Null when unset or
 * empty — then the switch applies to every workspace.
 */
export function rewardHackWorkspaceAllowlist(
  env: Env = process.env
): Set<string> | null {
  const ids = (env.LUMO_REWARD_HACK_WORKSPACES ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  return ids.length > 0 ? new Set(ids) : null
}

/**
 * The platform ceiling of the layer for one workspace: the switch is on and,
 * when an allowlist is set, the workspace is on it. With an allowlist and no
 * workspace to check, it is off.
 */
export function isRewardHackEnabledForWorkspace(
  workspaceId: string | null | undefined,
  env: Env = process.env
): boolean {
  if (!isRewardHackEnabled(env)) return false
  const allow = rewardHackWorkspaceAllowlist(env)
  return allow === null || (!!workspaceId && allow.has(workspaceId))
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
