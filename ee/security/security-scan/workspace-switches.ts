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
import { isIntegrationConfigured } from '@/lib/integrations/configured'

/**
 * The stored workspace switches: the three layer switches (default on) and
 * LUM-1130's request-changes workflow (default OFF — it changes the PR's
 * merge UX, so a workspace opts in).
 */
export interface WorkspaceSecuritySwitches {
  securityScanEnabled: boolean
  securityAiReviewEnabled: boolean
  securityHuntEnabled: boolean
  securityRequestChangesEnabled: boolean
}

export const DEFAULT_WORKSPACE_SECURITY_SWITCHES: WorkspaceSecuritySwitches = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
  securityRequestChangesEnabled: false,
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
}

/** Which layers the platform itself allows — what the settings page may offer. */
export interface PlatformSecurityCeiling {
  managedScan: boolean
  hunt: boolean
  /**
   * LUM-1025 — Vercel Sandbox is configured on this deployment. When false the
   * managed scan, baseline, hunt and verifier are all off, and the settings
   * page says why ("not available on this deployment") instead of blaming a
   * platform-wide switch.
   */
  sandbox: boolean
}

type Env = Record<string, string | undefined>

export function platformSecurityCeiling(
  env: Env = process.env
): PlatformSecurityCeiling {
  return {
    managedScan: isManagedScanEnabled(env),
    hunt: isHuntEnabled(env),
    sandbox: isIntegrationConfigured('vercelSandbox', env),
  }
}

/**
 * A missing row (or a partial one) reads as the column defaults — all on —
 * exactly what the database would hold for it.
 */
export function resolveSecurityLayers(
  stored: Partial<WorkspaceSecuritySwitches> | null | undefined,
  env: Env = process.env
): EffectiveSecurityLayers {
  const ws = { ...DEFAULT_WORKSPACE_SECURITY_SWITCHES, ...(stored ?? {}) }
  const ceiling = platformSecurityCeiling(env)
  const scan = ws.securityScanEnabled
  return {
    scan,
    managedScan: scan && ceiling.managedScan,
    aiReview: scan && ws.securityAiReviewEnabled,
    hunt: scan && ws.securityHuntEnabled && ceiling.hunt,
    aiReviewTurnedOff: scan && !ws.securityAiReviewEnabled,
    huntTurnedOff: scan && !ws.securityHuntEnabled && ceiling.hunt,
  }
}
