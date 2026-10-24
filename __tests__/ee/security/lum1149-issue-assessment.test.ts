/**
 * @jest-environment node
 *
 * LUM-1149 — the linked task / issue assessment (pure half): which
 * requirements a task and a PR description yield, each outcome and what it
 * makes the check, the summary block and the unmet-requirements review
 * comment, and the public-repository privacy default.
 */
import {
  ISSUE_ASSESSMENT_CHECK_ID,
  LINKED_ISSUES_MAX,
  TASK_REQUIREMENTS_MAX,
  WITHHELD_NOTE,
  assessRequirements,
  assessmentSummary,
  assessmentVerdict,
  buildUnmetRequirementsReview,
  extractTaskRequirements,
  extractTaskDecisions,
  REQUIREMENT_TEXT_MAX,
  formatRequirementsBlock,
  hasUnmetMarker,
  issueRequirement,
  linkedIssueNumbers,
  parseRequirementAssessments,
  requirementLine,
  requirementsMaterial,
  unclearRequirements,
  unmetKey,
  unmetMarker,
  type LinkedRequirement,
  type RequirementAssessment,
} from '@/ee/security/security-scan/issue-assessment'
import {
  blockingCheckCount,
  checkStatus,
  formatPreMergeChecks,
  inconclusiveResults,
  keepEarlierFailures,
  notApplicableResult,
  parsePreMergeChecksRecord,
  parsePreMergeChecksSetting,
  planPreMergeChecks,
  resultsFromAnswers,
  type PlannedPreMergeCheck,
  type PreMergeCheckResult,
} from '@/ee/security/security-scan/pre-merge-checks'

const BRIEF = [
  '## Context',
  '',
  'Some context.',
  '',
  '## Goal',
  '',
  'Export invoices as CSV from the billing page.',
  '',
  '## Non-goals',
  '',
  '-   PDF export',
  '',
  '## Done when',
  '',
  '-   A CSV download button on the billing page',
  '-   Amounts are formatted',
  '    with two decimals',
  '    -   nested detail stays with its item',
  '-   [ ] Production probe passes',
  '',
  '## Decisions',
  '',
  '-   2026-10-15: no PDF',
].join('\n')

function task(markdown: string | null, quotable = true) {
  return extractTaskRequirements({
    identifier: 'LUM-12',
    title: 'CSV export',
    markdown,
    quotable,
  })
}

describe('extractTaskRequirements', () => {
  it('the Goal is one requirement, each Done-when item one more (other sections ignored)', () => {
    const reqs = task(BRIEF)
    expect(reqs.map(r => [r.id, r.label])).toEqual([
      ['task:goal', 'LUM-12 · Goal'],
      ['task:done:1', 'LUM-12 · Requirement 1 of 3'],
      ['task:done:2', 'LUM-12 · Requirement 2 of 3'],
      ['task:done:3', 'LUM-12 · Requirement 3 of 3'],
    ])
    expect(reqs[0]!.text).toBe('Export invoices as CSV from the billing page.')
    expect(reqs[2]!.text).toBe(
      'Amounts are formatted with two decimals -   nested detail stays with its item'.replace(
        /\s+/g,
        ' '
      )
    )
    expect(reqs[3]!.text).toBe('Production probe passes')
    expect(reqs.every(r => r.source === 'task' && r.quotable)).toBe(true)
    expect(reqs.map(r => r.text).join(' ')).not.toMatch(/PDF|context/)
  })

  it('template hints left unfilled are not requirements', () => {
    expect(
      task(
        '## Goal\n\n_What this task delivers._\n\n## Done when\n\n_Each item…_'
      )
    ).toEqual([])
  })

  it('a description without the sections is one requirement; none at all yields nothing', () => {
    const reqs = task('Make the header sticky on scroll.')
    expect(reqs).toEqual([
      expect.objectContaining({
        id: 'task:description',
        label: 'LUM-12 · Description',
        text: 'CSV export: Make the header sticky on scroll.',
      }),
    ])
    expect(task(null)).toEqual([])
    expect(task('   ')).toEqual([])
  })

  it('caps the number of requirements and carries the privacy flag', () => {
    const many = `## Done when\n\n${Array.from(
      { length: 30 },
      (_, i) => `- item ${i}`
    ).join('\n')}`
    const reqs = task(many, false)
    expect(reqs).toHaveLength(TASK_REQUIREMENTS_MAX)
    expect(reqs.every(r => !r.quotable)).toBe(true)
    expect(reqs[0]!.label).toBe('LUM-12 · Requirement 1 of 30')
  })

  it('a Done-when section without list items is requirement 1 of 1', () => {
    expect(
      task('## Done when\n\nThe export opens in Excel.').map(r => [
        r.id,
        r.label,
      ])
    ).toEqual([['task:done:1', 'LUM-12 · Requirement 1 of 1']])
  })
})

