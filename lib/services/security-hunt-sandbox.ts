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
 * `scrubCloneCredentials`: every place the credential could plausibly be
 * readable from inside the VM is read back before the agent runs anything,
 * and the layer fails closed when it cannot prove the token is gone — a
 * checkout that has not landed yet included.
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
import {
  checkHuntCommand,
  HUNT_SHELL_BIN,
  HUNT_SHELL_FLAG,
} from '@/lib/security-scan/hunt/shell-allowlist'
import {
  SANDBOX_IMAGE,
  SANDBOX_SCAN_TAG,
  SANDBOX_TIMEOUT_WITH_HUNT_MS,
  SANDBOX_VCPUS,
} from './security-managed-scan.config'
import {
  HUNT_CHECKOUT_POLL_MS,
  HUNT_CHECKOUT_WAIT_MS,
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
  /** Test seam; defaults to HUNT_CHECKOUT_WAIT_MS. */
  checkoutWaitMs?: number
}

export interface HuntSandbox {
  sandbox: RepoSandbox
  /** The checkout directory, NOT the session cwd (the clone is one level in). */
  cwd: string
  token: string
  origin: 'attached' | 'created'
  /**
   * Did this VM's network egress actually get cut? False for an attached VM
   * (its policy belongs to the managed scan, which may still be downloading
   * scanners) and for a created one whose policy update the platform refused.
   * Carried on the handle so the caller — and `huntAudit` — can record that a
   * run executed with egress open, instead of that fact living only in a warn
   * log nobody joins back to the scan.
   */
  egressDenied: boolean
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
        // Never touched for an attached VM — see `denySandboxEgress`. The
        // handle says so rather than leaving the caller to infer it.
        egressDenied: false,
      }
    : await create(input, token)

  try {
    await scrubCloneCredentials(handle, input.repo, {
      ...(input.checkoutWaitMs === undefined
        ? {}
        : { waitMs: input.checkoutWaitMs }),
      ...(input.pollMs === undefined ? {} : { pollMs: input.pollMs }),
    })
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
    // BOTH tags on purpose, but NOT because `lumoScan` buys a backstop.
    // `lumoHunt` says who booted it (so the two can be told apart after the
    // fact); `lumoScan` is what `killRun` stops VMs by, which helps only when
    // the scan row carries a `managedRunId`. In this path's primary case the
    // managed scan never ran, so the row has none and neither
    // `sweepStalePending` nor `supersedeOlderRuns` — both row-driven, not tag
    // scans — ever reaches this VM. The effective backstop is the VM's own
    // `SANDBOX_TIMEOUT_WITH_HUNT_MS`; see `stopHuntSandbox`.
    tags: {
      [HUNT_SANDBOX_TAG]: input.scanId,
      [SANDBOX_SCAN_TAG]: input.scanId,
    },
  })
  // The clone is done; the agent reads a local checkout and needs no route
  // out. Best-effort: the command gate is what actually enforces this, so a
  // platform that will not take the policy must not fail the layer — but the
  // outcome is carried on the handle, not just warned about.
  let egressDenied = false
  try {
    await denySandboxEgress(sandbox.name)
    egressDenied = true
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
    egressDenied,
  }
}

/**
 * Credential stores git consults out of `$HOME`, checked in this order.
 * `.git-credentials` is where `credential.helper store` writes; `.netrc` is
 * git's other on-disk store; a GLOBAL `.gitconfig` can carry an
 * `http.extraHeader` or a `url.<https://x-access-token:…@…>.insteadOf`, and
 * neither is visible to a `--local --unset-all` or to the `.git/config`
 * read-back.
 */
const HOME_CREDENTIAL_FILES = ['.git-credentials', '.netrc', '.gitconfig']

/** Options of `scrubCloneCredentials`; both are test seams. */
export interface ScrubOptions {
  /** How long to wait for the checkout; defaults to HUNT_CHECKOUT_WAIT_MS. */
  waitMs?: number
  /** How often to look; defaults to HUNT_CHECKOUT_POLL_MS. */
  pollMs?: number
}

