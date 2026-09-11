/**
 * LUM-735 v5 — the only file that imports `@vercel/sandbox` (CLAUDE.md DIP
 * rule). A `RepoSandbox` is a one-shot Firecracker microVM booted from a
 * depth-1 clone of one revision; callers run commands, read files back and
 * MUST `stop()` it (billing runs until they do). The GitHub token only ever
 * lives in the `Sandbox.create` call — the SDK sends it as git basic auth,
 * and nothing in THIS module writes it into the sandbox filesystem.
 *
 * LUM-758: that last sentence is a statement about our code, not about the
 * platform's. The clone itself happens server-side (`source` is handed to the
 * Vercel API, not executed here), so whether the credential ends up in the
 * checkout's `.git/config` is not observable from this module. Anything that
 * lets a model read the checkout must assume it does and prove otherwise at
 * runtime — see `scrubCloneCredentials` in
 * `lib/services/security-hunt-sandbox.ts`.
 *
 * Auth to Vercel is automatic in a Vercel Function (project OIDC token);
 * locally `vercel env pull` provides VERCEL_OIDC_TOKEN.
 */
import { Sandbox } from '@vercel/sandbox'
import { logger } from '@/lib/logger'

export interface RepoSandboxOptions {
  /** `owner/repo` on github.com */
  repository: string
  /** commit sha to check out */
  revision: string
  /** GitHub App installation token (read access to the repository) */
  token: string
  timeoutMs: number
  vcpus: number
  image?: string
  /**
   * LUM-745: Vercel sandbox tags. `stopRepoSandboxesByTag` finds the VM by
   * one of these from outside the step that created it.
   */
  tags?: Record<string, string>
}

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  /** Working directory for the command (absolute path inside the sandbox). */
  cwd?: string
  /** LUM-746: extra environment for this command only. */
  env?: Record<string, string>
  /** LUM-746: kill the command (SIGKILL) after this many ms. */
  timeoutMs?: number
}

/* eslint-disable no-unused-vars -- parameter names in a type declaration */
export interface RepoSandbox {
  /** LUM-746: the VM's name — `getRepoSandbox({ name })` reconnects to it from another step. */
  name: string
  /**
   * The session's default working directory. With the `universal` image this
   * is the home directory (`/vercel`), and a git source is cloned into
   * `<cwd>/<repo name>` — NOT into cwd itself — so scanners must be run with
   * an explicit `cwd` (LUM-735 dogfood 2026-09-10: both tools exited 90 from
   * the sha guard because they ran one directory above the clone).
   */
  cwd: string
  run(cmd: string, args: string[], opts?: RunOptions): Promise<CommandResult>
  /** Bytes of a file inside the sandbox, or null when it does not exist. */
  readFile(path: string): Promise<Buffer | null>
  stop(): Promise<void>
}
/* eslint-enable no-unused-vars */

export async function createRepoSandbox(
  opts: RepoSandboxOptions
): Promise<RepoSandbox> {
  const sandbox = await Sandbox.create({
    // SDK 3.2.2 takes a flat, discriminated `source` (`{ type: 'git', … }`),
    // not a nested `{ git: … }` object.
    source: {
      type: 'git',
      url: `https://github.com/${opts.repository}.git`,
      username: 'x-access-token',
      password: opts.token,
      revision: opts.revision,
      depth: 1,
    },
    image: opts.image ?? 'vercel/sandbox/universal',
    resources: { vcpus: opts.vcpus },
    timeout: opts.timeoutMs,
    ...(opts.tags ? { tags: opts.tags } : {}),
  })
  return wrap(sandbox)
}

/**
 * LUM-746 — reconnect to a VM another step created (by the name
 * `createRepoSandbox` exposed). Throws when the VM is gone (timed out or
 * stopped); callers treat that as a harness failure, never a gate verdict.
 */
export async function getRepoSandbox(opts: {
  name: string
}): Promise<RepoSandbox> {
  return wrap(await Sandbox.get({ name: opts.name }))
}

type SdkSandbox = Pick<
  Sandbox,
  'name' | 'cwd' | 'runCommand' | 'readFileToBuffer' | 'stop'
>

function wrap(sandbox: SdkSandbox): RepoSandbox {
  return {
    name: sandbox.name,
    cwd: sandbox.cwd,
    async run(cmd, args, opts) {
      const result = await sandbox.runCommand({
        cmd,
        args,
        ...(opts?.cwd ? { cwd: opts.cwd } : {}),
        ...(opts?.env ? { env: opts.env } : {}),
        ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      })
      return {
        exitCode: result.exitCode,
        stdout: await result.stdout(),
        stderr: await result.stderr(),
      }
    },
    readFile(path) {
      return sandbox.readFileToBuffer({ path })
    },
    async stop() {
      await sandbox.stop()
    },
  }
}