describe('linkedIssueNumbers', () => {
  it('closing keywords and issue URLs of the same repository, in order, deduplicated', () => {
    expect(
      linkedIssueNumbers(
        'Closes #12. Also fixes acme/app#7 and resolves https://github.com/acme/app/issues/12\nSee https://github.com/Acme/App/issues/9',
        'acme/app'
      )
    ).toEqual([12, 7, 9])
  })

  it('other repositories, bare mentions and code are ignored; capped', () => {
    expect(
      linkedIssueNumbers(
        'Relates to #4. Fixes other/repo#5. `closes #6`\n```\nfixes #7\n```\nhttps://github.com/other/repo/issues/8 <!-- closes #9 -->',
        'acme/app'
      )
    ).toEqual([])
    expect(
      linkedIssueNumbers('fixes #1, fixes #2, fixes #3, fixes #4', 'acme/app')
    ).toHaveLength(LINKED_ISSUES_MAX)
  })
})

describe('issueRequirement', () => {
  it('one issue is one quotable requirement (title + body, comments stripped)', () => {
    expect(
      issueRequirement({
        number: 45,
        title: 'Dark mode',
        body: '<!-- template -->Support a dark theme.',
      })
    ).toEqual({
      id: 'issue:45',
      source: 'issue',
      label: '#45',
      text: 'Dark mode: Support a dark theme.',
      quotable: true,
    })
    expect(issueRequirement({ number: 1, title: '', body: '' })).toBeNull()
  })
})

const REQS: LinkedRequirement[] = [
  {
    id: 'task:done:1',
    source: 'task',
    label: 'LUM-12 · Requirement 1 of 2',
    text: 'A CSV download button',
    quotable: true,
  },
  {
    id: 'task:done:2',
    source: 'task',
    label: 'LUM-12 · Requirement 2 of 2',
    text: 'Amounts have two decimals',
    quotable: true,
  },
]

describe('each outcome', () => {
  it('addressed / not addressed / unclear map onto the requirements; a skipped one is unclear', () => {
    const a = assessRequirements(
      [...REQS, { ...REQS[0]!, id: 'issue:3', label: '#3', source: 'issue' }],
      [
        { id: 'task:done:1', outcome: 'addressed', explanation: 'Adds it.' },
        {
          id: 'task:done:2',
          outcome: 'not_addressed',
          explanation: 'No formatting.',
        },
        { id: 'issue:3', outcome: 'banana' },
      ]
    )
    expect(a.map(r => r.outcome)).toEqual([
      'addressed',
      'not_addressed',
      'unclear',
    ])
    expect(
      assessRequirements(REQS, []).every(r => r.outcome === 'unclear')
    ).toBe(true)
  })

  it('the check: any Not addressed fails; else any Unclear is inconclusive; else passed', () => {
    const of = (...o: RequirementAssessment['outcome'][]) =>
      assessmentVerdict(
        o.map((outcome, i) => ({
          id: `r${i}`,
          source: 'task',
          label: 'x',
          text: null,
          quotable: false,
          outcome,
          explanation: '',
        }))
      )
    expect(of('addressed', 'addressed')).toBe('passed')
    expect(of('addressed', 'unclear')).toBe('inconclusive')
    expect(of('unclear', 'not_addressed')).toBe('failed')
  })

  it('the check row says how many of each, and what to do', () => {
    const a = assessRequirements(REQS, [
      { id: 'task:done:1', outcome: 'addressed', explanation: '' },
      { id: 'task:done:2', outcome: 'not_addressed', explanation: '' },
    ])
    expect(assessmentSummary(a)).toEqual({
      explanation: '2 linked requirements: 1 addressed, 1 not addressed.',
      resolution: expect.stringMatching(/Not addressed/),
    })
  })

  it('unclearRequirements: every requirement unclear with the reason', () => {
    expect(unclearRequirements(REQS, 'down')).toEqual([
      expect.objectContaining({ outcome: 'unclear', explanation: 'down' }),
      expect.objectContaining({ outcome: 'unclear', explanation: 'down' }),
    ])
  })

  it('the material lists each requirement by id for the model', () => {
    expect(requirementsMaterial(REQS)).toBe(
      "Answer each of these 2 requirement ids exactly once: task:done:1, task:done:2. A broad requirement (such as a task's Goal) that neither the diff nor the evidence below can show is still answered — as unclear.\n- [task:done:1] (LUM-12 · Requirement 1 of 2) A CSV download button\n- [task:done:2] (LUM-12 · Requirement 2 of 2) Amounts have two decimals"
    )
  })
})

