import {
  severityFor,
  isReversible,
} from '@/lib/services/boundary-detector.service'
import { BoundaryCrossingCategory } from '@prisma/client'

describe('SESSION_BINDING_MISSING taxonomy', () => {
  it('is MEDIUM severity', () => {
    expect(severityFor('SESSION_BINDING_MISSING')).toBe('MEDIUM')
  })
  it('is reversible (no artifact mutated — a pure process signal)', () => {
    expect(isReversible('SESSION_BINDING_MISSING')).toBe(true)
  })
})

describe('LUM-736 L4 Session Guard taxonomy', () => {
  const L4: BoundaryCrossingCategory[] = [
    'SENSITIVE_PATH_EDIT',
    'HOOK_BYPASS',
    'TEST_FILE_DELETED',
  ]
  it.each(L4)(
    '%s is MEDIUM severity (visible, honours the workspace opt-out)',
    cat => {
      expect(severityFor(cat)).toBe('MEDIUM')
    }
  )
  it.each(L4)('%s is reversible (repo-state only)', cat => {
    expect(isReversible(cat)).toBe(true)
  })
})

describe('reversibility taxonomy — world/external-state boundary (LUM-516)', () => {
  const REVERSIBLE: BoundaryCrossingCategory[] = [
    'NEW_NPM_DEPENDENCY',
    'TEST_TAMPERING',
    'CONTRACT_WEAKENING',
    'SPINOFF_LAUNDERED',
    'SILENT_FIX',
    'MIGRATION_FILE_DELETED',
    'SESSION_BINDING_MISSING',
    'PUSH_TO_PROTECTED_BRANCH',
    'POLICY_WEAKENING',
    // LUM-640: a steward-session commit/PR is repo/GitHub state — revert/close
    // undoes it, same world-state class as PUSH_TO_PROTECTED_BRANCH.
    'STEWARD_IMPLEMENTATION_ARTIFACT',
    // LUM-736 (L4 Session Guard): all three are repo-state edits/deletes or a
    // bypassed local hook — `git restore` / a follow-up commit undoes them.
    'SENSITIVE_PATH_EDIT',
    'HOOK_BYPASS',
    'TEST_FILE_DELETED',
  ]
  const IRREVERSIBLE: BoundaryCrossingCategory[] = [
    'HARDCODED_SECRET',
    'DESTRUCTIVE_DB_COMMAND',
    'EXFILTRATION_PUBLIC',
    'CLOUD_DATA_DELETION',
    'INFRA_TERMINATION',
  ]
  // Target-dependent categories are classified per-origin, not as a whole —
  // covered by their own describe block below.
  const TARGET_DEPENDENT: BoundaryCrossingCategory[] = [
    'PROJECT_RULE_VIOLATION',
  ]

  it.each(REVERSIBLE)('%s is reversible', cat => {
    expect(isReversible(cat)).toBe(true)
  })
  it.each(IRREVERSIBLE)('%s is irreversible', cat => {
    expect(isReversible(cat)).toBe(false)
  })
  it('the table covers every BoundaryCrossingCategory enum value', () => {
    // LUM-630: reconcile against the real Prisma enum — the old fixed-size
    // count let LUM-590's new categories slip through unclassified (falling
    // to the irreversible default silently).
    const classified = new Set([
      ...REVERSIBLE,
      ...IRREVERSIBLE,
      ...TARGET_DEPENDENT,
    ])
    expect([...classified].sort()).toEqual(
      Object.values(BoundaryCrossingCategory).sort()
    )
  })
  it('defaults an unknown/future category to irreversible', () => {
    expect(
      isReversible('SOME_FUTURE_CATEGORY' as BoundaryCrossingCategory)
    ).toBe(false)
  })
})

describe('PROJECT_RULE_VIOLATION reversibility by origin (LUM-630)', () => {
  it('coderule: target (diff-only code-rule violation) is reversible', () => {
    expect(isReversible('PROJECT_RULE_VIOLATION', 'coderule:abc123')).toBe(true)
    expect(
      isReversible('PROJECT_RULE_VIOLATION', 'coderule:judge-unavailable')
    ).toBe(true)
  })
  it('actionrule: target (arbitrary matched command) stays irreversible', () => {
    expect(isReversible('PROJECT_RULE_VIOLATION', 'actionrule:abc123')).toBe(
      false
    )
  })
  it('missing/null target stays irreversible (conservative default)', () => {
    expect(isReversible('PROJECT_RULE_VIOLATION')).toBe(false)
    expect(isReversible('PROJECT_RULE_VIOLATION', null)).toBe(false)
  })
})
