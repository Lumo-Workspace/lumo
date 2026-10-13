/**
 * @jest-environment node
 *
 * LUM-1114 — compile-time de-duplication of policy rules. Two rules merge only
 * when they are the same detector (kind, tier, category, predicate,
 * normalised assertion) — wording is never compared, so the merge is generic
 * across tenants and can never lose a detection. A merged rule's old id stays
 * resolvable for crossings, the weakening diff and the re-judge.
 */
import {
  dedupeRules,
  detectionKey,
} from '@/ee/security/services/policy/rule-dedupe'
import { compileRuleSet } from '@/ee/security/services/policy/policy-compiler.service'
import { findRuleByRef, ruleRefs, ruleTextForRef } from '@/lib/policy/rule-ref'
import { weakenedRules } from '@/lib/boundary-crossing/policy-weakening'
import { rejudgeRow, type RejudgeRow } from '@/lib/boundary-crossing/rejudge'
import type { PolicyRule, RawPolicyRule } from '@/lib/policy/types'

type RuleOver = Omit<Partial<PolicyRule>, 'predicate'> & {
  id: string
  text: string
  /** `undefined` = a rule without a predicate. */
  predicate?: PolicyRule['predicate'] | undefined
}
const rule = (over: RuleOver): PolicyRule => {
  const out = {
    kind: 'code',
    tier: 'deterministic',
    predicate: { type: 'diff-regex', value: 'console\\.log\\(' },
    severity: 'LOW',
    blocking: false,
    ...over,
  } as PolicyRule
  if ('predicate' in over && over.predicate === undefined) delete out.predicate
  return out
}