/**
 * LUM-758 (R6) — the token must not be readable from inside the VM.
 *
 * `cat .git/config` is, and will remain, an allowed command: the allowlisted
 * tools exist precisely so the agent can read the repo, and the gate only
 * constrains the command NAME — `cat` takes any path in the VM. So the gate
 * cannot be what keeps the installation token out of the model's transcript —
 * the token has to not be there. The clone happens server-side inside
 * `Sandbox.create`, so what it leaves behind is not knowable from our side:
 * this proves it at runtime instead of trusting a comment, and **fails
 * closed** whenever it cannot.
 *
 * Five plausible locations, and what happens to each:
 *   1. `<checkout>/.git/config` — waited for, read back, rewritten, re-read.
 *   2. the command environment — probed (nothing to strip; refuse).
 *   3. `$HOME/.git-credentials`, 4. `$HOME/.netrc`, 5. `$HOME/.gitconfig` —
 *      read back in the same fail-closed loop, see HOME_CREDENTIAL_FILES.
 * Nobody claims the platform writes 3–5. The point of this function is that
 * it does not have to be claimed either way.
 *
 * `/proc/<pid>/environ` of OTHER processes is deliberately OUT of scope, and
 * that is a decision rather than an oversight. Neither this module nor the
 * managed scan ever passes `env` to `sandbox.run`, so no session process is
 * handed the token, and the one operation that does hold it — the clone —
 * runs server-side in `Sandbox.create`, before any process exists in the
 * session. Beyond that, a `/proc` sweep here would be a point-in-time sample:
 * it says nothing about processes started after it, which is every process
 * the agent goes on to run, so it could not be a control even if it found
 * nothing. The environment those commands actually inherit is exactly what
 * check 2 reads, and that one is verifiable.
 *
 * Applies to an attached VM too — the managed scan cloned it with the same
 * token. Rewriting the remote is local config only; no tool in either
 * workflow fetches.
 */