const SETTING = parsePreMergeChecksSetting(null)
const PR = { title: 't', body: 'b', template: null }

function plannedIssueCheck(mode: 'warning' | 'error' = 'error') {
  return planPreMergeChecks(
    {
      ...SETTING,
      title: { mode: 'off', requirements: null },
      description: { mode: 'off' },
      issueAssessment: { mode, taskDetailsOnPublicRepos: false },
    },
    PR
  )
}

describe('the built-in check', () => {
  it('is planned by default (warning) and assesses requirements', () => {
    const p = planPreMergeChecks(SETTING, PR).find(
      c => c.id === ISSUE_ASSESSMENT_CHECK_ID
    )
    expect(p).toMatchObject({ mode: 'warning', assessesRequirements: true })
    expect(
      planPreMergeChecks(
        {
          ...SETTING,
          issueAssessment: { mode: 'off', taskDetailsOnPublicRepos: false },
        },
        PR
      ).map(c => c.id)
    ).not.toContain(ISSUE_ASSESSMENT_CHECK_ID)
  })

  it('one Addressed + one Not addressed ⇒ failed (blocks in error mode)', () => {
    const planned = plannedIssueCheck('error')
    const [r] = resultsFromAnswers(
      planned,
      [
        {
          id: ISSUE_ASSESSMENT_CHECK_ID,
          verdict: 'passed', // the check-level verdict is not read
          requirements: [
            { id: 'task:done:1', outcome: 'addressed', explanation: 'ok' },
            { id: 'task:done:2', outcome: 'not_addressed', explanation: 'no' },
          ],
        },
      ],
      new Map([[ISSUE_ASSESSMENT_CHECK_ID, REQS]])
    )
    expect(r).toMatchObject({ verdict: 'failed', mode: 'error' })
    expect(r!.requirements!.map(x => x.outcome)).toEqual([
      'addressed',
      'not_addressed',
    ])
    expect(
      blockingCheckCount({ headSha: 'h', ranAt: '', results: [r!] }, null)
    ).toBe(1)
  })

  it('no linked task or issue ⇒ not applicable: never failed, never blocking, never overridden', () => {
    const na = notApplicableResult(plannedIssueCheck('error')[0]!)
    expect(na.verdict).toBe('not_applicable')
    expect(checkStatus(na, false)).toBe('not_applicable')
    expect(checkStatus(na, true)).toBe('not_applicable')
    expect(
      blockingCheckCount({ headSha: 'h', ranAt: '', results: [na] }, null)
    ).toBe(0)
    const text = formatPreMergeChecks(
      { headSha: 'h', ranAt: '', results: [na] },
      null,
      { handle: '@uselumo', requestChanges: true }
    )!
    expect(text).toMatch(/1 not applicable/)
    expect(text).toMatch(/Passed and not applicable checks \(1\)/)
    expect(text).toMatch(/➖ Not applicable/)
    expect(text).not.toMatch(/❌/)
  })

  it('a failed model call: requirements unclear (inconclusive), an earlier failure of the head kept with its requirements', () => {
    const planned = plannedIssueCheck('error')
    const linked = new Map([[ISSUE_ASSESSMENT_CHECK_ID, REQS]])
    const now = inconclusiveResults(planned, 'down', linked)
    expect(now[0]).toMatchObject({ verdict: 'inconclusive' })
    expect(now[0]!.requirements!.every(r => r.outcome === 'unclear')).toBe(true)
    const earlier = resultsFromAnswers(
      planned,
      [
        {
          id: ISSUE_ASSESSMENT_CHECK_ID,
          verdict: 'failed',
          requirements: [
            { id: 'task:done:1', outcome: 'not_addressed', explanation: 'x' },
          ],
        },
      ],
      linked
    )
    const kept = keepEarlierFailures(now, {
      headSha: 'h',
      ranAt: '',
      results: earlier,
    })
    expect(kept[0]!.verdict).toBe('failed')
    expect(kept[0]!.requirements![0]!.outcome).toBe('not_addressed')
  })

  it('the stored record round-trips (not_applicable, requirements); unquotable text is never read back', () => {
    const record = parsePreMergeChecksRecord({
      headSha: 'h',
      ranAt: 'r',
      results: [
        {
          id: ISSUE_ASSESSMENT_CHECK_ID,
          name: 'Issue assessment',
          kind: 'builtin',
          mode: 'warning',
          verdict: 'failed',
          explanation: 'e',
          resolution: 'r',
          requirements: [
            {
              id: 'task:goal',
              source: 'task',
              label: 'LUM-12 · Goal',
              text: 'secret plan',
              quotable: false,
              outcome: 'not_addressed',
              explanation: 'missing',
            },
            { id: 'bad', label: 'x', outcome: 'maybe' },
          ],
        },
        {
          id: 'x',
          name: 'X',
          kind: 'builtin',
          mode: 'warning',
          verdict: 'not_applicable',
          explanation: '',
        },
      ],
    })!
    expect(record.results.map(r => r.verdict)).toEqual([
      'failed',
      'not_applicable',
    ])
    expect(record.results[0]!.requirements).toEqual([
      expect.objectContaining({ id: 'task:goal', text: null }),
    ])
    expect(parseRequirementAssessments('nope')).toBeUndefined()
  })
})

