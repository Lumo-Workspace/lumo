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
import { isManagedScanEnabled } from '@/lib/services/security-managed-scan.config'
import { isHuntEnabled } from '@/lib/services/security-hunt.config'

/** The three stored workspace switches (all default on). */
export interface WorkspaceSecuritySwitches {
  securityScanEnabled: boolean
  securityAiReviewEnabled: boolean
  securityHuntEnabled: boolean
}

export const DEFAULT_WORKSPACE_SECURITY_SWITCHES: WorkspaceSecuritySwitches = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
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
}

/** Which layers the platform itself allows — what the settings page may offer. */
export interface PlatformSecurityCeiling {
  managedScan: boolean
  hunt: boolean
}

type Env = Record<string, string | undefined>

export function platformSecurityCeiling(
  env: Env = process.env
): PlatformSecurityCeiling {
  return { managedScan: isManagedScanEnabled(env), hunt: isHuntEnabled(env) }
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
  }
}
