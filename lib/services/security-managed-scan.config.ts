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
