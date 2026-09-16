/**
 * @jest-environment node
 *
 * LUM-795 — PUSH_TO_PROTECTED_BRANCH precision, pinned to PRODUCTION command
 * text.
 *
 * Nine `PUSH_TO_PROTECTED_BRANCH` rows exist in prod `boundary_crossings`.
 * Replaying every one of them, plus all 2,647 prod Bash commands that mention
 * `git push`, through today's detector says the two shapes that motivated this
 * task — a feature-branch push piped to `tail` followed by
 * `gh pr create --base main`, and the worktree `cd` + `git push -u origin HEAD`
 * variant — are already quiet: LUM-464 scoped the matcher to the push's own
 * target, LUM-466 added the prose stage, LUM-772 dropped the carrier segments
 * before any matcher runs. The rows are historical, recorded before those fixes
 * shipped.
 *
 * So the commands below are a REGRESSION LOCK, not a bug reproduction: the
 * exact prod text, asserted quiet, so a future loosening of the segment scoping
 * re-breaks a named test instead of quietly re-flooding the ledger. The real
 * pushes from the same history are asserted flagged in the same file, because a
 * precision fix that also drops a true positive is not a fix (LUM-770).
 *
 * The one thing that was NOT already fixed is the third case: a
 * `DESC=$(cat <<'EOF' … EOF)` assignment whose heredoc body quotes a push and a
 * `--base main`. `verbOf` consumed `DESC=$(cat` whole as an env-assignment
 * prefix, so the segment's verb read as the heredoc operator rather than `cat`,
 * and the authored text reached the matcher — leaving the LUM-466 LLM step,
 * which is allowed to fail closed, as the only thing between prose and a
 * recorded crossing. That is exactly the gap LUM-772 closed for `lumo`/`gh`
 * carriers, so it is closed the same deterministic way here.
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { detectCrossings } from '@/lib/services/boundary-detector.service'

const cats = (command: string) =>
  detectCrossings({
    toolName: 'Bash',
    filePath: null,
    payload: { tool_input: { command } },
  }).map(c => c.category)

const pushes = (command: string) =>
  cats(command).includes('PUSH_TO_PROTECTED_BRANCH')

/**
 * Prod hook event behind crossing cmq99rt2j (2026-06-11): a feature-branch push
 * whose PR body repeatedly names `main` — including a literal `git show
 * origin/main:CLAUDE.md`, so the "protected name elsewhere in the line" trap is
 * live in the fixture rather than assumed away.
 */
const PROD_PUSH_THEN_PR_CREATE = `git push -u origin fix/lum433-slimming-test-fixed-budget 2>&1 | tail -4 && gh pr create --base main --head fix/lum433-slimming-test-fixed-budget --title "fix: make lum433 CLAUDE.md size guard a fixed budget, not a vs-origin/main diff" --body "$(cat <<'EOF'
## Problem

A test did \`expect(current).toBeLessThan(base)\`, where \`base\` = \`git show origin/main:CLAUDE.md\`.

That assertion only held on the feature branch. Once LUM-433 merged the slim into \`main\`, \`current\` and \`base\` are identical on \`main\` and on every branch cut from it.

## Fix

Replace the vs-origin/main comparison with a fixed ceiling.
EOF
)" 2>&1 | tail -3`

/**
 * Prod hook event behind crossing cmqahyo37 (2026-06-12): the worktree variant —
 * a `cd` into `.worktrees/`, `git push -u origin HEAD` (no branch name at all),
 * then a PR whose base is `main`.
 */
const PROD_WORKTREE_PUSH_HEAD = `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-451-collapsible-machine-zone
git push -u origin HEAD 2>&1 | tail -3
gh pr create --base main --title "feat: collapsible machine-verified zone in the acceptance tab [LUM-451]" --body "$(cat <<'EOF'
## Summary

UI-only. No schema/backend change.
EOF
)" 2>&1 | tail -3`

/**
 * Prod hook event 2026-09-14T13:15:40Z: a `lumo task create` description built
 * in a command substitution. The body is a write-up OF the LUM-771 false
 * positives, so it quotes both a push and a `--base main` — the shape that
 * still reached the matcher before this task.
 */
const PROD_DESC_COMMAND_SUBSTITUTION = `DESC=$(cat <<'EOF'
LUM-771 收尾过程中，同一个会话在半小时内连记 3 条误报，全部围绕「push」：

3. **cmu19iuku000904jz5yll5kwc** [MEDIUM] PUSH_TO_PROTECTED_BRANCH — 命令是 \`lumo crossing explain cmu18wl7l… --note "False positive: … git push -q origin lumo/LUM-771-cli-bump … gh pr create --base main …"\`。触发源是 explain 自己的 --note 引号文本。
EOF
)
lumo task create "修复 push 误报" -d "$DESC"`

describe('LUM-795 PUSH_TO_PROTECTED_BRANCH precision on production command text', () => {
  it('LUM-795 the reported feature-branch push shapes raise no push crossing', () => {
    expect(pushes(PROD_PUSH_THEN_PR_CREATE)).toBe(false)
    expect(pushes(PROD_WORKTREE_PUSH_HEAD)).toBe(false)
    // …and nothing else either: these are ordinary, fully-compliant flows.
    expect(cats(PROD_PUSH_THEN_PR_CREATE)).toEqual([])
    expect(cats(PROD_WORKTREE_PUSH_HEAD)).toEqual([])
  })

  it('LUM-795 command-substitution assignment prose carrier raises no crossing', () => {
    expect(cats(PROD_DESC_COMMAND_SUBSTITUTION)).toEqual([])
    // The carrier is dropped for what it IS (a `cat` heredoc), not for what it
    // happens to quote: the same assignment around a real push still flags.
    expect(pushes(`OUT=$(git push origin main 2>&1)`)).toBe(true)
  })

  it('LUM-795 a real push to a protected branch is still flagged', () => {
    for (const command of [
      'git push origin main',
      'git push --force origin develop',
      'git push origin HEAD:master',
      // Prod 2026-06-15: the lease-guarded rollback of origin/main. Ruled
      // CONFIRMED by a human — the one true positive in the ledger.
      `echo "=== rollback origin/main 42e6f1c6 -> 1b3015fa (lease-guarded) ==="
git push --force-with-lease=main:42e6f1c62094bf3873d172179f0eb6598c422879 origin 1b3015fa756132451d79eadaf1bbf12e5f360106:main 2>&1 | tail -5
echo ""
echo "=== verify origin/main is back to 1b3015fa ==="
git ls-remote origin main`,
    ]) {
      expect(pushes(command)).toBe(true)
    }
  })
})