describe('dedupeRules', () => {
  it('merges differently-worded rules that compile to the same detector', () => {
    const out = dedupeRules([
      rule({ id: 'a', text: 'No console.log in production code' }),
      rule({
        id: 'b',
        text: 'Before opening a PR: no `console.log`',
        severity: 'MEDIUM',
      }),
      rule({ id: 'c', text: 'Checklist: tests pass, no console.log' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: 'a',
      text: 'No console.log in production code',
      severity: 'MEDIUM',
    })
    expect(out[0]?.aliases).toEqual([
      { id: 'b', text: 'Before opening a PR: no `console.log`' },
      { id: 'c', text: 'Checklist: tests pass, no console.log' },
    ])
  })

  it('collapses the same rule emitted several times without aliasing itself', () => {
    const same = rule({ id: 'x', text: 'Never install new npm packages' })
    const out = dedupeRules([same, { ...same }, { ...same }])
    expect(out).toHaveLength(1)
    expect(out[0]?.aliases).toBeUndefined()
  })

  it('never merges different detectors', () => {
    const out = dedupeRules([
      rule({ id: 'a', text: 'r1' }),
      rule({
        id: 'b',
        text: 'r2',
        predicate: { type: 'diff-regex', value: 'debugger' },
      }),
      rule({ id: 'c', text: 'r3', kind: 'action' }),
      rule({
        id: 'd',
        text: 'r4',
        tier: 'semantic',
        assertion: 'no console.log',
      }),
      rule({ id: 'e', text: 'r5', mappedCategory: 'HARDCODED_SECRET' }),
      rule({
        id: 'f',
        text: 'r6',
        tier: 'semantic',
        predicate: undefined,
        assertion: 'no debugger statements',
      }),
    ])
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('merges semantic rules whose assertions differ only in case, quotes or punctuation', () => {
    const sem = (id: string, assertion: string) =>
      rule({ id, text: id, tier: 'semantic', predicate: undefined, assertion })
    const out = dedupeRules([
      sem('a', 'Added code must not call `console.log`.'),
      sem('b', 'added code must not call console.log'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.aliases?.map(a => a.id)).toEqual(['b'])
  })

  it('a blocking copy makes the merged rule blocking; existing aliases carry over', () => {
    const out = dedupeRules([
      rule({ id: 'a', text: 'A', mappedCategory: 'HARDCODED_SECRET' }),
      rule({
        id: 'b',
        text: 'B',
        mappedCategory: 'HARDCODED_SECRET',
        blocking: true,
        aliases: [{ id: 'z', text: 'Z' }],
      }),
    ])
    expect(out[0]?.blocking).toBe(true)
    expect(out[0]?.aliases).toEqual([
      { id: 'b', text: 'B' },
      { id: 'z', text: 'Z' },
    ])
  })

  it('does not mutate its input', () => {
    const input = [rule({ id: 'a', text: 'A' }), rule({ id: 'b', text: 'B' })]
    const snapshot = JSON.stringify(input)
    dedupeRules(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('detectionKey ignores wording but not the predicate', () => {
    expect(detectionKey(rule({ id: 'a', text: 'one' }))).toBe(
      detectionKey(rule({ id: 'b', text: 'two' }))
    )
    expect(detectionKey(rule({ id: 'a', text: 'one' }))).not.toBe(
      detectionKey(
        rule({
          id: 'a',
          text: 'one',
          predicate: { type: 'diff-regex', value: 'x' },
        })
      )
    )
  })
})

describe('compileRuleSet de-duplicates after the safety nets', () => {
  const raw = (
    text: string,
    tier: 'deterministic' | 'semantic',
    value: string
  ): RawPolicyRule => ({
    text,
    kind: 'code',
    tier,
    predicate: { type: 'diff-regex', value },
    severity: 'LOW',
    blocking: false,
  })

  it('the compiler output for one file carries each detector once', () => {
    const rules = compileRuleSet([
      raw(
        'No console.log in production code',
        'deterministic',
        'console\\.log\\('
      ),
      raw(
        'Before opening a PR: no console.log',
        'deterministic',
        'console\\.log\\('
      ),
      raw('Use async/await, not .then()', 'semantic', '\\.then\\('),
      raw('Use async/await, not .then()', 'semantic', '\\.then\\('),
    ])
    expect(rules.map(r => r.text)).toEqual([
      'No console.log in production code',
      'Use async/await, not .then()',
    ])
  })

  it('semantic rules without an assertion are told apart by their text', () => {
    const rules = compileRuleSet([
      raw('No console.log in production code', 'semantic', 'console\\.log\\('),
      raw(
        'Before opening a PR: tests pass, no console.log, branch names follow the convention',
        'semantic',
        'console\\.log\\('
      ),
    ])
    expect(rules).toHaveLength(2)
    expect(rules.every(r => r.aliases === undefined)).toBe(true)
  })
})

describe('re-running a stored policy keeps its aliases', () => {
  it('compileRuleSet carries aliases of an already-merged stored rule', () => {
    const stored = rule({
      id: 'a',
      text: 'No console.log in production code',
      tier: 'semantic',
      aliases: [{ id: 'b', text: 'Before opening a PR: no console.log' }],
    })
    const [again] = compileRuleSet([stored])
    expect(again?.aliases).toEqual([
      { id: 'b', text: 'Before opening a PR: no console.log' },
    ])
    // The id is re-derived from the text; the alias still finds the rule.
    expect(findRuleByRef(compileRuleSet([stored]), 'b')?.text).toBe(
      'No console.log in production code'
    )
  })
})

describe('merged ids stay resolvable', () => {
  const merged = rule({
    id: 'a',
    text: 'Never hardcode secrets',
    mappedCategory: 'HARDCODED_SECRET',
    blocking: true,
    aliases: [{ id: 'b', text: 'No API keys in code' }],
  })

  it('rule-ref finds the rule and the alias text by either id', () => {
    expect(ruleRefs(merged)).toEqual(['a', 'b'])
    expect(findRuleByRef([merged], 'b')?.id).toBe('a')
    expect(findRuleByRef([merged], 'nope')).toBeUndefined()
    expect(ruleTextForRef([merged], 'a')).toBe('Never hardcode secrets')
    expect(ruleTextForRef([merged], 'b')).toBe('No API keys in code')
  })

  it('a rule merged into another is not a policy weakening', () => {
    const prev = [
      rule({
        id: 'a',
        text: 'Never hardcode secrets',
        mappedCategory: 'HARDCODED_SECRET',
        blocking: true,
      }),
      rule({
        id: 'b',
        text: 'No API keys in code',
        mappedCategory: 'HARDCODED_SECRET',
        blocking: true,
      }),
    ]
    expect(weakenedRules(prev, [merged])).toEqual([])
    // A rule really removed still is.
    expect(weakenedRules(prev, []).map(r => r.id)).toEqual(['a', 'b'])
  })

  it('the re-judge treats an aliased rule as still compiled', () => {
    const push = rule({
      id: 'p1',
      text: 'Never run flush-prod',
      kind: 'action',
      predicate: { type: 'cmd-substr', value: 'flush-prod' },
      aliases: [{ id: 'p2', text: 'flush-prod is forbidden' }],
    })
    const row = (command: string): RejudgeRow => ({
      id: 'c1',
      taskId: 't1',
      projectId: 'p',
      policyRuleRef: 'p2',
      policyRuleText: 'flush-prod is forbidden',
      detail: command,
      command,
    })
    expect(rejudgeRow(row('./flush-prod --all'), [push]).verdict).toBe(
      'STILL_MATCHES'
    )
    expect(rejudgeRow(row('echo ok'), [push]).verdict).toBe('NO_LONGER_MATCHES')
  })
})
