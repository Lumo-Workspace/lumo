/**
 * @jest-environment node
 *
 * LUM-772 — a compiled "never push to main / develop" rule is judged on the
 * push's OWN destination. The three commands below are the exact shapes that
 * produced three false positives in one LUM-771 session (the compiled
 * predicate was `cmd-substr: "git push"`, i.e. "any push at all").
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { detectProjectActionCrossings } from '@/lib/services/boundary-detector.service'
import { matchActionRule } from '@/lib/boundary-crossing/action-rule-match'
import {
  matchPushTarget,
  pushDestinations,
} from '@/lib/boundary-crossing/push-target-match'
import { compileRuleSet } from '@/lib/services/policy/policy-compiler.service'
import type { PolicyRule } from '@/lib/services/policy/types'

// LUM-771 crossing cmu16ehy4 — a feature push piped to tail.
export const LUM771_FEATURE_PUSH =
  'git push -u origin lumo/LUM-771-crossing-fixes 2>&1 | tail -3'
// LUM-771 crossing cmu18wl7l — add + heredoc commit + feature push + PR
// creation whose only `main` is the PR's target branch.
export const LUM771_PUSH_AND_PR = [
  "git add cli/package.json scripts/analysis/lum392-cli-friction/grammar.json && git commit -q -F - <<'EOF'",
  'chore: bump @lumoai/cli 1.60.0→1.61.0 (ship the LUM-771 CLI fix) [LUM-771] [skip-drift]',
  '',
  'Co-Authored-By: Claude <noreply@anthropic.com>',
  'EOF',
  'git push -q origin lumo/LUM-771-cli-bump && gh pr create --base main --head lumo/LUM-771-cli-bump --title "chore: bump @lumoai/cli 1.60.0→1.61.0 [LUM-771]" --body "release of the LUM-771 fix"',
].join('\n')
// LUM-771 crossing cmu19iuku — the agent's own explanation quoting both.
export const LUM771_EXPLAIN_NOTE =
  'lumo crossing explain cmu18wl7l001204l6953jop10 --note "False positive: the command was git add + git commit + git push -q origin lumo/LUM-771-cli-bump (a feature branch) + gh pr create --base main for the PR; main only appears as the PR target, never as a push destination"'

const FALSE_POSITIVE_COMMANDS = [
  LUM771_FEATURE_PUSH,
  LUM771_PUSH_AND_PR,
  LUM771_EXPLAIN_NOTE,
]
const REAL_PROTECTED_PUSHES = [
  'git push origin main',
  'git push origin HEAD:main',
  'git push -f origin feature:develop',
]

/** A push-target rule as the compiler now emits for an UNMAPPED push
 *  prohibition (kept as a project rule; the mapped form dedupes onto the
 *  built-in and is covered in the compiler test). */
const pushTargetRule: PolicyRule = {
  id: 'r-push',
  text: 'Never push to main or develop directly',
  kind: 'action',
  tier: 'deterministic',
  predicate: { type: 'push-target', value: 'main,develop' },
  severity: 'HIGH',
  blocking: false,
}
/** The LUM-751 bare branch-name rule that the corpus already carries. */
const branchNameRule: PolicyRule = {
  id: 'r-main',
  text: 'Never push or merge directly to main',
  kind: 'action',
  tier: 'deterministic',
  predicate: { type: 'cmd-substr', value: 'main' },
  severity: 'MEDIUM',
  blocking: true,
}

const refs = (command: string, rules: PolicyRule[]) =>
  detectProjectActionCrossings(
    { toolName: 'Bash', payload: { tool_input: { command } } },
    rules
  ).map(c => c.policyRuleRef)

