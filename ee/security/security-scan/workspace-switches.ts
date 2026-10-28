/**
 * LUM-866 — per-workspace switches for the PR security scan, and how they
 * combine with the platform kill switches.
 *
 * The platform env (`LUMO_MANAGED_SCAN`, `LUMO_SECURITY_HUNT`) stays the
 * ceiling: a workspace switch can only turn a layer OFF, never on. The scan
 * switch is the master — with it off, no layer runs at all.
 *
 * Pure and import-light (the two env readers are themselves type-only
 * modules), so stage A, the SARIF ingest, the baseline and the hunt ops can
 * all share one rule.
 */
import { isManagedScanEnabled } from '@/ee/security/services/security-managed-scan.config'
import { isHuntEnabled } from '@/ee/security/services/security-hunt.config'
import { isRewardHackEnabledForWorkspace } from '@/ee/security/services/security-reward-hack.config'
import { isIntegrationConfigured } from '@/lib/integrations/configured'
import {
  DEFAULT_LEARNINGS_SCOPE,
  type LearningsScope,
} from '@/ee/security/security-scan/learnings-scope'
import { DEFAULT_AUTO_PAUSE_AFTER } from '@/ee/security/security-scan/review-control'

/**
 * The stored workspace switches: the layer switches and LUM-1130's
 * request-changes workflow (default OFF — it changes the PR's merge UX, so a
 * workspace opts in). LUM-1328: Lumo's own AI review and hunt also start OFF
 * for a new workspace — the developer's own agent review is the default.
 */
export interface WorkspaceSecuritySwitches {
  securityScanEnabled: boolean
  securityAiReviewEnabled: boolean
  securityHuntEnabled: boolean
  /** LUM-1234: the reward-hack layer ("Agent behavior"; default on). */
  securityRewardHackEnabled: boolean
  securityRequestChangesEnabled: boolean
  /** LUM-1142: the PR's author may resolve / approve by command
   *  (author approval, default on). */
  securityAllowAuthorApproval: boolean
  /** LUM-1134: which repositories' learnings the AI review reads. */
  securityLearningsScope: LearningsScope
  /** LUM-1137: pause automatic review of a PR after this many reviewed
   *  commits (0 = never pause). */
  securityReviewAutoPauseAfter: number
}

export const DEFAULT_WORKSPACE_SECURITY_SWITCHES: WorkspaceSecuritySwitches = {
  securityScanEnabled: true,
  securityAiReviewEnabled: false,
  securityHuntEnabled: false,
  securityRewardHackEnabled: true,
  securityRequestChangesEnabled: false,
  securityAllowAuthorApproval: true,
  securityLearningsScope: DEFAULT_LEARNINGS_SCOPE,
  securityReviewAutoPauseAfter: DEFAULT_AUTO_PAUSE_AFTER,
}

/** Which layers may run for one workspace, after the platform ceiling. */
export interface EffectiveSecurityLayers {
  /** Master: any PR security scan at all (scan row, every layer, PR comment). */
  scan: boolean
  /** L1/L2 in the managed sandbox VM (and the default-branch baseline). */
  managedScan: boolean
  /** A4 LLM judge ("AI review"). */
  aiReview: boolean
  /** L3 exploit-path hunt. */
  hunt: boolean
  /** LUM-1234: reward-hack layer (agent sessions behind the PR). */
  rewardHack: boolean
  /**
   * LUM-892 — the customer turned the AI review off in settings (the scan
   * itself is on). Such a layer is shown as turned off, never as checked:
   * it is the customer's choice, not a platform limit and not our fault.
   */
  aiReviewTurnedOff: boolean
  /**
   * LUM-892 — the customer turned the hunt off in settings while the
   * platform offers it. With the platform ceiling off the layer is not
   * offered at all, so there is nothing to show as turned off.
   */
  huntTurnedOff: boolean
  /** LUM-1234 — as `huntTurnedOff`, for the reward-hack layer. */
  rewardHackTurnedOff: boolean
}

/** Which layers the platform itself allows — what the settings page may offer. */
export interface PlatformSecurityCeiling {
  managedScan: boolean
  hunt: boolean
  /**
   * LUM-1234: the `reward-hack-scan` rollout stage (`lib/features/config.ts`,
   * LUM-1260) is on for this workspace.
   */
  rewardHack: boolean
  /**
   * LUM-1025 — Vercel Sandbox is configured on this deployment. When false the
   * managed scan, baseline, hunt and verifier are all off, and the settings
   * page says why ("not available on this deployment") instead of blaming a
   * platform-wide switch.
   */
  sandbox: boolean
}

type Env = Record<string, string | undefined>

/**
 * `workspaceId`: the workspace the ceiling is for — the reward-hack layer's
 * rollout stage is per workspace (without one, only a public stage reads as
 * on). A workspace outside the stage sees the layer as not offered, never as
 * turned off by it.
 */
export function platformSecurityCeiling(
  env: Env = process.env,
  workspaceId?: string | null
): PlatformSecurityCeiling {
  return {
    managedScan: isManagedScanEnabled(env),
    hunt: isHuntEnabled(env),
    rewardHack: isRewardHackEnabledForWorkspace(workspaceId, env),
    sandbox: isIntegrationConfigured('vercelSandbox', env),
  }
}

/**
 * A missing row (or a partial one) reads as the column defaults — exactly
 * what the database would hold for a new workspace.
 */
export function resolveSecurityLayers(
  stored: Partial<WorkspaceSecuritySwitches> | null | undefined,
  env: Env = process.env,
  workspaceId?: string | null
): EffectiveSecurityLayers {
  const ws = { ...DEFAULT_WORKSPACE_SECURITY_SWITCHES, ...(stored ?? {}) }
  const ceiling = platformSecurityCeiling(env, workspaceId)
  const scan = ws.securityScanEnabled
  return {
    scan,
    managedScan: scan && ceiling.managedScan,
    aiReview: scan && ws.securityAiReviewEnabled,
    hunt: scan && ws.securityHuntEnabled && ceiling.hunt,
    rewardHack: scan && ws.securityRewardHackEnabled && ceiling.rewardHack,
    aiReviewTurnedOff: scan && !ws.securityAiReviewEnabled,
    huntTurnedOff: scan && !ws.securityHuntEnabled && ceiling.hunt,
    rewardHackTurnedOff:
      scan && !ws.securityRewardHackEnabled && ceiling.rewardHack,
  }
}
