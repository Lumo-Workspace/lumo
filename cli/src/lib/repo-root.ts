import { execFileSync, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

/** Root of the git work tree containing `cwd`, or null outside a repo. */
export function repoRoot(cwd: string): string | null {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  })
  if (res.error || res.status !== 0) return null
  const out = res.stdout.trim()
  return out ? out : null
}

/** Resolve symlinks (leaf or any parent); a missing path resolves as-is. */
function realOrResolved(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/**
 * Whether git tracks the file or directory `p` in its enclosing repo. Fails
 * closed: only "git is not installed" or "not inside a git work tree" mean
 * untracked; any other git failure counts as tracked. Symlinks are resolved
 * first, so a link into another repo is checked in that repo.
 */
export function isPathGitTracked(p: string): boolean {
  const real = realOrResolved(p)
  let isDir = false
  try {
    isDir = fs.statSync(real).isDirectory()
  } catch {
    // missing: check it as a file path
  }
  if (isDir) return lsFilesTracked(real, [])
  return lsFilesTracked(path.dirname(real), ['--', path.basename(real)])
}

function lsFilesTracked(cwd: string, extra: string[]): boolean {
  try {
    const out = execFileSync('git', ['ls-files', ...extra], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    })
    return out.trim().length > 0
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string | Buffer }
    if (e.code === 'ENOENT') return false
    if (/not a git repository/i.test(String(e.stderr ?? ''))) return false
    return true
  }
}
