/**
 * LUM-735 v5 — constants, the kill switch, and the shared types for the
 * Lumo-managed scan. Deliberately import-light: this module is consumed
 * both by `lib/workflows/security-managed-scan.ts` (a `'use workflow'`
 * orchestrator whose bundle the Workflow SDK compiles into a restricted
 * sandbox) and by stage A (`lib/services/pr-security-scan.service.ts`, for
 * `isManagedScanEnabled`). Neither may pull in `@vercel/sandbox`,
 * `@octokit/auth-app`, or the GitHub integration — the only things this
 * file imports are the two types below. Put anything that needs those
 * heavier deps in `security-managed-scan.service.ts` instead.
 */
import type {
  ResolvedPr,
  NormalizeOutcome,
} from './security-sarif-ingest.service'

export const SEMGREP_VERSION = '1.176.1'
export const GITLEAKS_VERSION = '8.30.1'
export const GITLEAKS_URL = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`
/** LUM-738 — L2 supply chain: osv-scanner release binary, pinned. */
export const OSV_SCANNER_VERSION = '2.5.1'
export const OSV_SCANNER_URL = `https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64`
export const SEMGREP_CONFIGS = [
  'p/owasp-top-ten',
  'p/typescript',
  'p/nodejs',
  'p/python',
]
export const SANDBOX_IMAGE = 'vercel/sandbox/universal'
export const SANDBOX_VCPUS = 2
/** Below the 800 s Fluid cap of the function that hosts the step. */
export const SANDBOX_TIMEOUT_MS = 12 * 60 * 1000
/** Same cap as the ingest path's raw (post-gunzip) SARIF size. */
export const MANAGED_REPORT_MAX_BYTES = 400 * 1024 * 1024
export const MANAGED_SCAN_TOOLS = [
  'gitleaks',
  'semgrep',
  'osv-scanner',
] as const
export type ManagedScanTool = (typeof MANAGED_SCAN_TOOLS)[number]
/** The one tool whose rows are DEPENDENCY findings and whose stage is `supplyChain` (LUM-738). */
export const SUPPLY_CHAIN_TOOL = 'osv-scanner' satisfies ManagedScanTool
/**
 * LUM-738 — cap on fingerprints one baseline scan may store per tool. The
 * default branch is scanned whole (no diff filter), so this is well above the
 * per-push finding cap; beyond it the baseline is `partial` — membership is
 * still honest, a miss just reads as "new".
 */
export const BASELINE_MAX_FINGERPRINTS = 5000
/** A baseline claim older than this with no result is dead; the next PR may request again. */
export const BASELINE_STALE_MS = 45 * 60 * 1000

export interface ManagedScanJob {
  scanId: string
  pr: ResolvedPr
  headSha: string
}

/**
 * LUM-738 — one tool's outcome in the managed run. `skipped` is a tool that
 * had nothing to scan (osv-scanner: no package sources at all) — a fact, not
 * a failure, so the layer reads SKIPPED rather than FAILED.
 */
export type ManagedToolOutcome =
  | NormalizeOutcome
  | { kind: 'skipped'; reason: string }

export type ManagedScanOutcome = Record<ManagedScanTool, ManagedToolOutcome>

/** LUM-738 — a managed scan of the default branch head, feeding the repository baseline. */
export interface BaselineScanJob {
  workspaceId: string
  repo: string
  sha: string
}

export interface BaselineScanOutcome {
  /** Union of every successful tool's fingerprints, deduped. */
  fingerprints: string[]
  /** Some tool hit `BASELINE_MAX_FINGERPRINTS`. */
  partial: boolean
  /** Tool slugs whose report made it in. */
  tools: string[]
  /** `<tool> <reason>` for every tool that failed. */
  failed: string[]
  /** Tools with nothing to scan. */
  skipped: string[]
}

// ── LUM-745: ops closure (supersede / sweep / hourly cap) ───────────────────

/**
 * The Vercel Sandbox tag key that ties a VM to its scan row;
 * `stopRepoSandboxesByTag({ [SANDBOX_SCAN_TAG]: scanId })` finds it from
 * outside the step that created it.
 */
export const SANDBOX_SCAN_TAG = 'lumoScan'
/**
 * A PENDING external layer older than this is dead: the every-15-minute
 * sweep marks it FAILED. Far above the 12-min sandbox cap × 3 platform
 * retries.
 * `EXTERNAL_PENDING_LATE_MS` (30 min, pr-security-scan.service) is the
 * view-only "scanner is late" hint that precedes it.
 */
export const EXTERNAL_PENDING_DEAD_MS = 45 * 60 * 1000
/** Managed runs one workspace may start per rolling hour unless overridden. */
export const MANAGED_SCAN_HOURLY_CAP_DEFAULT = 20
export const MANAGED_SCAN_HOURLY_WINDOW_MS = 60 * 60 * 1000

/** `LUMO_MANAGED_SCAN_HOURLY_CAP`: a positive integer, else the default. */
export function managedScanHourlyCap(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env.LUMO_MANAGED_SCAN_HOURLY_CAP
  if (raw === undefined || raw === '') return MANAGED_SCAN_HOURLY_CAP_DEFAULT
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : MANAGED_SCAN_HOURLY_CAP_DEFAULT
}

/**
 * What the sandbox step returns when stage A superseded the row before it
 * ran: every tool "skipped: superseded". The workflow recognises the shape
 * (`isSupersededOutcome`) and neither stamps nor syncs — the row already
 * reads SUPERSEDED, and FAILED would be a lie.
 */
export const SUPERSEDED_REASON = 'superseded'

export function supersededOutcome(): ManagedScanOutcome {
  const outcome = {} as ManagedScanOutcome
  for (const tool of MANAGED_SCAN_TOOLS) {
    outcome[tool] = { kind: 'skipped', reason: SUPERSEDED_REASON }
  }
  return outcome
}

export function isSupersededOutcome(outcome: ManagedScanOutcome): boolean {
  return MANAGED_SCAN_TOOLS.every(tool => {
    const o = outcome[tool]
    return o?.kind === 'skipped' && o.reason === SUPERSEDED_REASON
  })
}

/**
 * Kill switch: managed scanning is on unless LUMO_MANAGED_SCAN is exactly "off".
 *
 * The parameter is a plain string map rather than `NodeJS.ProcessEnv`: Next.js
 * augments that type with a required `NODE_ENV`, so a caller (a test) could not
 * pass a bare `{ LUMO_MANAGED_SCAN: 'off' }`. `process.env` is assignable here.
 */
export function isManagedScanEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.LUMO_MANAGED_SCAN !== 'off'
}
