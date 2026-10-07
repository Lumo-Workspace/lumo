/**
 * LUM-735 v5 — constants, the kill switch, and the shared types for the
 * Lumo-managed scan. Deliberately import-light: this module is consumed
 * both by `lib/workflows/security-managed-scan.ts` (a `'use workflow'`
 * orchestrator whose bundle the Workflow SDK compiles into a restricted
 * sandbox) and by stage A (`lib/services/pr-security-scan.service.ts`, for
 * `isManagedScanEnabled`). Neither may pull in `@vercel/sandbox`,
 * `@octokit/auth-app`, or the GitHub integration — the only things this
 * file imports are the two types below (plus the pure env reader
 * `lib/integrations/configured`). Put anything that needs those heavier deps
 * in `security-managed-scan.service.ts` instead.
 */
import { isIntegrationConfigured } from '@/lib/integrations/configured'
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
/**
 * LUM-846 — GitHub Actions audit (zizmor) and IaC misconfiguration
 * (`trivy config`), both pinned release binaries. Unlike the three tools
 * above, the download is checked against a pinned sha256 before it runs:
 * both tarballs were verified with `gh attestation verify` (and trivy's
 * against its published checksums) when these pins were taken, and the
 * check keeps a swapped release asset from ever executing in the VM.
 */
export const ZIZMOR_VERSION = '1.30.1'
export const ZIZMOR_URL = `https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/zizmor-x86_64-unknown-linux-gnu.tar.gz`
export const ZIZMOR_SHA256 =
  'e65324f4430c2717591937edcec90ccbefaf14c174f8ec9415e03ca875b46e1a'
export const TRIVY_VERSION = '0.74.0'
export const TRIVY_URL = `https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz`
export const TRIVY_SHA256 =
  '2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a'
/**
 * trivy's LOW checks (image tag digests, HEALTHCHECK, resource limits…) are
 * most of its output on an ordinary Dockerfile or manifest; as inline PR
 * comments they bury the few that matter.
 */
export const TRIVY_SEVERITIES = 'MEDIUM,HIGH,CRITICAL'
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
/**
 * LUM-758 — when this scan is also going to run the hunt, the VM has to
 * outlive both halves (managed scan + hunt), because the hunt reuses it
 * instead of paying for a second microVM.
 *
 * Note: **a VM's lifetime is not a function's execution time**, so this may
 * exceed the 800 s Fluid cap of the function hosting the step — the 12-minute
 * rationale on SANDBOX_TIMEOUT_MS above simply does not apply to the shared
 * case. Do not "fix" this value back down to match it.
 */
// LUM-758 (×10): 20 → 35 分钟。cap-5 的 huntTimeBudgetMs 现在是 28 分钟，
// 再加克隆/attach 与规划步；平台上限是 45 分钟（Hobby，Pro/Enterprise 更高），
// 所以 35 分钟在任何档位上都是合法值。budget-arithmetic 钉住「沙箱活得比它要
// 跑的 hunt 久」，否则 VM 会在任务跑完之前被回收。
export const SANDBOX_TIMEOUT_WITH_HUNT_MS = 35 * 60 * 1000
/** Same cap as the ingest path's raw (post-gunzip) SARIF size. */
export const MANAGED_REPORT_MAX_BYTES = 400 * 1024 * 1024
/**
 * How much of a failure reason survives onto `PrSecurityScan.error`, enforced
 * in `security-sarif-ingest.service.ts` (500 with the `external: ` prefix).
 * Named here because the per-tool detail budget is derived from it: three
 * tools failing at once must still each get their cause across, and the cause
 * lives at the TAIL, so an overflow silently eats the last tool's.
 */
export const MANAGED_FAILURE_REASON_CHARS = 480

export const MANAGED_SCAN_TOOLS = [
  'gitleaks',
  'semgrep',
  'osv-scanner',
  'zizmor',
  'trivy',
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
  /**
   * LUM-758 — when true this run does **not** stop its VM once the tools are
   * done; it leaves it alive for the hunt to attach to. Stage A knows this
   * when it starts the run, so it passes it in rather than making the managed
   * scan read `stages.hunt` back off the scan row (a backwards dependency).
   *
   * Nobody stops a shared VM on purpose (see `stopHuntSandbox`): the hunt
   * must not stop a VM it merely attached to — the two workflows have no
   * ordering guarantee, so that would kill semgrep mid-run. The release path
   * is the VM's own `SANDBOX_TIMEOUT_WITH_HUNT_MS`, and nothing else worth
   * counting on: LUM-745's sweep and supersede are row-driven, and the
   * `killRun` they call no-ops on a row without a `managedRunId`, while
   * `EXTERNAL_PENDING_DEAD_MS` (45 minutes) is longer than the timeout
   * anyway. That bound is a hard platform one, so the cost is bounded.
   */
  huntWanted: boolean
}

/**
 * LUM-738 — one tool's outcome in the managed run. `skipped` is a tool that
 * had nothing to scan (osv-scanner: no package sources at all; LUM-846
 * zizmor: no workflows or actions) — a fact, not a failure, so the layer
 * reads SKIPPED rather than FAILED.
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
 * LUM-852 — the hosts a scanner still needs AFTER it is installed, i.e. while
 * it is reading repository-controlled config. Everything else is cut for that
 * phase: semgrep fetches its registry packs, osv-scanner matches packages
 * against osv.dev (and resolves some ecosystems through deps.dev). gitleaks
 * and zizmor need nothing; trivy's check bundle is fetched during install and
 * the scan runs with `--skip-check-update`.
 */
export const SCAN_EGRESS_ALLOWLIST: readonly string[] = [
  'semgrep.dev',
  'api.osv.dev',
  'api.deps.dev',
]

/**
 * LUM-852 — written by the managed scan, as its very last act on a VM the
 * hunt is going to reuse: after the credential scrub, after every scanner,
 * after it has set the VM to deny-all. The hunt does not hand an attached VM
 * to its agent before this file exists (see `attachOrCreateHuntSandbox`).
 */
export const MANAGED_SCAN_DONE_PATH = '/tmp/.lumo-managed-scan-done'
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
 * Kill switch: managed scanning is on unless LUMO_MANAGED_SCAN is exactly "off"
 * — or (LUM-1025) Vercel Sandbox is not configured on this deployment, since
 * every managed run (and the default-branch baseline) boots a sandbox VM.
 *
 * The parameter is a plain string map rather than `NodeJS.ProcessEnv`: Next.js
 * augments that type with a required `NODE_ENV`, so a caller (a test) could not
 * pass a bare `{ LUMO_MANAGED_SCAN: 'off' }`. `process.env` is assignable here.
 */
export function isManagedScanEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    env.LUMO_MANAGED_SCAN !== 'off' &&
    isIntegrationConfigured('vercelSandbox', env)
  )
}
