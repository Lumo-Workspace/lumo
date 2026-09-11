/**
 * LUM-758 §5 — the hunt's sandbox layer. Three jobs: get hold of a usable VM
 * (preferring the one the managed scan already booted), make sure the GitHub
 * installation token is not lying around inside it, and run ONE restricted
 * read-only command in it.
 *
 * Data boundary (spec R6): the installation token only ever appears as an
 * argument to `createRepoSandbox`. Command output is scrubbed of the token and
 * run through `redactKnownSecrets` before it is returned, so a caller handing
 * it to a model does not have to think about it.
 *
 * That scrub is exact-match, and the allowlisted tools (`sed`, `rg`, …) can
 * transform text — so it cannot be the only defence. The load-bearing one is
 * `scrubCloneCredentials`: the token is removed from the checkout before the
 * agent gets to run anything, and the layer fails closed if it cannot be.
 */
import { logger } from '@/lib/logger'
import {
  createRepoSandbox,
  denySandboxEgress,
  findRepoSandboxByTag,
  repoCheckoutDir,
  type RepoSandbox,
} from '@/lib/integrations/vercel-sandbox'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import { redactKnownSecrets } from '@/lib/security-scan'
import { checkHuntCommand } from '@/lib/security-scan/hunt/shell-allowlist'
import {
  SANDBOX_IMAGE,
  SANDBOX_SCAN_TAG,
  SANDBOX_TIMEOUT_WITH_HUNT_MS,
  SANDBOX_VCPUS,
} from './security-managed-scan.config'
import {
  HUNT_SANDBOX_ATTACH_POLL_MS,
  HUNT_SANDBOX_ATTACH_WAIT_MS,
  HUNT_SHELL_OUTPUT_MAX,
} from './security-hunt.config'

/**
 * Tag key marking a VM the hunt booted itself, so "who paid for this VM" is
 * answerable after the fact. It is applied IN ADDITION to `lumoScan`, never
 * instead of it — see the tags comment in `create`.
 */
export const HUNT_SANDBOX_TAG = 'lumoHunt'
/** Wall-clock ceiling for one command — no single grep should need longer. */
const SHELL_TIMEOUT_MS = 20_000
/** Setup commands (the credential scrub, the env probe) are ours, not the agent's. */
const SETUP_TIMEOUT_MS = 15_000
const TRUNCATION_NOTE = '\n…(truncated)'

export interface AttachInput {
  scanId: string
  workspaceId: string
  /** `owner/repo` */
  repo: string
  headSha: string
  /** See `HuntJob.managedScanStarted`: false means do not bother polling. */
  managedScanStarted: boolean
  /** Test seam; defaults to HUNT_SANDBOX_ATTACH_POLL_MS. */
  pollMs?: number
}

