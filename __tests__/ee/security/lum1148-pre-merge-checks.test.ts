/**
 * LUM-1148 — the pure half of the pre-merge checks: the setting's defaults
 * and parsing, which checks each mode runs, how answers map to results,
 * what blocks approval (only a failed `error` check, never an inconclusive
 * one, never after an override), who may override, and the summary block.
 */
import {
  DEFAULT_PRE_MERGE_CHECKS,
  PRE_MERGE_CUSTOM_CHECKS_MAX,
  applyPreMergeChecksUpdate,
  blockingCheckCount,
  checkStatus,
  checksForHead,
  customCheckId,
  formatPreMergeChecks,
  inconclusiveResults,
  keepEarlierFailures,
  normalizeCustomChecks,
  overrideEligibility,
  parsePreMergeChecksRecord,
  parsePreMergeChecksSetting,
  planPreMergeChecks,
  resultsFromAnswers,
  type PreMergeCheckResult,
  type PreMergeChecksRecord,
  type PreMergeChecksSetting,
} from '@/ee/security/security-scan/pre-merge-checks'

const PR = { title: 'update', body: '', template: null }

function setting(
  over: Partial<PreMergeChecksSetting> = {}
): PreMergeChecksSetting {
  return { ...parsePreMergeChecksSetting(null), ...over }
}

function result(over: Partial<PreMergeCheckResult> = {}): PreMergeCheckResult {
  return {
    id: 'title',
    name: 'Title',
    kind: 'builtin',
    mode: 'error',
    verdict: 'failed',
    explanation: 'Too vague.',
    resolution: 'Say what changed.',
    ...over,
  }
}

const rec = (results: PreMergeCheckResult[]): PreMergeChecksRecord => ({
  headSha: 'a'.repeat(40),
  ranAt: '2026-10-15T00:00:00Z',
  results,
})

describe('setting', () => {
  it('defaults: title and description warn, no custom checks, anyone may override', () => {
    expect(parsePreMergeChecksSetting(null)).toEqual({
      title: { mode: 'warning', requirements: null },
      description: { mode: 'warning' },
      // LUM-1149: the linked task / issue assessment.
      issueAssessment: { mode: 'warning', taskDetailsOnPublicRepos: false },
      customChecks: [],
      overrideRequestedReviewersOnly: false,
    })
    expect(DEFAULT_PRE_MERGE_CHECKS.title.mode).toBe('warning')
  })

  it('a malformed stored value falls back key by key', () => {
    expect(
      parsePreMergeChecksSetting({
        title: { mode: 'loud', requirements: '  feat: prefix  ' },
        description: { mode: 'error' },
        customChecks: 'nope',
        overrideRequestedReviewersOnly: 'yes',
      })
    ).toEqual({
      title: { mode: 'warning', requirements: 'feat: prefix' },
      description: { mode: 'error' },
      issueAssessment: { mode: 'warning', taskDetailsOnPublicRepos: false },
      customChecks: [],
      overrideRequestedReviewersOnly: false,
    })
  })

  it('custom checks: named, with a rule, unique (any case), default warning, capped', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      name: `Check ${i}`,
      instructions: 'x',
    }))
    expect(normalizeCustomChecks(many)).toHaveLength(
      PRE_MERGE_CUSTOM_CHECKS_MAX
    )
    expect(
      normalizeCustomChecks([
        { name: 'No TODO', instructions: 'No TODO comments.', mode: 'error' },
        { name: 'no todo', instructions: 'dup' },
        { name: '', instructions: 'unnamed' },
        { name: 'Empty', instructions: '  ' },
        { name: 'Changelog', instructions: 'Update CHANGELOG.md.' },
      ])
    ).toEqual([
      { name: 'No TODO', mode: 'error', instructions: 'No TODO comments.' },
      {
        name: 'Changelog',
        mode: 'warning',
        instructions: 'Update CHANGELOG.md.',
      },
    ])
  })

  it('a partial update keeps what it does not name; "" clears the requirements', () => {
    const from = setting({
      title: { mode: 'warning', requirements: 'feat: prefix' },
    })
    const to = applyPreMergeChecksUpdate(from, {
      title: { mode: 'error', requirements: '' },
      overrideRequestedReviewersOnly: true,
    })
    expect(to.title).toEqual({ mode: 'error', requirements: null })
    expect(to.description).toEqual(from.description)
    expect(to.overrideRequestedReviewersOnly).toBe(true)
    expect(
      applyPreMergeChecksUpdate(to, {
        customChecks: [{ name: 'A', mode: 'off', instructions: 'r' }],
      }).customChecks
    ).toEqual([{ name: 'A', mode: 'off', instructions: 'r' }])
  })
})

