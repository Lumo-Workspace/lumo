/**
 * LUM-746 — the sandbox side of the Lumo-managed CI run: boot one Vercel
 * Sandbox at a PR head sha, install + generate + build the shared package,
 * then run `tsc --noEmit` and sharded `jest --ci` in it, each as its own
 * workflow step reconnecting to the same VM by name. Everything
 * secret-bearing (the installation token, the clone) stays inside this
 * module; what leaves is an exit code or a harness reason.
 *
 * Retry contract (same as the managed scan): sandbox creation / a command
 * transport error throws (scrubbed) so the step retries; a command's own
 * exit code is returned as a value. A lost VM on reconnect is returned as
 * `failed` rather than thrown — no retry can bring the VM back.
 *
 * Verdict vs harness: `{ kind: 'ran', exitCode }` is the tool's own verdict
 * and becomes a GateSignal; `{ kind: 'failed', reason }` is the harness
 * (sha guard, SIGKILL on timeout, lost VM) and never does (P9).
 */
import { logger } from '@/lib/logger'
import {
  createRepoSandbox,
  getRepoSandbox,
  repoCheckoutDir,
  stopRepoSandboxesByTag,
  type RepoSandbox,
} from '@/lib/integrations/vercel-sandbox'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import {
  LUMO_CI_COMMAND_TIMEOUT_MS,
  LUMO_CI_SANDBOX_IMAGE,
  LUMO_CI_SANDBOX_TAG,
  LUMO_CI_SANDBOX_TIMEOUT_MS,
  LUMO_CI_SANDBOX_VCPUS,
  LUMO_CI_TSC_HEAP_MB,
  jestIgnorePatterns,
  type CiCheckResult,
  type CiCheckSpec,
  type CiSandboxRef,
  type LumoCiJob,
} from './lumo-ci.config'

export type PrepareResult =
  | { kind: 'ready'; sandbox: CiSandboxRef }
  | { kind: 'failed'; reason: string }

/** `headSha` is interpolated into a shell script — validated before any VM exists. */
const HEAD_SHA_RE = /^[0-9a-f]{7,40}$/
/** The sha guard's own exit code (a normal exit that no tool here produces). */
const GUARD_EXIT = 90
/** SIGKILL — the SDK's `timeoutMs` kill, or the kernel OOM killer. */
const KILLED_EXIT = 137