export interface HuntSandbox {
  sandbox: RepoSandbox
  /** The checkout directory, NOT the session cwd (the clone is one level in). */
  cwd: string
  token: string
  origin: 'attached' | 'created'
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Reuse the managed scan's VM when one is alive for this scan, otherwise boot
 * one. Sharing is an optimisation and never a precondition: the managed scan
 * legitimately does not run in four situations (§2), so the create path is a
 * first-class path, not a fallback for bugs.
 */
export async function attachOrCreateHuntSandbox(
  input: AttachInput
): Promise<HuntSandbox> {
  // The signature takes only a workspaceId (`lib/integrations/github/auth.ts`).
  const token = await getGithubInstallationToken(input.workspaceId)
  const tag = { [SANDBOX_SCAN_TAG]: input.scanId }
  const pollMs = input.pollMs ?? HUNT_SANDBOX_ATTACH_POLL_MS

  let attached = await findRepoSandboxByTag(tag)
  // The managed scan started a few milliseconds before us, so its VM may not
  // be listed yet — wait a little. If it never started, waiting cannot help.
  if (!attached && input.managedScanStarted) {
    const deadline = Date.now() + HUNT_SANDBOX_ATTACH_WAIT_MS
    while (!attached && Date.now() < deadline) {
      await sleep(pollMs)
      attached = await findRepoSandboxByTag(tag)
    }
  }

  const handle: HuntSandbox = attached
    ? {
        sandbox: attached,
        cwd: repoCheckoutDir(attached.cwd, input.repo),
        token,
        origin: 'attached',
      }
    : await create(input, token)

  try {
    await scrubCloneCredentials(handle, input.repo)
  } catch (error) {
    // A VM we booted and then refused to use must not be left to run out its
    // 20 minutes. (An attached one is not ours to stop — see stopHuntSandbox.)
    await stopHuntSandbox(handle)
    throw error
  }
  return handle
}

async function create(input: AttachInput, token: string): Promise<HuntSandbox> {
  const sandbox = await createRepoSandbox({
    repository: input.repo,
    revision: input.headSha,
    token,
    timeoutMs: SANDBOX_TIMEOUT_WITH_HUNT_MS,
    vcpus: SANDBOX_VCPUS,
    image: SANDBOX_IMAGE,
    // BOTH tags on purpose. `lumoHunt` says who booted it (so the two can be
    // swept apart), and `lumoScan` puts it inside LUM-745's existing ops
    // closure — the 15-minute sweep and supersede-by-tag both filter on that
    // key, so without it the hunt's own VM would have the 20-minute timeout
    // as its only backstop.
    tags: {
      [HUNT_SANDBOX_TAG]: input.scanId,
      [SANDBOX_SCAN_TAG]: input.scanId,
    },
  })
  // The clone is done; the agent reads a local checkout and needs no route
  // out. Best-effort: the command gate is what actually enforces this, so a
  // platform that will not take the policy must not fail the layer.
  try {
    await denySandboxEgress(sandbox.name)
  } catch (error) {
    logger.warn(
      `[security-hunt] egress lockdown failed scan=${input.scanId}: ${short(error)}`
    )
  }
  return {
    sandbox,
    cwd: repoCheckoutDir(sandbox.cwd, input.repo),
    token,
    origin: 'created',
  }
}

/**
 * LUM-758 (R6) — the token must not be readable from inside the VM.
 *
 * `cat .git/config` is, and will remain, an allowed command: the allowlisted
 * tools exist precisely so the agent can read the repo. So the command gate
 * cannot be what keeps the installation token out of the model's transcript —
 * the token has to not be there. The clone happens server-side inside
 * `Sandbox.create`, so whether it embeds the credential in the remote URL is
 * not knowable from our side: this checks at runtime instead of trusting a
 * comment, rewrites the remote if it does, and **fails closed** if the token
 * is still readable afterwards. A hunt that cannot honour R6 must not run.
 *
 * Applies to an attached VM too — the managed scan cloned it with the same
 * token. Rewriting the remote is local config only; no tool in either
 * workflow fetches.
 */
export async function scrubCloneCredentials(
  handle: HuntSandbox,
  repo: string
): Promise<void> {
  const { sandbox, cwd, token } = handle
  if (!token) return

  if (await gitConfigHasToken(sandbox, cwd, token)) {
    await run(
      sandbox,
      'git',
      ['remote', 'set-url', 'origin', `https://github.com/${repo}.git`],
      cwd
    )
    // `credential.helper store` would have parked it here as well.
    await run(
      sandbox,
      'git',
      ['config', '--local', '--unset-all', 'http.extraheader'],
      cwd
    )
    if (await gitConfigHasToken(sandbox, cwd, token)) {
      logger.error(
        `[security-hunt] installation token still reachable in ${cwd}/.git/config after scrub`
      )
      throw new Error(
        'installation token still reachable in the checkout after scrubbing'
      )
    }
  }

  // The other half of the question: does the command environment carry it?
  // We never pass `env` to `Sandbox.create`, so it should not — but "should
  // not" is not a control, and unlike the git config there is nothing we
  // could strip. Fail closed and let the layer read FAILED (P9). An
  // inconclusive probe (`env` itself would not run) counts as a failure: an
  // unverified boundary is not a boundary.
  const probe = await sandbox.run('env', [], {
    cwd,
    timeoutMs: SETUP_TIMEOUT_MS,
  })
  if (probe.exitCode !== 0) {
    logger.error(
      `[security-hunt] could not read the sandbox environment (exit ${probe.exitCode}); refusing to run the agent`
    )
    throw new Error('could not verify the sandbox command environment')
  }
  const env = `${probe.stdout ?? ''}${probe.stderr ?? ''}`
  if (env.includes(token)) {
    logger.error(
      '[security-hunt] installation token is visible in the sandbox command environment; refusing to run the agent'
    )
    throw new Error(
      'installation token is visible in the sandbox command environment'
    )
  }
}

async function gitConfigHasToken(
  sandbox: RepoSandbox,
  cwd: string,
  token: string
): Promise<boolean> {
  let bytes: Buffer | null | undefined
  try {
    bytes = await sandbox.readFile(`${cwd}/.git/config`)
  } catch (error) {
    // A checkout we cannot read is not a checkout we can clear — fail closed.
    logger.error(`[security-hunt] .git/config unreadable: ${short(error)}`)
    throw new Error('could not read the checkout git config')
  }
  return bytes ? bytes.toString('utf8').includes(token) : false
}

async function run(
  sandbox: RepoSandbox,
  cmd: string,
  args: string[],
  cwd: string
): Promise<string> {
  const result = await sandbox.run(cmd, args, {
    cwd,
    timeoutMs: SETUP_TIMEOUT_MS,
  })
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

/**
 * LUM-758 (user decision, 2026-09-10) — the hunt stops only a VM it created
 * itself. This LOOKS like a leak and reviewers have flagged it twice: it is
 * deliberate. Stopping a VM we merely attached to would kill semgrep mid-run,
 * because the managed scan and the hunt have no ordering guarantee between
 * them. Nobody stops a shared VM; it is released by the three existing
 * backstops — the VM's own `SANDBOX_TIMEOUT_WITH_HUNT_MS`, LUM-745's
 * 15-minute cron sweep, and supersede-by-tag. Do not "fix" this.
 *
 * Never throws: a VM that is already gone is the outcome we wanted.
 */
export async function stopHuntSandbox(handle: HuntSandbox): Promise<void> {
  if (handle.origin !== 'created') return
  try {
    await handle.sandbox.stop()
  } catch (error) {
    logger.warn(`[security-hunt] sandbox stop failed: ${short(error)}`)
  }
}

export interface HuntShellInput {
  sandbox: RepoSandbox
  cwd: string
  token: string
  command: string
}

export interface HuntShellOutput {
  /** Already scrubbed, redacted and truncated — safe to hand to a model. */
  output: string
  /** Set when the command never ran (denied) or the sandbox itself failed. */
  error?: string
}

/**
 * Run one gated command. A denied command does NOT touch the sandbox — the
 * reason goes back to the model so it can correct itself.
 */
export async function runHuntShell(
  input: HuntShellInput
): Promise<HuntShellOutput> {
  const check = checkHuntCommand(input.command)
  if (!check.ok) return { output: '', error: check.reason }

  let raw: string
  try {
    const result = await input.sandbox.run('sh', ['-c', input.command], {
      cwd: input.cwd,
      timeoutMs: SHELL_TIMEOUT_MS,
    })
    // grep/rg exiting 1 on "no match" is a fact, not a failure — both streams
    // go to the model either way.
    raw = `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ''}`
  } catch (error) {
    logger.warn(
      `[security-hunt] shell failed: ${scrub(short(error), input.token)}`
    )
    return { output: '', error: 'command failed' }
  }
  return { output: sanitizeHuntOutput(raw, input.token) }
}

/**
 * token scrub → known-secret redaction → truncation. The order is fixed
 * (§6.2): truncating first could cut a secret in half and leave a fragment no
 * pattern matches any more.
 *
 * Redaction is per LINE, not over the whole blob: `redactKnownSecrets` is a
 * line-level sanitizer that drops everything past its own 5 000-character cap,
 * so handing it 8 000 characters of legitimate grep output would silently
 * throw away three eighths of the answer.
 */
export function sanitizeHuntOutput(raw: string, token: string): string {
  const redacted = scrub(raw, token)
    .split('\n')
    .map(redactKnownSecrets)
    .join('\n')
  return redacted.length <= HUNT_SHELL_OUTPUT_MAX
    ? redacted
    : `${redacted.slice(0, HUNT_SHELL_OUTPUT_MAX - TRUNCATION_NOTE.length)}${TRUNCATION_NOTE}`
}

/**
 * Blind string replacement, so a degenerate "token" must not be allowed to
 * shred the output: a one-character token would replace every occurrence of
 * that letter and hand the model nonsense. A GitHub installation token is
 * `ghs_` + 36 characters, so anything under this length is not one, and not
 * scrubbing it costs nothing.
 */
const MIN_SCRUBBABLE_TOKEN = 8

function scrub(text: string, token: string): string {
  return token.length >= MIN_SCRUBBABLE_TOKEN
    ? text.split(token).join('[redacted]')
    : text
}

function short(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200)
}