describe('planPreMergeChecks — each mode', () => {
  it('off checks are not run; warning and error are', () => {
    const planned = planPreMergeChecks(
      setting({
        title: {
          mode: 'error',
          requirements: 'Start with feat:, fix: or chore:',
        },
        description: { mode: 'off' },
        issueAssessment: { mode: 'off', taskDetailsOnPublicRepos: false },
        customChecks: [
          { name: 'Changelog', mode: 'warning', instructions: 'Update it.' },
          { name: 'Off one', mode: 'off', instructions: 'never' },
        ],
      }),
      PR
    )
    expect(planned.map(p => [p.id, p.mode])).toEqual([
      ['title', 'error'],
      [customCheckId('Changelog'), 'warning'],
    ])
    expect(planned[0]!.rule).toMatch(/Start with feat:, fix: or chore:/)
  })

  it('the description rule follows the template when the repository has one', () => {
    const [, withTemplate] = planPreMergeChecks(setting(), {
      ...PR,
      template: '## Summary',
    })
    const [, without] = planPreMergeChecks(setting(), PR)
    expect(withTemplate!.rule).toMatch(/template/)
    expect(without!.rule).not.toMatch(/template/)
  })

  it('a registered built-in plugs in (the LUM-1149 extension point)', () => {
    const gather = jest.fn()
    const planned = planPreMergeChecks(setting(), PR, [
      {
        id: 'issues',
        name: 'Linked issues',
        mode: () => 'error',
        rule: () => 'The PR does what its linked issue asks.',
        gather,
      },
    ])
    expect(planned).toEqual([
      expect.objectContaining({ id: 'issues', kind: 'builtin', gather }),
    ])
  })
})

describe('answers → results', () => {
  const planned = planPreMergeChecks(setting(), PR)

  it('maps verdicts by id; a missing or unknown answer is inconclusive', () => {
    const results = resultsFromAnswers(planned, [
      {
        id: 'title',
        verdict: 'failed',
        explanation: 'Says [update](https://evil.example) <b>x</b>',
        resolution: 'Rename it.',
      },
      { id: 'description', verdict: 'maybe', explanation: '?' },
    ])
    expect(results[0]).toMatchObject({ verdict: 'failed', mode: 'warning' })
    expect(results[0]!.explanation).not.toMatch(/https|<b>/)
    expect(results[1]!.verdict).toBe('inconclusive')
    expect(resultsFromAnswers(planned, [])[0]).toMatchObject({
      verdict: 'inconclusive',
      explanation: 'Lumo did not get an answer for this check.',
    })
  })

  it('a passed check carries no resolution', () => {
    const [r] = resultsFromAnswers(planned, [
      { id: 'title', verdict: 'passed', explanation: 'ok', resolution: 'x' },
    ])
    expect(r!.resolution).toBeNull()
  })

  it('a failed model call makes every check inconclusive', () => {
    expect(
      inconclusiveResults(planned, 'down').every(
        r => r.verdict === 'inconclusive'
      )
    ).toBe(true)
  })

  it('the stored record round-trips; malformed rows are dropped', () => {
    const raw = {
      ...rec([result()]),
      results: [result(), { id: 'x', name: 'X', verdict: 'nope' }, 7],
    }
    expect(parsePreMergeChecksRecord(raw)!.results).toEqual([result()])
    expect(parsePreMergeChecksRecord('x')).toBeNull()
  })
})

describe('keepEarlierFailures — a failed run never clears a failure', () => {
  const now = [
    result({ verdict: 'inconclusive', resolution: null, explanation: 'n/a' }),
    result({
      id: 'description',
      name: 'Description',
      mode: 'warning',
      verdict: 'inconclusive',
      resolution: null,
    }),
  ]

  it('an earlier failure of the same check stands, in its current mode', () => {
    const earlier = rec([
      result({ mode: 'warning', explanation: 'vague', resolution: 'fix' }),
      result({ id: 'description', verdict: 'passed', resolution: null }),
    ])
    const kept = keepEarlierFailures(now, earlier)
    expect(kept[0]).toMatchObject({
      id: 'title',
      mode: 'error',
      verdict: 'failed',
      explanation: 'vague',
      resolution: 'fix',
    })
    // An earlier pass is not carried over: this run could not confirm it.
    expect(kept[1]!.verdict).toBe('inconclusive')
    expect(blockingCheckCount(rec(kept), null)).toBe(1)
  })

  it('no earlier record ⇒ unchanged', () => {
    expect(keepEarlierFailures(now, null)).toEqual(now)
  })
})

