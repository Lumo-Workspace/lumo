/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HOOK_SCRIPT_BLOCK } from '@/cli/src/lib/git-hook-template'

// Build a throwaway git repo on an unborn branch, write the hook script, run
// it against a commit-message file, and return the resulting message text.
function runHook(branch: string, message: string, source = 'message'): string {
  const dir = mkdtempSync(join(tmpdir(), 'lumo-hook-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    // Point HEAD at the branch without needing a commit.
    execFileSync('git', ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], {
      cwd: dir,
    })
    const hookPath = join(dir, 'hook.sh')
    writeFileSync(hookPath, `#!/bin/sh\n${HOOK_SCRIPT_BLOCK}\n`)
    chmodSync(hookPath, 0o755)
    const msgPath = join(dir, 'COMMIT_EDITMSG')
    writeFileSync(msgPath, message)
    execFileSync('sh', [hookPath, msgPath, source], { cwd: dir, stdio: 'pipe' })
    return readFileSync(msgPath, 'utf8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('prepare-commit-msg script', () => {
  it('appends [LUM-N] from the branch when the subject lacks it', () => {
    const out = runHook('lumo/LUM-149-add-hook', 'feat: add the hook\n')
    expect(out).toContain('feat: add the hook [LUM-149]')
  })

  it('leaves the message untouched when it already has a [LUM-x] tag', () => {
    const out = runHook('lumo/LUM-149-add-hook', 'feat: add the hook [LUM-7]\n')
    expect(out).toBe('feat: add the hook [LUM-7]\n')
  })

  it('does nothing when the branch has no LUM-N', () => {
    const out = runHook('feature/no-id', 'feat: something\n')
    expect(out).toBe('feat: something\n')
  })

  it('skips merge commits', () => {
    const out = runHook('lumo/LUM-149-add-hook', "Merge branch 'x'\n", 'merge')
    expect(out).toBe("Merge branch 'x'\n")
  })

  it('skips squash commits', () => {
    const out = runHook('lumo/LUM-149-add-hook', 'squashed subject\n', 'squash')
    expect(out).toBe('squashed subject\n')
  })

  it('appends after a leading comment/blank line, on the real subject', () => {
    const out = runHook(
      'lumo/LUM-149-add-hook',
      '# please enter a message\n\nfix: real subject\n'
    )
    expect(out).toContain('fix: real subject [LUM-149]')
    expect(out).toContain('# please enter a message')
  })
})