describe('LUM-772 push rule fires only on a protected push destination', () => {
  it('LUM-772 push rule fires only on a protected push destination', () => {
    // The prod rule exactly as the LLM compiled it — mapped to the built-in
    // with a target-blind substring — after the compiler's rewrite.
    const compiled = compileRuleSet([
      {
        text: 'Never push to main or develop directly',
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
        predicate: { type: 'cmd-substr', value: 'git push' },
        severity: 'HIGH',
        blocking: true,
      },
    ])
    for (const command of FALSE_POSITIVE_COMMANDS) {
      expect({ command, refs: refs(command, compiled) }).toEqual({
        command,
        refs: [],
      })
      expect({ command, refs: refs(command, [pushTargetRule]) }).toEqual({
        command,
        refs: [],
      })
      // The LUM-751 branch-name rule must not regress either: the only
      // `main` is `gh pr create --base main` / quoted prose.
      expect({ command, refs: refs(command, [branchNameRule]) }).toEqual({
        command,
        refs: [],
      })
    }
    for (const command of REAL_PROTECTED_PUSHES) {
      expect({ command, refs: refs(command, [pushTargetRule]) }).toEqual({
        command,
        refs: ['r-push'],
      })
    }
    // A real protected push next to the same PR-creation noise still fires.
    expect(
      refs('git push origin HEAD:main && gh pr create --base main --title x', [
        pushTargetRule,
      ])
    ).toEqual(['r-push'])
    // `--all` pushes every local branch, main included.
    expect(refs('git push --all origin', [pushTargetRule])).toEqual(['r-push'])
    // A wrapped real push is unwrapped; a wrapped grep is still a grep.
    expect(refs('bash -c "git push origin main"', [pushTargetRule])).toEqual([
      'r-push',
    ])
    expect(
      refs('bash -c "grep -rn \'git push origin main\' docs/"', [
        pushTargetRule,
      ])
    ).toEqual([])
  })

  it('the cmd-substr matcher keeps the feature push + gh pr create --base main negative', () => {
    // The LUM-751 idiom the issue asks to pin in action-rule-match: the only
    // `main` on the line is the PR's target branch in a read-only segment.
    expect(matchActionRule('main', LUM771_PUSH_AND_PR)).toBe(false)
    expect(matchActionRule('main', LUM771_EXPLAIN_NOTE)).toBe(false)
    expect(matchActionRule('main', 'git push origin main')).toBe(true)
    // The target-blind substring the LLM emitted — the bug's mechanism: it
    // matches every push, which is why the compiler no longer keeps it.
    expect(matchActionRule('git push', LUM771_FEATURE_PUSH)).toBe(true)
  })

  it('pushDestinations reads only the destination side of each refspec', () => {
    expect(pushDestinations('git push origin main')).toEqual(['main'])
    expect(pushDestinations('git push -u origin lumo/LUM-772-x')).toEqual([
      'lumo/LUM-772-x',
    ])
    expect(pushDestinations('git push origin HEAD:main')).toEqual(['main'])
    expect(pushDestinations('git push -f origin feature:develop')).toEqual([
      'develop',
    ])
    expect(pushDestinations('git push origin main:feature')).toEqual([
      'feature',
    ])
    expect(pushDestinations('git push origin +main')).toEqual(['main'])
    expect(pushDestinations('git push origin refs/heads/main')).toEqual([
      'main',
    ])
    expect(pushDestinations('git push origin :main')).toEqual(['main'])
    expect(pushDestinations('git push origin --delete main')).toEqual(['main'])
    expect(pushDestinations('git push --force-with-lease origin main')).toEqual(
      ['main']
    )
    expect(pushDestinations('git push -o ci.skip origin main')).toEqual([
      'main',
    ])
    expect(pushDestinations('git -C /repo push origin main')).toEqual(['main'])
    expect(pushDestinations('git push origin main feature')).toEqual([
      'main',
      'feature',
    ])
    // Unknowable targets are not judged; not-a-push is empty.
    expect(pushDestinations('git push')).toEqual([])
    expect(pushDestinations('git push origin')).toEqual([])
    expect(pushDestinations('git push --tags origin')).toEqual([])
    expect(pushDestinations('git merge-base origin/main HEAD')).toEqual([])
    expect(pushDestinations('gh pr create --base main')).toEqual([])
    expect(pushDestinations('git push --all origin')).toBe('ALL')
    expect(pushDestinations('git push --mirror origin')).toBe('ALL')
  })

  it('matchPushTarget ignores prose carriers and heredoc bodies', () => {
    expect(matchPushTarget('main,develop', 'git push origin main')).toBe(true)
    expect(
      matchPushTarget(
        'main',
        'git commit -m "do not git push origin main" && git push origin feat'
      )
    ).toBe(false)
    expect(
      matchPushTarget(
        'main',
        'git commit -F - <<EOF\ngit push origin main\nEOF\ngit push origin feat'
      )
    ).toBe(false)
    expect(matchPushTarget('main', 'echo "git push origin main"')).toBe(false)
    expect(
      matchPushTarget('main', 'git log origin/main..HEAD && git push origin x')
    ).toBe(false)
    expect(matchPushTarget('', 'git push origin main')).toBe(false)
    expect(matchPushTarget('release', 'git push origin release')).toBe(true)
  })
})