function assessed(quotable: boolean): RequirementAssessment[] {
  return assessRequirements(
    REQS.map(r => ({ ...r, quotable })),
    [
      {
        id: 'task:done:1',
        outcome: 'addressed',
        explanation: 'Adds the button.',
      },
      {
        id: 'task:done:2',
        outcome: 'not_addressed',
        explanation: 'Amounts are printed raw.',
      },
    ]
  )
}

describe('on GitHub — summary and review comment', () => {
  it('the summary lists every requirement with its outcome and explanation (private repo)', () => {
    const block = formatRequirementsBlock(assessed(true))!
    expect(block).toMatch(/Linked requirements/)
    expect(block).toMatch(
      /✅ Addressed — \*\*LUM-12 · Requirement 1 of 2\*\*: A CSV download button — _Adds the button._/
    )
    expect(block).toMatch(
      /❌ Not addressed — \*\*LUM-12 · Requirement 2 of 2\*\*/
    )
    expect(block).not.toContain(WITHHELD_NOTE)
    // All addressed ⇒ folded.
    const all = assessed(true).map(a => ({
      ...a,
      outcome: 'addressed' as const,
    }))
    expect(formatRequirementsBlock(all)).toMatch(
      /<details>\n<summary>Linked requirements \(2\)/
    )
    expect(formatRequirementsBlock([])).toBeNull()
  })

  it('public-repo privacy default: only the item and its outcome — no task text, no explanation', () => {
    const a = assessed(false)
    expect(a.every(r => r.text === null)).toBe(true)
    const block = formatRequirementsBlock(a)!
    expect(block).not.toMatch(/CSV download|two decimals|Adds the button|raw/)
    expect(block).toMatch(
      /❌ Not addressed — \*\*LUM-12 · Requirement 2 of 2\*\* \(details in Lumo\)/
    )
    expect(block).toContain(WITHHELD_NOTE)
    const review = buildUnmetRequirementsReview({
      assessments: a,
      headSha: 'abcdef1234',
      mode: 'warning',
    })!
    expect(review).not.toMatch(/two decimals|raw/)
    expect(review).toContain(WITHHELD_NOTE)
  })

  it('the review comment flags only the unmet requirements, once per distinct set', () => {
    const a = assessed(true)
    const review = buildUnmetRequirementsReview({
      assessments: a,
      headSha: 'abcdef1234',
      mode: 'error',
    })!
    expect(review).toMatch(/1 linked requirement not addressed\*\* · `abcdef1`/)
    expect(review).toMatch(
      /LUM-12 · Requirement 2 of 2\*\*: Amounts have two decimals/
    )
    expect(review).not.toMatch(/Requirement 1 of 2/)
    expect(review).toMatch(/`error`/)
    const key = unmetKey(a)!
    expect(review).toContain(unmetMarker(key))
    expect(hasUnmetMarker([null, review], key)).toBe(true)
    // Another unmet set ⇒ another key.
    const both = a.map(x => ({ ...x, outcome: 'not_addressed' as const }))
    expect(unmetKey(both)).not.toBe(key)
    expect(hasUnmetMarker([review], unmetKey(both)!)).toBe(false)
  })

  it('nothing unmet ⇒ no review comment', () => {
    const ok = assessed(true).map(a => ({
      ...a,
      outcome: 'addressed' as const,
    }))
    expect(unmetKey(ok)).toBeNull()
    expect(
      buildUnmetRequirementsReview({
        assessments: ok,
        headSha: 'h',
        mode: 'warning',
      })
    ).toBeNull()
  })

  it('model and task text is neutralised (no mentions, links or markup)', () => {
    const [a] = assessRequirements(
      [{ ...REQS[0]!, text: '@admin see [x](https://evil.test) <b>' }],
      [
        {
          id: 'task:done:1',
          outcome: 'addressed',
          explanation: 'ping @everyone',
        },
      ]
    )
    const line = requirementLine(a!)
    expect(line).not.toMatch(/@|https:|<b>/)
  })

  it('the summary carries the block under the checks table', () => {
    const planned = plannedIssueCheck('warning') as PlannedPreMergeCheck[]
    const results: PreMergeCheckResult[] = resultsFromAnswers(
      planned,
      [
        {
          id: ISSUE_ASSESSMENT_CHECK_ID,
          verdict: 'failed',
          requirements: [
            { id: 'task:done:1', outcome: 'addressed', explanation: 'ok' },
            { id: 'task:done:2', outcome: 'not_addressed', explanation: 'no' },
          ],
        },
      ],
      new Map([[ISSUE_ASSESSMENT_CHECK_ID, REQS]])
    )
    const text = formatPreMergeChecks(
      { headSha: 'h', ranAt: '', results },
      null,
      { handle: '@uselumo', requestChanges: false }
    )!
    expect(text).toMatch(/\| Issue assessment \| ⚠️ Warning \|/)
    expect(text).toMatch(/\*\*Linked requirements:\*\*/)
  })
})

