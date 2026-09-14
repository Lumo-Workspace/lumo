/**
 * @jest-environment node
 *
 * LUM-780 — pure re-judge verdicts. Every branch of both criteria, so a
 * CAUSE_GONE can only ever be reached on the exact evidence the current
 * detector would itself record as advisory.
 */
import {
  REJUDGE_CRITERION_VERSION,
  isRejudgeableCategory,
  normalizeForPresence,
  ruleTextFromDetail,
  rejudgePolicyWeakening,
  rejudgeTestFileDeleted,
  removedTestFiles,
  normalizeRuleTextForPresence,
  ruleTextPresentIn,
} from '@/lib/boundary-crossing/rejudge-cause'
import { EVASION_MARKER } from '@/lib/boundary-crossing/evasion'

const CLAUDE_MD = `
## Forbidden

- Never delete files in prisma/migrations/
- Never install new npm packages without noting it in PR description
- **Never** \`prisma migrate reset\` or direct-UPDATE \`_prisma_migrations\` without explicit user approval
`

describe('isRejudgeableCategory', () => {
  it('admits exactly the two categories whose criterion was fixed', () => {
    expect(isRejudgeableCategory('POLICY_WEAKENING')).toBe(true)
    expect(isRejudgeableCategory('TEST_FILE_DELETED')).toBe(true)
    expect(isRejudgeableCategory('PROJECT_RULE_VIOLATION')).toBe(false)
    expect(isRejudgeableCategory('HARDCODED_SECRET')).toBe(false)
  })
})

describe('normalizeForPresence / ruleTextFromDetail', () => {
  it('folds case, backticks, asterisks and whitespace', () => {
    expect(normalizeForPresence('  **Never**   `migrate  reset`  ')).toBe(
      'never migrate reset'
    )
  })
  it('recovers the quoted rule text from an emitted detail', () => {
    expect(
      ruleTextFromDetail(
        'A deterministic Forbidden rule was removed from CLAUDE.md: "Never hardcode API keys or secrets"'
      )
    ).toBe('Never hardcode API keys or secrets')
  })
  it('refuses a clipped detail whose closing quote is gone', () => {
    expect(
      ruleTextFromDetail(
        'A deterministic Forbidden rule was removed from CLAUDE.md: "use only `prisma migrate deploy` — never `migrate dev`, `db push`…'
      )
    ).toBeNull()
  })
})

describe('ruleTextPresentIn — the rule side tolerates a trailing classifier gloss, the source is never loosened', () => {
  // The exact production sentence (CLAUDE.md, "Production" bullet) and the
  // exact text the classifier extracted for it — with its own bracketed gloss.
  const PROD_LINE =
    '- **Production**: … Even with authorization: (a) confirm the exact migration(s) about to apply and call out any data-destructive steps before running anything, (b) use **only** `prisma migrate deploy` — never `migrate dev`, `db push`, `migrate reset`, or direct edits to `_prisma_migrations`, (c) verify with `prisma migrate status` against the prod URL afterward.'
  const EXTRACTED =
    'use only `prisma migrate deploy` — never `migrate dev`, `db push`, `migrate reset`, or direct edits to `_prisma_migrations` [for production migrations]'

  it('strips only a TRAILING [gloss] and trailing punctuation from the rule text', () => {
    expect(normalizeRuleTextForPresence(EXTRACTED)).toBe(
      'use only prisma migrate deploy — never migrate dev, db push, migrate reset, or direct edits to _prisma_migrations'
    )
    expect(normalizeRuleTextForPresence('Never push to main.')).toBe(
      'never push to main'
    )
    // A bracket in the middle is part of the rule, not a gloss.
    expect(normalizeRuleTextForPresence('use [only] deploy')).toBe(
      'use [only] deploy'
    )
  })

  it('finds the glossed production rule in its source line (the 14-row false positive)', () => {
    expect(ruleTextPresentIn(PROD_LINE, EXTRACTED)).toBe(true)
  })

  it('still refuses a rule whose own words are not in the source, and an empty rule', () => {
    expect(
      ruleTextPresentIn(PROD_LINE, 'never run migrate deploy [for production]')
    ).toBe(false)
    expect(ruleTextPresentIn(PROD_LINE, '[only a gloss]')).toBe(false)
    expect(ruleTextPresentIn(PROD_LINE, '')).toBe(false)
  })

  it('the source side is not loosened — a gloss in the SOURCE does not help a rule that lacks it', () => {
    // Symmetric stripping would make these equal; only the rule side strips.
    expect(
      ruleTextPresentIn('never push [to main]', 'never push to main')
    ).toBe(false)
  })
})