/**
 * Where the SDK puts a git source: `<session cwd>/<repo name>`, not the
 * session cwd itself (verified in a probe sandbox on 2026-09-10: cwd was
 * `/vercel`, the clone `/vercel/lumo`). Every script a caller runs there
 * still proves the directory is the right checkout with a sha guard before
 * doing anything. Pure; shared by the managed scan and the managed CI.
 */
export function repoCheckoutDir(
  sandboxCwd: string,
  repository: string
): string {
  const name = repository.slice(repository.indexOf('/') + 1)
  return `${sandboxCwd.replace(/\/+$/, '')}/${name}`
}

/**
 * LUM-758 — find a live sandbox with the specified tags and reconnect to it.
 * The managed scan (LUM-735) already tags sandboxes as `{ lumoScan: scanId }`;
 * the hunt reuses the same scanId to avoid paying for a second microVM.
 *
 * Returns null (not an error) when no live VM matches: the managed scan has
 * four legitimate reasons not to run (BYO SARIF findings exist, feature is
 * disabled, hourly quota exceeded, or start failed). Callers create their own
 * VM. A failure of `list` itself propagates — that is a platform fault, not
 * "no VM".
 *
 * `excludeTagKeys` narrows the match after the fact, because the platform
 * filter is a single `{ key: value }` AND and has no negation. It exists for
 * callers that tag their OWN VMs with the tag they look up: without it, a
 * lookup for "somebody else's VM" also returns the caller's own, and a
 * sibling's — see the hunt's `HUNT_SANDBOX_TAG` in
 * `lib/services/security-hunt-sandbox.ts`.
 */
export async function findRepoSandboxByTag(
  tags: Record<string, string>,
  options: { excludeTagKeys?: readonly string[] } = {}
): Promise<RepoSandbox | null> {
  const result = await Sandbox.list({ tags } as Parameters<
    typeof Sandbox.list
  >[0])
  for await (const entry of result) {
    if (entry.status !== 'running' && entry.status !== 'pending') continue
    // Presence of the KEY excludes, whatever its value: the question is "who
    // booted this VM", and the key alone answers it.
    if (options.excludeTagKeys?.some(key => entry.tags?.[key] !== undefined))
      continue
    try {
      return wrap(await Sandbox.get({ name: entry.name }))
    } catch (error) {
      // Race condition: VM stopped between list and get. Try the next one.
      logger.warn(
        `[vercel-sandbox] attach failed name=${entry.name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  return null
}

/**
 * LUM-758 — cut a sandbox's network egress ("deny-all" in the SDK's
 * `NetworkPolicy` vocabulary). The hunt calls this on a VM **it created
 * itself**, right after the clone: the agent only reads a local checkout, so
 * it needs no route out, and without one the whole "the model was talked into
 * running curl" class loses its payload.
 *
 * NOT applied at create time and NOT applied to an attached VM:
 *  - the git clone is performed by the platform as part of `Sandbox.create`,
 *    so a create-time "deny-all" would be denying the very fetch we need;
 *  - an attached VM belongs to the managed scan, which downloads gitleaks,
 *    semgrep and osv-scanner while it runs. Tightening its policy from here
 *    would break a run we have no ordering guarantee against.
 *
 * Throws on failure; callers treat it as best-effort defence in depth (the
 * command gate is the enforcing boundary).
 */
export async function denySandboxEgress(name: string): Promise<void> {
  const sandbox = await Sandbox.get({ name })
  await sandbox.update({ networkPolicy: 'deny-all' })
}

/**
 * LUM-745 — stop every sandbox still alive under one `{ key: value }` tag
 * (the SDK filters by a single tag only). Returns how many were stopped. A
 * sandbox that fails to stop is logged and skipped, never thrown: callers
 * (supersede, the sweep) are best-effort and correctness never depends on
 * this — the sandbox step's entry guard does. A failing `list` propagates.
 */
export async function stopRepoSandboxesByTag(
  tags: Record<string, string>
): Promise<number> {
  let stopped = 0
  // The SDK's `SingleTagFilter` is a compile-time check for exactly one key;
  // a runtime record satisfies it by construction here (callers pass one).
  const result = await Sandbox.list({ tags } as Parameters<
    typeof Sandbox.list
  >[0])
  for await (const entry of result) {
    if (entry.status !== 'pending' && entry.status !== 'running') continue
    try {
      const sandbox = await Sandbox.get({ name: entry.name })
      await sandbox.stop()
      stopped += 1
    } catch (error) {
      logger.warn(
        `[vercel-sandbox] stop failed name=${entry.name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  return stopped
}
