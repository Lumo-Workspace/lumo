/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { HOOK_SCRIPT_BLOCK } from '@/cli/src/lib/git-hook-template'

// Build a throwaway git repo on an unborn branch, write the hook script, run
// it against a commit-message file, and return the resulting message text.
function runHook(branch: string, message: string, source = 'message'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-hook-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    // Point HEAD at the branch without needing a commit.
    execFileSync('git', ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], {
      cwd: dir,
    })
    const hookPath = path.join(dir, 'hook.sh')
    fs.writeFileSync(hookPath, `#!/bin/sh\n${HOOK_SCRIPT_BLOCK}\n`)
    fs.chmodSync(hookPath, 0o755)
    const msgPath = path.join(dir, 'COMMIT_EDITMSG')
    fs.writeFileSync(msgPath, message)
    execFileSync('sh', [hookPath, msgPath, source], { cwd: dir })
    return fs.readFileSync(msgPath, 'utf8')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
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

  it('appends after a leading comment/blank line, on the real subject', () => {
    const out = runHook(
      'lumo/LUM-149-add-hook',
      '# please enter a message\n\nfix: real subject\n'
    )
    expect(out).toContain('fix: real subject [LUM-149]')
    expect(out).toContain('# please enter a message')
  })
})
