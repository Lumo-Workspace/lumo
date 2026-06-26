import {
  classifyCheckpointerGrounding,
  effectiveReferentKind,
} from '../../shared/src/referent-kind'

// Real LUM-500 git-DROP checkpointer (verified from `lumo task criteria list LUM-500`)
const LUM500_GIT_DROP = `bash -c 'test -z "$(git diff --diff-filter=D --name-only origin/main -- prisma/migrations/)" && test -z "$(git diff origin/main -- prisma/migrations/ | grep -iE "^\\+.*DROP ")"'`
// Real LUM-559 self-test checkpointer
const LUM559_JEST_T = `npx tsx scripts/jest-t.ts 'surfaces a cost-bearing session with no edges in groups and totals' __tests__/services/lineage.service.test.ts`

describe('classifyCheckpointerGrounding', () => {
  it('classifies the LUM-500 git-DROP check as EXTERNAL (invokes git)', () => {
    expect(classifyCheckpointerGrounding(LUM500_GIT_DROP)).toBe('EXTERNAL')
  })
  it('classifies the LUM-559 jest-t check as AGENT_HARNESS (runs agent tests)', () => {
    expect(classifyCheckpointerGrounding(LUM559_JEST_T)).toBe('AGENT_HARNESS')
  })
  it('classifies npx jest / tsc as AGENT_HARNESS', () => {
    expect(classifyCheckpointerGrounding('npx jest foo.test.ts')).toBe(
      'AGENT_HARNESS'
    )
    expect(classifyCheckpointerGrounding('npx tsc --noEmit')).toBe(
      'AGENT_HARNESS'
    )
  })
  it('classifies a bare literal assertion as ASSERTION_ONLY', () => {
    expect(classifyCheckpointerGrounding('test "$X" = "ok"')).toBe(
      'ASSERTION_ONLY'
    )
    expect(classifyCheckpointerGrounding('[ 1 = 1 ]')).toBe('ASSERTION_ONLY')
  })
  it('classifies a null/empty checkpointer (HUMAN criterion) as NONE', () => {
    expect(classifyCheckpointerGrounding(null)).toBe('NONE')
    expect(classifyCheckpointerGrounding('')).toBe('NONE')
  })
  it('takes the strongest signal: git inside a pipe with grep is EXTERNAL', () => {
    expect(classifyCheckpointerGrounding('git status | grep modified')).toBe(
      'EXTERNAL'
    )
  })

  // NEW guardrails — command-position classifier fixes (LUM-602)
  it('npx jest ... | grep git → AGENT_HARNESS (git is an arg to grep, not a command)', () => {
    expect(classifyCheckpointerGrounding('npx jest 2>&1 | grep git')).toBe(
      'AGENT_HARNESS'
    )
  })
  it('test "$X" = "git is great" → ASSERTION_ONLY (git inside a string arg)', () => {
    expect(classifyCheckpointerGrounding('test "$X" = "git is great"')).toBe(
      'ASSERTION_ONLY'
    )
  })
  it('test 1 = 1 # use git later → ASSERTION_ONLY (git only in a comment)', () => {
    expect(classifyCheckpointerGrounding('test 1 = 1 # use git later')).toBe(
      'ASSERTION_ONLY'
    )
  })
  it('git diff origin/main | grep DROP → EXTERNAL (git is command-position)', () => {
    expect(
      classifyCheckpointerGrounding('git diff origin/main | grep DROP')
    ).toBe('EXTERNAL')
  })
})

describe('effectiveReferentKind', () => {
  it('keeps a git-grounded EXTERNAL_FACT as EXTERNAL_FACT', () => {
    expect(
      effectiveReferentKind({
        declared: 'EXTERNAL_FACT',
        verifierType: 'MACHINE',
        checkpointer: LUM500_GIT_DROP,
      })
    ).toBe('EXTERNAL_FACT')
  })
  it('downgrades a jest-backed EXTERNAL_FACT claim to UNVERIFIED_ASSERTION', () => {
    expect(
      effectiveReferentKind({
        declared: 'EXTERNAL_FACT',
        verifierType: 'MACHINE',
        checkpointer: 'npx jest x.test.ts',
      })
    ).toBe('UNVERIFIED_ASSERTION')
  })
  it('downgrades a literal-only EXTERNAL_FACT claim to UNVERIFIED_ASSERTION', () => {
    expect(
      effectiveReferentKind({
        declared: 'EXTERNAL_FACT',
        verifierType: 'MACHINE',
        checkpointer: 'test 1 = 1',
      })
    ).toBe('UNVERIFIED_ASSERTION')
  })
  it('leaves AGENT_CONSTRUCTED_STATE untouched', () => {
    expect(
      effectiveReferentKind({
        declared: 'AGENT_CONSTRUCTED_STATE',
        verifierType: 'MACHINE',
        checkpointer: 'npx jest x',
      })
    ).toBe('AGENT_CONSTRUCTED_STATE')
  })
  it('does not mechanically downgrade a HUMAN EXTERNAL_FACT (no checkpointer to check)', () => {
    expect(
      effectiveReferentKind({
        declared: 'EXTERNAL_FACT',
        verifierType: 'HUMAN',
        checkpointer: null,
      })
    ).toBe('EXTERNAL_FACT')
  })
  it('maps a null declaration (legacy row) to UNCLASSIFIED', () => {
    expect(
      effectiveReferentKind({
        declared: null,
        verifierType: 'MACHINE',
        checkpointer: 'npx jest x',
      })
    ).toBe('UNCLASSIFIED')
  })
})
