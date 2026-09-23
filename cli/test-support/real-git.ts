/**
 * Real-git sandboxes for worktree tests (LUM-825). The worktree commands
 * shell out to git, so mocks would only prove what the mock says — these
 * build an actual bare "remote" plus a clone in a temp dir.
 *
 * Isolation: global/system git config is disabled for the whole process
 * (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`) so a developer's
 * own `core.hooksPath`, `init.defaultBranch` etc. cannot leak into a test.
 * Call `isolateGitEnv()` in `beforeAll` and the returned restore in `afterAll`.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

export function isolateGitEnv(): () => void {
  const saved = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
  }
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  process.env.GIT_AUTHOR_NAME = 'Test'
  process.env.GIT_AUTHOR_EMAIL = 'test@example.com'
  process.env.GIT_COMMITTER_NAME = 'Test'
  process.env.GIT_COMMITTER_EMAIL = 'test@example.com'
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

export interface Sandbox {
  /** Temp dir holding everything; remove with `cleanup()`. */
  tmp: string
  /** The bare "remote" (origin). */
  remote: string
  /** The main checkout — a clone of `remote`. */
  main: string
  cleanup: () => void
}

/**
 * A bare remote whose default branch is `defaultBranch`, seeded with one
 * commit, cloned to `main` (so origin/HEAD points at `defaultBranch`).
 */
export function makeSandbox(defaultBranch = 'master'): Sandbox {
  const tmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-wt-'))
  )
  const seed = path.join(tmp, 'seed')
  const remote = path.join(tmp, 'remote.git')
  const main = path.join(tmp, 'main')
  fs.mkdirSync(seed)
  git(seed, 'init', '-q', '-b', defaultBranch)
  fs.writeFileSync(path.join(seed, 'README.md'), 'hello\n')
  git(seed, 'add', 'README.md')
  git(seed, 'commit', '-q', '-m', 'init')
  git(tmp, 'clone', '-q', '--bare', seed, remote)
  git(tmp, 'clone', '-q', remote, main)
  return {
    tmp,
    remote,
    main,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  }
}

/** Run `fn` with process.cwd() = `dir`, restoring the old cwd afterwards. */
export async function inDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd()
  process.chdir(dir)
  try {
    return await fn()
  } finally {
    process.chdir(prev)
  }
}

/** Capture console.log / console.error lines while `fn` runs. */
export async function captureOutput<T>(
  fn: () => Promise<T>
): Promise<{ result: T; out: string; err: string }> {
  const out: string[] = []
  const err: string[] = []
  const log = jest
    .spyOn(console, 'log')
    .mockImplementation((...a: unknown[]) => void out.push(a.join(' ')))
  const error = jest
    .spyOn(console, 'error')
    .mockImplementation((...a: unknown[]) => void err.push(a.join(' ')))
  const write = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk))
      return true
    })
  try {
    const result = await fn()
    return { result, out: out.join('\n'), err: err.join('\n') }
  } finally {
    log.mockRestore()
    error.mockRestore()
    write.mockRestore()
  }
}
