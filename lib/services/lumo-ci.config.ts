/**
 * LUM-746 — constants, the kill switch, env parsing and the shared types of
 * the Lumo-managed CI run (typecheck + test in a Vercel Sandbox, written
 * back as independent GateSignal rows). Deliberately import-light, like
 * `security-managed-scan.config.ts`: this module is consumed by the
 * `'use workflow'` orchestrator (`lib/workflows/lumo-ci.ts`) and by the
 * webhook-side request path, neither of which may pull in `@vercel/sandbox`
 * or the GitHub integration. Anything needing those lives in
 * `lumo-ci.service.ts`.
 */

/** The two execution gates a managed CI run produces (shared/src/gate-map GateKey). */
export const LUMO_CI_CHECKS = ['typecheck', 'test'] as const
export type LumoCiCheck = (typeof LUMO_CI_CHECKS)[number]

/** `GateSignal.source` for rows this run writes. */
export const LUMO_CI_SOURCE = 'lumo_sandbox' as const
/** `GateSignal.checkName` prefix — `lumo/ci typecheck`, `lumo/ci test`. */
export const LUMO_CI_CHECK_NAME_PREFIX = 'lumo/ci'

/**
 * The Vercel Sandbox tag key that ties a VM to its run row;
 * `stopRepoSandboxesByTag({ [LUMO_CI_SANDBOX_TAG]: ciRunId })` finds it from
 * outside the step that created it (supersede).
 */
export const LUMO_CI_SANDBOX_TAG = 'lumoCi'
export const LUMO_CI_SANDBOX_IMAGE = 'vercel/sandbox/universal'
/**
 * 4 vCPU = 8 GB: `tsc --noEmit` over this repo peaks at ~3.3 GB RSS (the
 * deleted ci.yml's note) and jest runs three workers beside it.
 */
export const LUMO_CI_SANDBOX_VCPUS = 4
/**
 * The VM outlives several workflow steps (prepare → typecheck → test
 * shards); each step's function is capped at 800 s, the VM is not.
 */
export const LUMO_CI_SANDBOX_TIMEOUT_MS = 30 * 60 * 1000
/** Per-command kill (SIGKILL) — below the 800 s Fluid cap of the hosting step. */
export const LUMO_CI_COMMAND_TIMEOUT_MS = 12 * 60 * 1000
/** Heap for tsc (MB); the runner default aborts with "heap out of memory". */
export const LUMO_CI_TSC_HEAP_MB = 6144

export const MANAGED_CI_HOURLY_CAP_DEFAULT = 10
export const MANAGED_CI_HOURLY_WINDOW_MS = 60 * 60 * 1000
export const JEST_SHARDS_DEFAULT = 2
const JEST_SHARDS_MAX = 8

type Env = Record<string, string | undefined>

/** Kill switch: managed CI is on unless LUMO_MANAGED_CI is exactly "off". */
export function isManagedCiEnabled(env: Env = process.env): boolean {
  return env.LUMO_MANAGED_CI !== 'off'
}

function positiveInt(
  raw: string | undefined,
  fallback: number,
  max = Infinity
) {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 && n <= max ? n : fallback
}

/** `LUMO_MANAGED_CI_HOURLY_CAP`: a positive integer, else the default. */
export function managedCiHourlyCap(env: Env = process.env): number {
  return positiveInt(
    env.LUMO_MANAGED_CI_HOURLY_CAP,
    MANAGED_CI_HOURLY_CAP_DEFAULT
  )
}

/** `LUMO_CI_JEST_SHARDS`: 1..8, else the default (2). */
export function jestShardCount(env: Env = process.env): number {
  return positiveInt(
    env.LUMO_CI_JEST_SHARDS,
    JEST_SHARDS_DEFAULT,
    JEST_SHARDS_MAX
  )
}

/**
 * Characters allowed in a jest `--testPathIgnorePatterns` value. The
 * pattern is interpolated into a shell script inside the sandbox, so anything
 * that could break out of its quoting is dropped outright, never escaped.
 */
const SAFE_PATTERN_RE = /^[A-Za-z0-9_./\\*+?()[\]|^$-]+$/

/** `LUMO_CI_JEST_IGNORE`: comma-separated test path patterns to exclude. */
export function jestIgnorePatterns(env: Env = process.env): string[] {
  const raw = env.LUMO_CI_JEST_IGNORE
  if (!raw) return []
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0 && SAFE_PATTERN_RE.test(s))
}

/** Row status of `LumoCiRun`. */
export type LumoCiRunStatus = 'PENDING' | 'DONE' | 'FAILED' | 'SUPERSEDED'

/** Everything the workflow needs; persisted as the run's input by the platform. */
export interface LumoCiJob {
  /** `LumoCiRun.id` */
  ciRunId: string
  workspaceId: string
  taskId: string
  pullRequestId: string
  /** `owner/repo` */
  repo: string
  prNumber: number
  headSha: string
}

/** The VM one run's steps share. */
export interface CiSandboxRef {
  name: string
  /** Absolute path of the checkout inside the VM. */
  cwd: string
}

/**
 * One command's outcome. `ran` carries the command's own exit code (a
 * gate verdict); `failed` is the harness — sha guard, kill on timeout, a
 * lost VM — and never becomes a gate signal.
 */
export type CiCheckResult =
  | { kind: 'ran'; exitCode: number }
  | { kind: 'failed'; reason: string }

export interface CiCheckSpec {
  check: LumoCiCheck
  /** 1-based jest shard; absent for typecheck / single-shard. */
  shard?: { index: number; total: number }
}

/**
 * Fold the per-shard jest results into one `test` verdict. Every shard must
 * have RUN for a verdict to exist: a shard the harness lost says nothing
 * about the tests it would have run, so the whole check is a harness
 * failure — even when another shard did find failing tests (P9: never
 * report a partial run as a full verdict). When all ran, the exit code is
 * the first non-zero one (jest exits 1 on failures).
 */
export function aggregateShardResults(
  shards: readonly CiCheckResult[]
): CiCheckResult {
  if (shards.length === 0) return { kind: 'failed', reason: 'no shards ran' }
  for (const [i, shard] of shards.entries()) {
    if (shard.kind === 'failed') {
      return {
        kind: 'failed',
        reason: `shard ${i + 1}/${shards.length}: ${shard.reason}`,
      }
    }
  }
  const failing = shards.find(s => s.kind === 'ran' && s.exitCode !== 0)
  return {
    kind: 'ran',
    exitCode: failing?.kind === 'ran' ? failing.exitCode : 0,
  }
}
