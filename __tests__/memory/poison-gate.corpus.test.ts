/**
 * LUM-793 — the poison gate against the REAL negative corpus:
 * `fixtures/team-memory-corpus.json` is the project's own synced team memory
 * (183 cards, EN + ZH, heavy on imperative PROCEDURAL steps). A gate that
 * rejects any of them is a gate the team would have to turn off, so it is
 * asserted whole rather than by sampling.
 *
 * One edit was made to the captured corpus: the two cards that quote AWS's
 * documented example key spell it `AKIA<REDACTED-EXAMPLE-KEY>` here. It is a
 * known secret-scanner false positive, it has nothing to do with what this
 * gate measures, and leaving it verbatim would add a finding to every scan
 * that ever reads this file.
 *
 * Split out of poison-gate.test.ts (LUM-1034): the corpus is internal content
 * and is left out of the open-source snapshot together with this file.
 */
import {
  detectAgentDirective,
  findPolicyConflicts,
  type PolicyRuleRef,
} from '@/lib/memory/poison-gate'
import corpus from './fixtures/team-memory-corpus.json'

const TEAM_MEMORY = corpus as Array<{ id: string; text: string }>

const RULES: PolicyRuleRef[] = [
  {
    id: 'rule-migrations',
    text: 'Never delete files in prisma/migrations/',
    tier: 'deterministic',
    blocking: true,
    predicate: { type: 'path-glob', value: 'prisma/migrations/**' },
  },
  {
    id: 'rule-push',
    text: 'Never push to main or develop directly',
    tier: 'deterministic',
    blocking: true,
    predicate: { type: 'push-target', value: 'main,develop' },
  },
  {
    id: 'rule-advisory',
    text: 'Prefer named exports over default exports',
    tier: 'semantic',
    blocking: false,
  },
]

describe('memory poison gate on the real team memory corpus', () => {
  it('accepts the real team memory corpus', () => {
    const flagged = TEAM_MEMORY.filter(
      m => detectAgentDirective(m.text).length > 0
    ).map(m => m.id)
    expect(flagged).toEqual([])
  })

  it('leaves the real team memory corpus untouched', () => {
    const flagged = TEAM_MEMORY.filter(
      m => findPolicyConflicts(m.text, RULES).length > 0
    ).map(m => m.id)
    expect(flagged).toEqual([])
  })
})