describe('LUM-1297 recorded Decisions and follow-up scope', () => {
  it('caps context so oversized decisions and PR titles leave room for requirements', () => {
    const requirements = extractTaskRequirements({
      identifier: 'LUM-702',
      title: 'Dot',
      markdown: '## Goal\nUse size-2.5.',
      quotable: false,
    })
    const material = requirementsMaterial(requirements, {
      decisions: Array.from({ length: 30 }, () => 'x'.repeat(900)),
      mergedPrCount: 30,
      mergedPrs: Array.from({ length: 30 }, (_, number) => ({
        repo: 'acme/app',
        number,
        title: 'y'.repeat(900),
      })),
    })
    expect(material.length).toBeLessThan(4000)
    expect(material).toContain('[task:goal] (LUM-702 · Goal) Use size-2.5.')
    expect(material).toContain('30 other merged PRs')
  })

  it('keeps every requirement inside the runner cap when context is maxed out', () => {
    const requirements = extractTaskRequirements({
      identifier: 'LUM-702',
      title: 'Dot',
      markdown:
        '## Done when\n' +
        Array.from(
          { length: 12 },
          (_, i) => `- req${i} ${'r'.repeat(560)}`
        ).join('\n'),
      quotable: false,
    })
    expect(requirements).toHaveLength(TASK_REQUIREMENTS_MAX)
    const material = requirementsMaterial(requirements, {
      decisions: Array.from({ length: 30 }, () => 'x'.repeat(900)),
      mergedPrCount: 30,
      mergedPrs: Array.from({ length: 30 }, (_, number) => ({
        repo: 'acme/app',
        number,
        title: 'y'.repeat(900),
      })),
    }).slice(0, 8000)
    for (const r of requirements) expect(material).toContain(`[${r.id}]`)
    expect(material).toContain('req11 ')
  })

  it('newest decisions survive the caps', () => {
    const markdown =
      '## Decisions\n' +
      Array.from({ length: 20 }, (_, i) => `- d${i} ${'z'.repeat(300)}`).join(
        '\n'
      )
    const decisions = extractTaskDecisions(markdown)
    expect(decisions).toHaveLength(TASK_REQUIREMENTS_MAX)
    expect(decisions[0]).toMatch(/^d8 /)
    expect(decisions[decisions.length - 1]).toMatch(/^d19 /)
    const material = requirementsMaterial(
      extractTaskRequirements({
        identifier: 'LUM-702',
        title: 'Dot',
        markdown: '## Goal\nGoal.',
        quotable: false,
      }),
      { decisions, mergedPrCount: 0, mergedPrs: [] }
    )
    expect(material).toContain('- d19 ')
    expect(material.indexOf('- d19 ')).toBeLessThan(material.indexOf('- d18 '))
    expect(material).not.toContain('- d8 ')
  })

  it('extracts decisions as bounded context, without creating requirement ids', () => {
    const markdown =
      '## Goal\nUse size-2.5.\n## Decisions\n- Use size-3 instead.\n  User approved.\n- ' +
      'x'.repeat(900) +
      '\n## Notes\nNot a decision.'
    expect(extractTaskDecisions(markdown)).toEqual([
      'Use size-3 instead. User approved.',
      'x'.repeat(REQUIREMENT_TEXT_MAX - 1) + '…',
    ])
    expect(
      extractTaskRequirements({
        identifier: 'LUM-702',
        title: 'Dot',
        markdown,
        quotable: false,
      }).map(r => r.id)
    ).toEqual(['task:goal'])
    expect(
      extractTaskRequirements({
        identifier: 'LUM-702',
        title: 'Dot',
        markdown: 'Description.\n## Decisions\n- Use size-3.',
        quotable: false,
      })[0]!.text
    ).toBe('Dot: Description.')
    expect(
      extractTaskRequirements({
        identifier: 'LUM-702',
        title: 'Dot',
        markdown: '## Decisions\n- Use size-3.',
        quotable: false,
      })
    ).toEqual([])
    expect(extractTaskDecisions(null)).toEqual([])
    expect(extractTaskDecisions('## Decisions\nUse size-3.')).toEqual([
      'Use size-3.',
    ])
    expect(
      extractTaskDecisions(
        '## Decisions\n' +
          Array.from({ length: 30 }, () => '- decision').join('\n')
      )
    ).toHaveLength(TASK_REQUIREMENTS_MAX)
    expect(extractTaskDecisions('<!-- ## Decisions\n- hidden -->')).toEqual([])
  })

  it('includes decisions and merged PR provenance without adding answer ids', () => {
    const requirements = extractTaskRequirements({
      identifier: 'LUM-702',
      title: 'Dot',
      markdown: '## Goal\nUse size-2.5.',
      quotable: false,
    })
    const material = requirementsMaterial(requirements, {
      decisions: ['Use size-3 instead.'],
      mergedPrCount: 2,
      mergedPrs: [
        { repo: 'acme/app', number: 864, title: 'Priority menu' },
        { repo: 'acme/app', number: 865, title: 'Priority dots' },
      ],
    })
    expect(material).toContain(
      'Answer each of these 1 requirement ids exactly once: task:goal.'
    )
    expect(material).toContain('overriding context')
    expect(material).toContain('Use size-3 instead.')
    expect(material).toContain('2 other merged PRs')
    expect(material).toContain('acme/app#864: Priority menu')
    expect(material).toContain('acme/app#865: Priority dots')
    expect(material).toContain('unclear, not not_addressed')
  })
})