describe('rejudgePolicyWeakening (criterion: is the rule text still in the source)', () => {
  const version = REJUDGE_CRITERION_VERSION.POLICY_WEAKENING

  it('CAUSE_GONE when the stamped rule text is still in the source, proposing MEDIUM advisory', () => {
    const v = rejudgePolicyWeakening(
      {
        detail:
          'A deterministic Forbidden rule was removed from CLAUDE.md: "x"',
        policyRuleText:
          'Never install new npm packages without noting it in PR description',
      },
      CLAUDE_MD
    )
    expect(v.outcome).toBe('CAUSE_GONE')
    expect(v.reason).toBe('RULE_TEXT_PRESENT')
    expect(v.criterionVersion).toBe(version)
    expect(v.write).toEqual({
      severity: 'MEDIUM',
      detail: expect.stringContaining('UNCHANGED in CLAUDE.md'),
    })
    expect(v.write?.detail).toContain('LUM-780')
    expect(v.evidence).toContain('still in the current')
  })

  it('matches markdown-insensitively — the source keeps ** and backticks the classifier stripped', () => {
    const v = rejudgePolicyWeakening(
      {
        detail: '',
        policyRuleText:
          'Never prisma migrate reset or direct-UPDATE _prisma_migrations without explicit user approval',
      },
      CLAUDE_MD
    )
    expect(v.outcome).toBe('CAUSE_GONE')
  })

  it('CAUSE_GONE for the glossed production rule text against the real CLAUDE.md sentence', () => {
    const v = rejudgePolicyWeakening(
      {
        detail: '',
        policyRuleText:
          'use only `prisma migrate deploy` — never `migrate dev`, `db push`, `migrate reset`, or direct edits to `_prisma_migrations` [for production migrations]',
      },
      '(b) use **only** `prisma migrate deploy` — never `migrate dev`, `db push`, `migrate reset`, or direct edits to `_prisma_migrations`, (c) verify'
    )
    expect(v.outcome).toBe('CAUSE_GONE')
    expect(v.reason).toBe('RULE_TEXT_PRESENT')
  })

  it('falls back to the rule text quoted in the detail when the row has none', () => {
    const v = rejudgePolicyWeakening(
      {
        detail:
          'A deterministic Forbidden rule was downgraded (deterministic -> semantic): "Never delete files in prisma/migrations/"',
        policyRuleText: null,
      },
      CLAUDE_MD
    )
    expect(v.outcome).toBe('CAUSE_GONE')
    expect(v.reason).toBe('RULE_TEXT_PRESENT')
  })

  it('STILL_HOLDS (no write) when the rule text really left the source', () => {
    const v = rejudgePolicyWeakening(
      { detail: '', policyRuleText: 'Never push to main or develop directly' },
      CLAUDE_MD
    )
    expect(v.outcome).toBe('STILL_HOLDS')
    expect(v.reason).toBe('RULE_TEXT_ABSENT')
    expect(v.write).toBeUndefined()
    expect(v.evidence).toContain('no longer in the current')
  })

  it('UNDECIDABLE when the rule text cannot be recovered (clipped detail, no stamp)', () => {
    const v = rejudgePolicyWeakening(
      {
        detail:
          'A deterministic Forbidden rule was removed from CLAUDE.md: "use only `prisma migrate deploy` — never…',
        policyRuleText: null,
      },
      CLAUDE_MD
    )
    expect(v.outcome).toBe('UNDECIDABLE')
    expect(v.reason).toBe('RULE_TEXT_UNKNOWN')
    expect(v.write).toBeUndefined()
  })

  it('UNDECIDABLE when the source could not be read — never a guess', () => {
    const v = rejudgePolicyWeakening(
      {
        detail: '',
        policyRuleText: 'Never delete files in prisma/migrations/',
      },
      null
    )
    expect(v.outcome).toBe('UNDECIDABLE')
    expect(v.reason).toBe('SOURCE_UNREADABLE')
    expect(v.write).toBeUndefined()
  })

  it('an empty rule text is unknown, not trivially present', () => {
    const v = rejudgePolicyWeakening(
      { detail: '', policyRuleText: '   ' },
      CLAUDE_MD
    )
    expect(v.outcome).toBe('UNDECIDABLE')
    expect(v.reason).toBe('RULE_TEXT_UNKNOWN')
  })
})

