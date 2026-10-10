/**
 * @jest-environment node
 *
 * LUM-772 — the PROJECT_RULE_VIOLATION backfill's pure core: OPEN rows a
 * compiled rule produced are re-judged against the CURRENT compiler's view of
 * the stored policy. Test names below are literal MACHINE checkpointers — do
 * not rename.
 */
import {
  backfillNote,
  parseBackfillArgs,
  planRuleRejudge,
  rejudgeRow,
  type RejudgeRow,
} from '@/lib/boundary-crossing/rejudge'
import { compileRuleSet } from '@/ee/security/services/policy/policy-compiler.service'
import type { PolicyRule, RawPolicyRule } from '@/lib/policy/types'
import { createHash } from 'crypto'

/** Stored ids are the compiler's sha256(text) prefix — stable across re-runs. */
const ruleIdOf = (text: string) =>
  createHash('sha256').update(text).digest('hex').slice(0, 16)
const FLUSH_ID = ruleIdOf('never run flush-prod')

// The prod policy rows as STORED (compiled before LUM-772 / LUM-770 fixed
// them): a target-blind push rule and an obligation turned prohibition.
const STORED_PUSH_RULE: PolicyRule = {
  id: 'b7cb287dd363426e',
  text: 'Never push to main or develop directly',
  kind: 'action',
  tier: 'deterministic',
  mappedCategory: 'PUSH_TO_PROTECTED_BRANCH',
  predicate: { type: 'cmd-substr', value: 'git push' },
  severity: 'HIGH',
  blocking: true,
}
const STORED_TSC_RULE: PolicyRule = {
  id: 'a8c320ced05a3a87',
  text: 'Before opening a PR: tests + npx tsc --noEmit pass',
  kind: 'action',
  tier: 'deterministic',
  predicate: { type: 'cmd-substr', value: 'gh pr create' },
  severity: 'MEDIUM',
  blocking: false,
}
const STORED_FLUSH_RULE: PolicyRule = {
  id: FLUSH_ID,
  text: 'never run flush-prod',
  kind: 'action',
  tier: 'deterministic',
  predicate: { type: 'cmd-substr', value: 'flush-prod' },
  severity: 'HIGH',
  blocking: false,
}

const FEATURE_PUSH =
  'git push -u origin lumo/LUM-771-crossing-fixes 2>&1 | tail -3'
const PR_CREATE =
  'gh pr create --base main --head lumo/LUM-722-new-button-plus-icon --title "fix: buttons [LUM-722]" --body "summary"'
const LONG_PREFIX =
  "git add -A && git commit -q -F - <<'EOF' " + 'x'.repeat(200)
const CLIPPED = `${LONG_PREFIX.slice(0, 200)}…`

const row = (over: Partial<RejudgeRow> & { id: string }): RejudgeRow => ({
  taskId: 't1',
  projectId: 'p1',
  policyRuleRef: 'b7cb287dd363426e',
  policyRuleText: 'Never push to main or develop directly',
  detail: FEATURE_PUSH,
  command: null,
  ...over,
})

