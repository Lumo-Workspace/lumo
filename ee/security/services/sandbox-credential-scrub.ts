/**
 * LUM-758 (R6), shared since LUM-852 — prove the GitHub token a sandbox was
 * cloned with is not readable from inside it, before anything that reads the
 * checkout runs there. The hunt ran this from day one; the managed scan did
 * not, and its scanners read repository-controlled config (`.gitleaks.toml`,
 * `osv-scanner.toml`, `trivy.yaml` → repository Rego) — the 2025
 * scanner-config credential-leak class. Both now call `scrubSandboxCredentials` right after the clone.
 *
 * Every setup command here is a fixed argv, never `sh -c`: nothing
 * model- or repository-supplied reaches them.
 */
import { logger } from '@/lib/logger'
import type { RepoSandbox } from '@/ee/security/integrations/vercel-sandbox'
import {
  HUNT_CHECKOUT_POLL_MS,
  HUNT_CHECKOUT_WAIT_MS,
} from './security-hunt.config'

/** The three things the scrub needs: the VM, its checkout, the clone token. */
export interface ScrubTarget {
  sandbox: RepoSandbox
  /** The checkout directory, NOT the session cwd (the clone is one level in). */
  cwd: string
  /** The token the clone used; empty = nothing to look for. */
  token: string
}

/** Setup commands (the credential scrub, the env probe) are ours, not the agent's. */
const SETUP_TIMEOUT_MS = 15_000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

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
export async function scrubSandboxCredentials(
  handle: ScrubTarget,
  repo: string,
  opts: ScrubOptions = {}
): Promise<void> {
  const { sandbox, cwd, token } = handle
  if (!token) return

  const configPath = `${cwd}/.git/config`
  if (carriesToken(await waitForCheckoutConfig(handle, opts), token)) {
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
    if (!after || carriesToken(after.toString('utf8'), token)) {
      logger.error(
        `[sandbox-scrub] installation token still reachable in ${configPath} after scrub`
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
      `[sandbox-scrub] could not read the sandbox environment (exit ${probe.exitCode}); refusing to run anything against the checkout`
    )
    throw new Error('could not verify the sandbox command environment')
  }
  const env = `${probe.stdout ?? ''}${probe.stderr ?? ''}`
  if (carriesToken(env, token)) {
    logger.error(
      '[sandbox-scrub] installation token is visible in the sandbox command environment; refusing to run anything against the checkout'
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
  handle: ScrubTarget,
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
    `[sandbox-scrub] no checkout at ${path} after waiting; refusing to run anything against the checkout`
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
    if (bytes && carriesToken(bytes.toString('utf8'), token)) {
      logger.error(
        `[sandbox-scrub] installation token is readable at ${path}; refusing to run anything against the checkout`
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

/**
 * LUM-869 — does `text` carry `token`, verbatim OR base64-encoded? git's
 * `http.extraheader` holds `AUTHORIZATION: basic <base64("x-access-token:" +
 * token)>`, where the raw token never appears. Base64 of a substring depends
 * on its byte offset mod 3, so the token is encoded at all three alignments
 * and only the characters that depend on the token alone are kept: the
 * leading group that mixes in prefix bytes and the trailing group that mixes
 * in whatever follows are dropped.
 */
export function carriesToken(text: string, token: string): boolean {
  if (!token) return false
  if (text.includes(token)) return true
  return base64Needles(token).some(needle => text.includes(needle))
}

function base64Needles(token: string): string[] {
  const needles: string[] = []
  for (const shift of [0, 1, 2]) {
    const encoded = Buffer.from('\0'.repeat(shift) + token, 'utf8')
      .toString('base64')
      .replace(/=+$/, '')
    // Chars 4.. are token-only once the shift bytes sit in the first group.
    const start = shift === 0 ? 0 : 4
    const end = encoded.length - 4
    if (end - start >= MIN_SCRUBBABLE_TOKEN) {
      needles.push(encoded.slice(start, end))
    }
  }
  return needles
}

/** null = the file is not there. A read that FAILS is fail-closed, not absent. */
export async function readSandboxFile(
  sandbox: RepoSandbox,
  path: string,
  token: string
): Promise<Buffer | null> {
  try {
    return (await sandbox.readFile(path)) ?? null
  } catch (error) {
    logger.error(
      `[sandbox-scrub] ${path} unreadable: ${scrub(short(error), token)}`
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

const MIN_SCRUBBABLE_TOKEN = 8

function scrub(text: string, token: string): string {
  return token.length >= MIN_SCRUBBABLE_TOKEN
    ? text.split(token).join('[redacted]')
    : text
}

function short(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200)
}