describe('removedTestFiles', () => {
  it('counts only `removed` entries on test paths — a rename or a non-test deletion is not a test deletion', () => {
    expect(
      removedTestFiles([
        { filename: '__tests__/a.test.ts', status: 'removed' },
        { filename: '__tests__/b.test.ts', status: 'renamed' },
        { filename: '__tests__/c.test.ts', status: 'modified' },
        { filename: 'lib/x.ts', status: 'removed' },
        { filename: 'src/foo.spec.tsx', status: 'removed' },
      ])
    ).toEqual(['__tests__/a.test.ts', 'src/foo.spec.tsx'])
  })
})

describe('rejudgeTestFileDeleted (criterion: is a tracked test file actually missing)', () => {
  const version = REJUDGE_CRITERION_VERSION.TEST_FILE_DELETED
  const row = {
    detail: 'rm -f __tests__/zz-probe.test.ts; git status --porcelain',
    severity: 'MEDIUM' as const,
  }

  it('CAUSE_GONE when every linked PR is readable and none removes a tracked test file', () => {
    const v = rejudgeTestFileDeleted(row, [
      {
        number: 990,
        files: [
          { filename: 'lib/a.ts', status: 'modified' },
          { filename: '__tests__/a.test.ts', status: 'added' },
        ],
      },
      { number: 991, files: [] },
    ])
    expect(v.outcome).toBe('CAUSE_GONE')
    expect(v.reason).toBe('NO_TEST_FILE_REMOVED')
    expect(v.criterionVersion).toBe(version)
    expect(v.evidence).toContain('#990, #991')
    expect(v.write).toEqual({
      severity: 'MEDIUM',
      detail: expect.stringContaining(
        'advisory — rm -f __tests__/zz-probe.test.ts'
      ),
    })
    expect(v.write?.detail).toContain('LUM-780')
  })

  it('keeps the row severity on the proposed write', () => {
    const v = rejudgeTestFileDeleted({ ...row, severity: 'HIGH' }, [
      { number: 1, files: [] },
    ])
    expect(v.write?.severity).toBe('HIGH')
  })

  it('STILL_HOLDS (no write) when any linked PR removes a tracked test file, naming it', () => {
    const v = rejudgeTestFileDeleted(row, [
      { number: 990, files: [] },
      {
        number: 991,
        files: [{ filename: '__tests__/gone.test.ts', status: 'removed' }],
      },
    ])
    expect(v.outcome).toBe('STILL_HOLDS')
    expect(v.reason).toBe('TEST_FILE_REMOVED_IN_PR')
    expect(v.evidence).toContain('__tests__/gone.test.ts (PR #991)')
    expect(v.write).toBeUndefined()
  })

  it('UNDECIDABLE with no linked PR — nothing external can vouch', () => {
    const v = rejudgeTestFileDeleted(row, [])
    expect(v.outcome).toBe('UNDECIDABLE')
    expect(v.reason).toBe('NO_LINKED_PR')
    expect(v.write).toBeUndefined()
  })

  it('UNDECIDABLE when any PR file list is unreadable, even if the others are clean', () => {
    const v = rejudgeTestFileDeleted(row, [
      { number: 990, files: [] },
      { number: 991, files: null },
    ])
    expect(v.outcome).toBe('UNDECIDABLE')
    expect(v.reason).toBe('PR_FILES_UNREADABLE')
    expect(v.evidence).toContain('#991')
    expect(v.write).toBeUndefined()
  })

  it('an unreadable list wins over a removal seen elsewhere (fail-closed, never a partial verdict)', () => {
    const v = rejudgeTestFileDeleted(row, [
      { number: 990, files: null },
      {
        number: 991,
        files: [{ filename: '__tests__/gone.test.ts', status: 'removed' }],
      },
    ])
    expect(v.outcome).toBe('UNDECIDABLE')
  })

  it('never re-judges an evasion-decoded row, whatever the PRs say', () => {
    const v = rejudgeTestFileDeleted(
      { ...row, detail: `${EVASION_MARKER}${row.detail}` },
      [{ number: 990, files: [] }]
    )
    expect(v.outcome).toBe('UNDECIDABLE')
    expect(v.reason).toBe('EVASION_DECODED')
    expect(v.write).toBeUndefined()
  })
})