describe('LUM-772 backfill rejudges open rule crossings against the current detector', () => {
  it('LUM-772 backfill rejudges open rule crossings against the current detector', () => {
    // The current compiler's view of the STORED policy: no model call, the
    // deterministic post-processing only. The stored id is derived from the
    // text, so re-running keeps the ids stable.
    const current = compileRuleSet([
      STORED_PUSH_RULE,
      STORED_TSC_RULE,
      STORED_FLUSH_RULE,
    ] as RawPolicyRule[])
    expect(current.map(r => r.id)).toEqual([
      'b7cb287dd363426e',
      'a8c320ced05a3a87',
      FLUSH_ID,
    ])
    expect(ruleIdOf(STORED_PUSH_RULE.text)).toBe('b7cb287dd363426e')
    expect(current[0]!.predicate).toBeUndefined() // deduped onto the built-in
    expect(current[1]!.tier).toBe('semantic') // LUM-770 obligation guard

    const rules = new Map([['p1', current]])
    const plan = planRuleRejudge(
      [
        // The feature push the target-blind predicate flagged.
        row({ id: 'feature-push' }),
        // The PR-creation the obligation rule flagged (LUM-770 shape).
        row({
          id: 'pr-create',
          policyRuleRef: 'a8c320ced05a3a87',
          policyRuleText: STORED_TSC_RULE.text,
          detail: PR_CREATE,
        }),
        // A genuine violation of a rule that still compiles: left open.
        row({
          id: 'still-bad',
          policyRuleRef: FLUSH_ID,
          policyRuleText: STORED_FLUSH_RULE.text,
          detail: 'node scripts/flush-prod.js',
        }),
        // Clipped detail and no hook command on record: cannot be judged.
        row({ id: 'clipped', detail: CLIPPED }),
        // Clipped detail but the hook event carries the full command: judged
        // on the full command (a feature push).
        row({
          id: 'clipped-with-command',
          detail: CLIPPED,
          command: `${LONG_PREFIX}\nEOF\ngit push -q origin lumo/LUM-771-cli-bump && gh pr create --base main --title t`,
        }),
        // …and when the full command really pushes to main, it stays open
        // under the rule's successor (the built-in is not a project rule, so
        // the still-compiled push rule with no predicate cannot cite it; a
        // sibling deterministic rule can).
        row({
          id: 'clipped-real-push',
          policyRuleRef: FLUSH_ID,
          detail: CLIPPED,
          command: `${LONG_PREFIX}\nEOF\nnode scripts/flush-prod.js`,
        }),
        // A rule id that no longer exists in the current policy and nothing
        // current matches the command: retired.
        row({
          id: 'retired',
          policyRuleRef: 'gone-rule',
          policyRuleText: 'old wording',
          detail: 'npm test',
        }),
        // Same, but a current rule still forbids the command: left open.
        row({
          id: 'retired-still-bad',
          policyRuleRef: 'gone-rule',
          detail: 'node scripts/flush-prod.js',
        }),
        // No stored policy for the project: cannot be judged.
        row({ id: 'no-policy', projectId: 'p-none' }),
        row({ id: 'no-project', projectId: null }),
      ],
      rules
    )

    const verdictOf = (id: string) =>
      [...plan.candidates, ...plan.leftOpen].find(d => d.row.id === id)?.verdict
    expect(plan.candidates.map(d => d.row.id)).toEqual([
      'feature-push',
      'pr-create',
      'clipped-with-command',
      'retired',
    ])
    expect(verdictOf('feature-push')).toBe('NO_LONGER_MATCHES')
    expect(verdictOf('pr-create')).toBe('NO_LONGER_MATCHES')
    expect(verdictOf('clipped-with-command')).toBe('NO_LONGER_MATCHES')
    expect(verdictOf('retired')).toBe('RULE_RETIRED')
    expect(verdictOf('still-bad')).toBe('STILL_MATCHES')
    expect(verdictOf('clipped')).toBe('TRUNCATED')
    expect(verdictOf('clipped-real-push')).toBe('STILL_MATCHES')
    expect(verdictOf('retired-still-bad')).toBe('STILL_MATCHES')
    expect(verdictOf('no-policy')).toBe('NO_POLICY')
    expect(verdictOf('no-project')).toBe('NO_POLICY')

    // The judged command is the full hook command when present.
    expect(
      plan.candidates.find(d => d.row.id === 'clipped-with-command')?.command
    ).toContain('git push -q origin lumo/LUM-771-cli-bump')

    // The note names the compiler version, the rule and the reason, and reads
    // as a system re-judgement.
    const note = backfillNote(plan.candidates[0]!, 'lum772')
    expect(note).toMatch(/^\[LUM-772 backfill\]/)
    expect(note).toContain('compiler lum772')
    expect(note).toContain('b7cb287dd363426e')
    expect(note).toContain('Never push to main or develop directly')
    expect(note).toContain('target-blind')
    expect(backfillNote(plan.candidates[3]!, 'lum772')).toContain(
      'no longer compiles to a deterministic predicate'
    )

    // Nothing is written without --apply: the plan is data, and the CLI
    // parser defaults to a dry run.
    expect(parseBackfillArgs(['--rule', 'b7cb287dd363426e'])).toEqual({
      ruleRefs: ['b7cb287dd363426e'],
      apply: false,
    })
    expect(
      parseBackfillArgs([
        '--rule',
        'a',
        '--rule',
        'b',
        '--rule',
        'a',
        '--apply',
      ])
    ).toEqual({ ruleRefs: ['a', 'b'], apply: true })
    expect(() => parseBackfillArgs(['--apply'])).toThrow(/--rule/)
    expect(() => parseBackfillArgs(['--rule'])).toThrow(/policyRuleRef/)
    expect(() => parseBackfillArgs(['--rule', 'a', '--yes'])).toThrow(/unknown/)
  })

  it('a row is judged on the stored detail only when it is not clipped', () => {
    const current = compileRuleSet([STORED_PUSH_RULE] as RawPolicyRule[])
    expect(rejudgeRow(row({ id: 'a' }), current).verdict).toBe(
      'NO_LONGER_MATCHES'
    )
    expect(rejudgeRow(row({ id: 'b', detail: CLIPPED }), current).verdict).toBe(
      'TRUNCATED'
    )
    // An empty hook command falls back to the detail.
    expect(rejudgeRow(row({ id: 'c', command: '   ' }), current).verdict).toBe(
      'NO_LONGER_MATCHES'
    )
    expect(rejudgeRow(row({ id: 'd' }), null).verdict).toBe('NO_POLICY')
  })
})