/** Every string that leaves this module passes through here (P8). */
function scrubToken(message: string, token: string): string {
  return token ? message.split(token).join('***') : message
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Strips CR/LF and caps length before a caller-supplied string reaches a log line. */
function logSafe(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').slice(0, 200)
}

/**
 * Proves the directory is exactly `headSha` before anything runs; exits 90
 * otherwise (a mis-rooted or wrong-revision VM must never produce a verdict).
 */
function guard(headSha: string): string {
  return `test "$(git rev-parse HEAD 2>/dev/null | cut -c1-${headSha.length})" = "${headSha}" || exit ${GUARD_EXIT}; `
}

const PREPARE_SCRIPT =
  'set -e; npm ci --no-audit --no-fund; npx prisma generate; npm run build:shared'

const BASE_ENV = { CI: 'true', HUSKY: '0' }

function scriptFor(spec: CiCheckSpec): {
  script: string
  env: Record<string, string>
} {
  if (spec.check === 'typecheck') {
    return {
      script: 'npx tsc --noEmit',
      env: {
        ...BASE_ENV,
        NODE_OPTIONS: `--max-old-space-size=${LUMO_CI_TSC_HEAP_MB}`,
      },
    }
  }
  const shard = spec.shard
    ? ` --shard=${spec.shard.index}/${spec.shard.total}`
    : ''
  // Patterns are validated against a safe character set (no quotes, no
  // whitespace, no `;`/`$`), so single-quoting them is sufficient.
  const ignores = jestIgnorePatterns()
    .map(p => ` --testPathIgnorePatterns '${p}'`)
    .join('')
  return { script: `npx jest --ci${shard}${ignores}`, env: BASE_ENV }
}

function checkLabel(spec: CiCheckSpec): string {
  return spec.shard
    ? `${spec.check} ${spec.shard.index}/${spec.shard.total}`
    : spec.check
}

async function stopQuietly(sandbox: RepoSandbox, label: string): Promise<void> {
  try {
    await sandbox.stop()
  } catch (error) {
    logger.warn(
      `[lumo-ci] sandbox stop failed ${label}: ${logSafe(message(error))}`
    )
  }
}

export const lumoCiService = {
  /**
   * Boot the VM and make the checkout runnable. Deterministic failures
   * (guard, install exit) stop the VM and return `failed`; transport
   * failures throw for the platform retry.
   */
  async prepare(job: LumoCiJob): Promise<PrepareResult> {
    if (!HEAD_SHA_RE.test(job.headSha)) {
      return { kind: 'failed', reason: 'invalid head sha' }
    }
    const label = `${logSafe(job.repo)}#${job.prNumber} run=${job.ciRunId}`
    // A retry of this step must not leave the previous attempt's VM billing.
    try {
      await stopRepoSandboxesByTag({ [LUMO_CI_SANDBOX_TAG]: job.ciRunId })
    } catch (error) {
      logger.warn(
        `[lumo-ci] pre-create tag stop failed ${label}: ${logSafe(message(error))}`
      )
    }
    const token = await getGithubInstallationToken(job.workspaceId)
    let sandbox: RepoSandbox
    try {
      sandbox = await createRepoSandbox({
        repository: job.repo,
        revision: job.headSha,
        token,
        timeoutMs: LUMO_CI_SANDBOX_TIMEOUT_MS,
        vcpus: LUMO_CI_SANDBOX_VCPUS,
        image: LUMO_CI_SANDBOX_IMAGE,
        tags: { [LUMO_CI_SANDBOX_TAG]: job.ciRunId },
      })
    } catch (error) {
      // Transient by default (retry); the SDK may echo the clone URL.
      throw new Error(scrubToken(message(error), token))
    }
    const cwd = repoCheckoutDir(sandbox.cwd, job.repo)
    let result
    try {
      result = await sandbox.run(
        'sh',
        ['-c', guard(job.headSha) + PREPARE_SCRIPT],
        {
          cwd,
          env: BASE_ENV,
          timeoutMs: LUMO_CI_COMMAND_TIMEOUT_MS,
        }
      )
    } catch (error) {
      await stopQuietly(sandbox, label)
      throw new Error(scrubToken(message(error), token))
    }
    if (result.exitCode === GUARD_EXIT) {
      await stopQuietly(sandbox, label)
      return { kind: 'failed', reason: 'prepare: checkout is not the head sha' }
    }
    if (result.exitCode !== 0) {
      logger.warn(
        `[lumo-ci] prepare exit ${result.exitCode} ${label}: ${logSafe(scrubToken(result.stderr, token))}`
      )
      await stopQuietly(sandbox, label)
      return { kind: 'failed', reason: `prepare exit ${result.exitCode}` }
    }
    logger.info(`[lumo-ci] prepared ${label} sandbox=${sandbox.name}`)
    return { kind: 'ready', sandbox: { name: sandbox.name, cwd } }
  },

  /**
   * One check (or one jest shard) in the prepared VM. Reconnects by name;
   * the VM stays up for the next step — `stop` is the workflow's job.
   */
  async runCheck(input: {
    sandbox: CiSandboxRef
    headSha: string
    spec: CiCheckSpec
  }): Promise<CiCheckResult> {
    const label = checkLabel(input.spec)
    if (!HEAD_SHA_RE.test(input.headSha)) {
      return { kind: 'failed', reason: 'invalid head sha' }
    }
    let sandbox: RepoSandbox
    try {
      sandbox = await getRepoSandbox({ name: input.sandbox.name })
    } catch (error) {
      return {
        kind: 'failed',
        reason: `sandbox unreachable: ${logSafe(message(error))}`,
      }
    }
    const { script, env } = scriptFor(input.spec)
    const result = await sandbox.run(
      'sh',
      ['-c', guard(input.headSha) + script],
      {
        cwd: input.sandbox.cwd,
        env,
        timeoutMs: LUMO_CI_COMMAND_TIMEOUT_MS,
      }
    )
    if (result.exitCode === GUARD_EXIT) {
      return { kind: 'failed', reason: 'checkout is not the head sha' }
    }
    if (result.exitCode === KILLED_EXIT) {
      logger.warn(`[lumo-ci] ${label} killed sandbox=${input.sandbox.name}`)
      return {
        kind: 'failed',
        reason: `killed (exit ${KILLED_EXIT}) — timeout or out of memory`,
      }
    }
    logger.info(
      `[lumo-ci] ${label} exit ${result.exitCode} sandbox=${input.sandbox.name}`
    )
    return { kind: 'ran', exitCode: result.exitCode }
  },

  /** Best-effort: the VM times out on its own; this just stops the bill early. */
  async stop(sandbox: CiSandboxRef): Promise<void> {
    try {
      const vm = await getRepoSandbox({ name: sandbox.name })
      await vm.stop()
    } catch (error) {
      logger.warn(
        `[lumo-ci] stop failed sandbox=${sandbox.name}: ${logSafe(message(error))}`
      )
    }
  },
}