describe('what blocks', () => {
  it('only a failed `error` check counts', () => {
    expect(
      blockingCheckCount(
        rec([
          result(),
          result({ id: 'b', mode: 'warning' }),
          result({ id: 'c', verdict: 'inconclusive' }),
          result({ id: 'd', verdict: 'passed' }),
        ]),
        null
      )
    ).toBe(1)
  })

  it('an inconclusive `error` check never blocks', () => {
    expect(
      blockingCheckCount(rec([result({ verdict: 'inconclusive' })]), null)
    ).toBe(0)
  })

  it('an override clears the checks (and only them)', () => {
    const override = { login: 'rev', at: new Date(), headSha: null }
    expect(blockingCheckCount(rec([result()]), override)).toBe(0)
    expect(checkStatus(result(), true)).toBe('ignored')
    expect(checkStatus(result({ verdict: 'passed' }), true)).toBe('passed')
    expect(checkStatus(result({ mode: 'warning' }), false)).toBe('warning')
  })

  it('no record ⇒ nothing blocks', () => {
    expect(blockingCheckCount(null, null)).toBe(0)
  })
})

describe('who may override', () => {
  const base = {
    login: 'bob',
    authorLogin: 'alice',
    reviewersOnly: false,
    authorAllowed: true,
    requestedReviewers: [] as string[],
    reviewedBy: [] as string[],
  }

  it('default: anyone with write access, the author included', () => {
    expect(overrideEligibility(base)).toEqual({ ok: true })
    expect(overrideEligibility({ ...base, login: 'Alice' })).toEqual({
      ok: true,
    })
  })

  it('default with author approval off: the author is refused', () => {
    expect(
      overrideEligibility({ ...base, login: 'alice', authorAllowed: false })
    ).toEqual({ ok: false, reason: 'author' })
  })

  it('reviewers only: the author is refused, even when requested', () => {
    expect(
      overrideEligibility({
        ...base,
        login: 'alice',
        reviewersOnly: true,
        requestedReviewers: ['alice'],
      })
    ).toEqual({ ok: false, reason: 'author' })
  })

  it('reviewers only: a requested (or already-reviewing) reviewer may, anyone else not', () => {
    const ro = { ...base, reviewersOnly: true }
    expect(overrideEligibility({ ...ro, requestedReviewers: ['BOB'] })).toEqual(
      { ok: true }
    )
    expect(overrideEligibility({ ...ro, reviewedBy: ['bob'] })).toEqual({
      ok: true,
    })
    expect(overrideEligibility(ro)).toEqual({
      ok: false,
      reason: 'not_requested_reviewer',
    })
  })

  it('reviewers only with an unknown author: refused (it could be the asker)', () => {
    expect(
      overrideEligibility({
        ...base,
        authorLogin: null,
        reviewersOnly: true,
        requestedReviewers: ['bob'],
      })
    ).toEqual({ ok: false, reason: 'author' })
  })
})

describe('summary block', () => {
  const opts = { handle: '@uselumo', requestChanges: true }

  it('null when no check ran', () => {
    expect(formatPreMergeChecks(null, null, opts)).toBeNull()
    expect(formatPreMergeChecks(rec([]), null, opts)).toBeNull()
  })

  it('failed rows in a table, passed folded, the way out named', () => {
    const md = formatPreMergeChecks(
      rec([
        result(),
        result({
          id: customCheckId('No | pipes'),
          name: 'No | pipes',
          kind: 'custom',
          mode: 'warning',
          explanation: 'a | b `c`',
        }),
        result({ id: 'description', name: 'Description', verdict: 'passed' }),
      ]),
      null,
      opts
    )!
    expect(md).toMatch(
      /^\*\*Pre-merge checks:\*\* 1 error · 1 warning · 1 passed/
    )
    expect(md).toContain('| No \\| pipes | ⚠️ Warning | a \\| b  c |')
    expect(md).toContain('<summary>Passed checks (1)</summary>')
    expect(md).toContain('`@uselumo ignore pre-merge checks`')
  })

  it('an override is named, never a mention', () => {
    const md = formatPreMergeChecks(
      rec([result()]),
      { login: '@evil<x>', at: new Date(), headSha: 'b'.repeat(40) },
      opts
    )!
    expect(md).toMatch(/1 ignored/)
    expect(md).toMatch(/overridden by evilx at `bbbbbbb`/)
    expect(md).not.toMatch(/@evil/)
  })
})

describe('checksForHead', () => {
  it('only the results of this head count — a record without a head never does', () => {
    const r = rec([result()])
    expect(checksForHead(r, r.headSha)).not.toBeNull()
    expect(checksForHead(r, 'c'.repeat(40))).toBeNull()
    expect(checksForHead({ ...r, headSha: undefined }, r.headSha)).toBeNull()
  })
})
