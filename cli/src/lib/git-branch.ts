import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/**
 * LUM-932: the current branch of the git checkout containing `cwd`, read from
 * `.git/HEAD` directly (no subprocess — this runs on every hook event).
 * Follows a worktree's `.git` file (`gitdir: …`). Null for a detached HEAD,
 * a non-repo, or any read error.
 */
export function readGitBranch(cwd: string): string | null {
  let dir = resolve(cwd)
  for (;;) {
    const dotGit = join(dir, '.git')
    try {
      const st = statSync(dotGit)
      let gitDir = dotGit
      if (st.isFile()) {
        const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))
        if (!m) return null
        const target = m[1]!.trim()
        gitDir = isAbsolute(target) ? target : resolve(dir, target)
      }
      const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
      const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
      return ref ? ref[1]! : null
    } catch {
      const parent = dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }
}