export async function scrubCloneCredentials(
  handle: HuntSandbox,
  repo: string,
  opts: ScrubOptions = {}
): Promise<void> {
  const { sandbox, cwd, token } = handle
  if (!token) return

  const configPath = `${cwd}/.git/config`
  if ((await waitForCheckoutConfig(handle, opts)).includes(token)) {
    await run(
      sandbox,
      'git',
      ['remote', 'set-url', 'origin', `https://github.com/${repo}.git`],
      cwd
    )
    // The local half of a `credential.helper store` / extraHeader setup. The
    // global half lives in `$HOME/.gitconfig` and is checked below.
    await run(
      sandbox,
      'git',
      ['config', '--local', '--unset-all', 'http.extraheader'],
      cwd
    )
    const after = await readSandboxFile(sandbox, configPath, token)
    // A config that vanished mid-scrub is not a config we cleared.
    if (!after || after.toString('utf8').includes(token)) {
      logger.error(
        `[security-hunt] installation token still reachable in ${configPath} after scrub`
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

  await assertHomeStoresAreClean(sandbox, homeDir(env, sandbox.cwd), token)
}

/**
 * Read `<checkout>/.git/config`, WAITING for it to appear.
 *
 * `findRepoSandboxByTag` accepts a `pending` VM on purpose and the attach
 * poll exists to grab the managed scan's VM as early as possible, so this
 * layer can legitimately be holding a VM whose clone has not landed yet. A
 * missing `.git/config` therefore does not mean "clean", it means "not yet" —
 * and a token-bearing config appears seconds later. In a function whose whole
 * contract is fail-closed, "no checkout" and "no token" must not be the same
 * answer: this waits for the file (the same reason `repoCheckoutDir`'s
 * callers prove the directory with a sha guard) and REFUSES if it never
 * shows up.
 */
async function waitForCheckoutConfig(
  handle: HuntSandbox,
  opts: ScrubOptions
): Promise<string> {
  const { sandbox, cwd, token } = handle
  const path = `${cwd}/.git/config`
  const pollMs = opts.pollMs ?? HUNT_CHECKOUT_POLL_MS
  const deadline = Date.now() + (opts.waitMs ?? HUNT_CHECKOUT_WAIT_MS)
  for (;;) {
    const bytes = await readSandboxFile(sandbox, path, token)
    if (bytes) return bytes.toString('utf8')
    if (Date.now() >= deadline) break
    await sleep(pollMs)
  }
  logger.error(
    `[security-hunt] no checkout at ${path} after waiting; refusing to run the agent`
  )
  throw new Error(
    'the sandbox checkout never appeared, so the installation token could not be ruled out'
  )
}

/**
 * Locations 3–5. Absence is the expected answer and is fine; presence WITH
 * the token is fatal, because unlike the checkout's remote URL there is
 * nothing here we could rewrite that the platform would not just be entitled
 * to have written on purpose. Only the path is ever logged — the point of
 * this loop is to find the token, not to copy it anywhere.
 */
async function assertHomeStoresAreClean(
  sandbox: RepoSandbox,
  home: string,
  token: string
): Promise<void> {
  for (const name of HOME_CREDENTIAL_FILES) {
    const path = `${home}/${name}`
    const bytes = await readSandboxFile(sandbox, path, token)
    if (bytes?.toString('utf8').includes(token)) {
      logger.error(
        `[security-hunt] installation token is readable at ${path}; refusing to run the agent`
      )
      throw new Error(`installation token is readable at ${path}`)
    }
  }
}

/**
 * `$HOME` as the VM itself reports it. Falls back to the session cwd, which
 * with the `universal` image IS the home directory (see `RepoSandbox.cwd`);
 * `handle.cwd` would be wrong here — that one is the checkout, one level in.
 */
function homeDir(env: string, sessionCwd: string): string {
  const home = /^HOME=(.*)$/m.exec(env)?.[1]?.trim()
  const dir = home?.startsWith('/') ? home : sessionCwd
  return dir.replace(/\/+$/, '')
}

/** null = the file is not there. A read that FAILS is fail-closed, not absent. */
async function readSandboxFile(
  sandbox: RepoSandbox,
  path: string,
  token: string
): Promise<Buffer | null> {
  try {
    return (await sandbox.readFile(path)) ?? null
  } catch (error) {
    logger.error(
      `[security-hunt] ${path} unreadable: ${scrub(short(error), token)}`
    )
    throw new Error(`could not read ${path} in the sandbox`)
  }
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
 * them. Do not "fix" this.
 *
 * What releases a VM nobody stops is the VM's own
 * `SANDBOX_TIMEOUT_WITH_HUNT_MS`, and in the case that matters that is the
 * ONLY thing that does. LUM-745's sweep and supersede are row-driven, not tag
 * scans: both select scan rows and call `killRun`, which returns immediately
 * when the row carries no `managedRunId` — precisely the create path's
 * primary case, where the managed scan never ran at all. Even where a
 * `managedRunId` does exist, `EXTERNAL_PENDING_DEAD_MS` is 45 minutes (15
 * minutes is the cron cadence, not the threshold), so the sweep would fire
 * ~25 minutes after the 20-minute timeout already reclaimed the VM. The
 * timeout is a hard platform bound, so the cost is bounded — but do not write
 * "the sweep will get it" down anywhere, because it will not.
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
  /**
   * The whole handle, never a loose `{ sandbox, cwd, token }`: the only way
   * to obtain one is `attachOrCreateHuntSandbox`, which does not return until
   * `scrubCloneCredentials` has passed. So "this VM was scrubbed" is a
   * property of the type, not of a caller remembering to do it.
   */
  handle: HuntSandbox
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
 *
 * Takes the `HuntSandbox` handle rather than its parts on purpose: a later
 * task cannot construct the input for a VM that never went through
 * `scrubCloneCredentials`, so the R6 guard is unskippable by construction
 * instead of by convention.
 */
export async function runHuntShell(
  input: HuntShellInput
): Promise<HuntShellOutput> {
  const check = checkHuntCommand(input.command)
  if (!check.ok) return { output: '', error: check.reason }

  const { sandbox, cwd, token } = input.handle
  let raw: string
  try {
    // THE choke point. `input.command` goes from `checkHuntCommand` (above) to
    // here untouched — no wrapping, no re-quoting, no interpolation — and the
    // shell is the one the gate's parsing was written and fuzzed against
    // (HUNT_SHELL_BIN / _FLAG live next to that parser for exactly this
    // reason). `__tests__/security-scan/hunt/shell-exec-boundary.test.ts`
    // fails if any of that changes.
    const result = await sandbox.run(
      HUNT_SHELL_BIN,
      [HUNT_SHELL_FLAG, input.command],
      {
        cwd,
        timeoutMs: SHELL_TIMEOUT_MS,
      }
    )
    // grep/rg exiting 1 on "no match" is a fact, not a failure — both streams
    // go to the model either way.
    raw = `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ''}`
  } catch (error) {
    logger.warn(`[security-hunt] shell failed: ${scrub(short(error), token)}`)
    return { output: '', error: 'command failed' }
  }
  return { output: sanitizeHuntOutput(raw, token) }
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
