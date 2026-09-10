/**
 * LUM-735 v5 — the only file that imports `@vercel/sandbox` (CLAUDE.md DIP
 * rule). A `RepoSandbox` is a one-shot Firecracker microVM booted from a
 * depth-1 clone of one revision; callers run commands, read files back and
 * MUST `stop()` it (billing runs until they do). The GitHub token only ever
 * lives in the `Sandbox.create` call — the SDK sends it as git basic auth,
 * it is never written into the sandbox filesystem by us.
 *
 * Auth to Vercel is automatic in a Vercel Function (project OIDC token);
 * locally `vercel env pull` provides VERCEL_OIDC_TOKEN.
 */
import { Sandbox } from '@vercel/sandbox'

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
}

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  /** Working directory for the command (absolute path inside the sandbox). */
  cwd?: string
}

/* eslint-disable no-unused-vars -- parameter names in a type declaration */
export interface RepoSandbox {
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
  })
  return {
    cwd: sandbox.cwd,
    async run(cmd, args, opts) {
      const result = await sandbox.runCommand({
        cmd,
        args,
        ...(opts?.cwd ? { cwd: opts.cwd } : {}),
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
