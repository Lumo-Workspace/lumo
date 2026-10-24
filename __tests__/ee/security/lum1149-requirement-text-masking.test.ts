/**
 * @jest-environment node
 *
 * LUM-1149 follow-up — what production showed on a probe PR:
 * 1. a requirement's backticked path (`src/probe/clamp.ts`) reached the PR
 *    as `src/…(len 18)`: requirement text, the model's explanations and the
 *    other check explanations now take the PR-summary prose pass (LUM-1200),
 *    and paired backticks stay code spans — real secrets are still masked;
 * 2. the task's Goal was reported "did not get an answer": the model left it
 *    out. The material now names every id to answer, an id written as
 *    `[task:goal]` still matches, and what is still missing is found for a
 *    second ask (see the service test) and then reported as such.
 */
import {
  NO_OUTCOME_EXPLANATION,
  assessRequirements,
  buildUnmetRequirementsReview,
  extractTaskRequirements,
  formatRequirementsBlock,
  parseRequirementAssessments,
  requirementLine,
  requirementsMaterial,
  unansweredRequirements,
} from '@/ee/security/security-scan/issue-assessment'
import {
  cleanCheckText,
  resultsFromAnswers,
  unansweredRequirementsByCheck,
  withRequirementAnswers,
  type PlannedPreMergeCheck,
} from '@/ee/security/security-scan/pre-merge-checks'

// The production probe's task (LUM-1201), as stored markdown.
const PROBE_MD = [
  '## Goal',
  '',
  'Throwaway production probe for LUM-1149 TC5 (issue assessment). Will be trashed.',
  '',
  '## Done when',
  '',
  '-    `src/probe/clamp.ts` exports `clamp(value, min, max)` that returns `value` limited to the range \\[min, max\\]',
  '-    `src/probe/clamp.ts` exports `percent(part, total)` that returns `part / total * 100`, and returns 0 when `total` is 0',
].join('\n')

const REQS = extractTaskRequirements({
  identifier: 'LUM-1201',
  title: '[probe] issue assessment scratch',
  markdown: PROBE_MD,
  quotable: true,
})

// Built at runtime: the token shape the registry masks (ghp_ + 36).
const TOKEN = 'ghp' + '_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
const PASSPHRASE = ['correct', 'horse', 'battery', 'staple'].join(' ')

describe('backticked paths in requirements stay readable', () => {
  const assessed = assessRequirements(REQS, [
    { id: 'task:goal', outcome: 'unclear', explanation: 'A probe.' },
    {
      id: 'task:done:1',
      outcome: 'addressed',
      explanation: 'Adds `clamp` in `src/probe/clamp.ts`.',
    },
    {
      id: 'task:done:2',
      outcome: 'not_addressed',
      explanation: 'No `percent(part, total)` export.',
    },
  ])

  it('the requirement text and the explanation keep the path and the signature', () => {
    expect(assessed[1]!.text).toContain(
      '`src/probe/clamp.ts` exports `clamp(value, min, max)`'
    )
    expect(assessed[2]!.explanation).toBe('No `percent(part, total)` export.')
    expect(JSON.stringify(assessed)).not.toMatch(/…\(len \d+\)/)
  })

  it('the summary block and the review comment render them as code spans', () => {
    const block = formatRequirementsBlock(assessed)!
    expect(block).toContain(
      '**LUM-1201 · Requirement 1 of 2**: `src/probe/clamp.ts` exports `clamp(value, min, max)` that returns `value` limited'
    )
    const review = buildUnmetRequirementsReview({
      assessments: assessed,
      headSha: '7116c7ab205c387a5898db0da69ae01043b0f44b',
      mode: 'warning',
    })!
    expect(review).toContain(
      '`src/probe/clamp.ts` exports `percent(part, total)` that returns `part / total * 100`'
    )
    expect(review).toContain('_No `percent(part, total)` export._')
    expect(review).not.toMatch(/…\(len \d+\)/)
  })

  it('a stored assessment read back is not masked on the way out either', () => {
    const back = parseRequirementAssessments(
      JSON.parse(JSON.stringify(assessed))
    )!
    expect(back[1]!.text).toContain('`src/probe/clamp.ts`')
  })

  it('an odd backtick (a span cut by the cap) cannot open a span over the line', () => {
    const line = requirementLine({
      ...assessed[1]!,
      text: 'uses `src/probe/clamp.ts and more',
      explanation: 'Adds `clamp.',
    })
    expect(line).not.toContain('`')
  })
})

describe('real secrets are still masked', () => {
  it('a registry token in a requirement or an explanation', () => {
    const [a] = assessRequirements(
      [{ ...REQS[1]!, text: `Rotate \`${TOKEN}\` in the config` }],
      [
        {
          id: 'task:done:1',
          outcome: 'not_addressed',
          explanation: `The diff still holds ${TOKEN}.`,
        },
      ]
    )
    expect(a!.text).not.toContain(TOKEN.slice(4, 14))
    expect(a!.explanation).not.toContain(TOKEN.slice(4, 14))
    expect(a!.text).toMatch(/…\(len \d+\)/)
  })

  it('a quoted value right after a credential key', () => {
    const [a] = assessRequirements(
      [{ ...REQS[1]!, text: `The admin password is "${PASSPHRASE}" for now` }],
      []
    )
    expect(a!.text).not.toContain(PASSPHRASE)
  })

  it('pre-merge check explanations: a token is masked, a quoted path kept', () => {
    expect(cleanCheckText(`Title mentions ${TOKEN}.`)).not.toContain(
      TOKEN.slice(4, 14)
    )
    expect(
      cleanCheckText('The description names `src/probe/clamp.ts` correctly.')
    ).toBe('The description names `src/probe/clamp.ts` correctly.')
  })
})

describe('every requirement gets an answer', () => {
  it('the material names every id the model must answer, the Goal included', () => {
    const m = requirementsMaterial(REQS)
    expect(m.split('\n')[0]).toBe(
      "Answer each of these 3 requirement ids exactly once: task:goal, task:done:1, task:done:2. A broad requirement (such as a task's Goal) that neither the diff nor the evidence below can show is still answered — as unclear."
    )
    expect(m).toContain('- [task:goal] (LUM-1201 · Goal) Throwaway')
  })

  it('an id written with its brackets or another case still matches', () => {
    const a = assessRequirements(REQS, [
      { id: '[task:goal]', outcome: 'unclear', explanation: 'A probe.' },
      { id: ' TASK:DONE:1 ', outcome: 'addressed', explanation: 'Yes.' },
      { id: 'task:done:2', outcome: 'not_addressed', explanation: 'No.' },
    ])
    expect(a.map(r => r.explanation)).toEqual(['A probe.', 'Yes.', 'No.'])
    expect(
      unansweredRequirements(REQS, [{ id: '[task:goal]', outcome: 'unclear' }])
    ).toEqual([REQS[1], REQS[2]])
  })

  it('production shape: the Goal left out is found for a second ask, then merged in', () => {
    const planned: PlannedPreMergeCheck[] = [
      {
        id: 'issue_assessment',
        name: 'Issue assessment',
        kind: 'builtin',
        mode: 'warning',
        rule: 'r',
        assessesRequirements: true,
      },
      {
        id: 'title',
        name: 'Title',
        kind: 'builtin',
        mode: 'warning',
        rule: 'r',
      },
    ]
    const linked = new Map([['issue_assessment', REQS]])
    const first = [
      {
        id: 'issue_assessment',
        verdict: 'failed',
        explanation: '',
        resolution: '',
        requirements: [
          { id: 'task:done:1', outcome: 'addressed', explanation: 'Yes.' },
          { id: 'task:done:2', outcome: 'not_addressed', explanation: 'No.' },
        ],
      },
      { id: 'title', verdict: 'passed', explanation: 'ok', resolution: '' },
    ]
    const missing = unansweredRequirementsByCheck(planned, first, linked)
    expect([...missing.keys()]).toEqual(['issue_assessment'])
    expect(missing.get('issue_assessment')!.map(r => r.id)).toEqual([
      'task:goal',
    ])
    const merged = withRequirementAnswers(first, [
      {
        id: 'issue_assessment',
        verdict: 'inconclusive',
        requirements: [
          { id: 'task:goal', outcome: 'unclear', explanation: 'A probe.' },
        ],
      },
    ])
    const [ia, title] = resultsFromAnswers(planned, merged, linked)
    expect(
      ia!.requirements!.map(r => [r.id, r.outcome, r.explanation])
    ).toEqual([
      ['task:goal', 'unclear', 'A probe.'],
      ['task:done:1', 'addressed', 'Yes.'],
      ['task:done:2', 'not_addressed', 'No.'],
    ])
    expect(title).toMatchObject({ verdict: 'passed', explanation: 'ok' })
  })

  it('a second ask that re-answers an already-judged requirement never overrides it', () => {
    const a = assessRequirements(REQS, [
      { id: 'task:done:1', outcome: 'addressed', explanation: 'Yes.' },
      { id: 'task:done:2', outcome: 'banana', explanation: '?' },
      // Appended from the second ask:
      { id: 'task:goal', outcome: 'unclear', explanation: 'A probe.' },
      { id: 'task:done:1', outcome: 'not_addressed', explanation: 'Flip.' },
      { id: 'task:done:2', outcome: 'not_addressed', explanation: 'No.' },
    ])
    expect(a.map(r => [r.id, r.outcome, r.explanation])).toEqual([
      ['task:goal', 'unclear', 'A probe.'],
      ['task:done:1', 'addressed', 'Yes.'],
      ['task:done:2', 'not_addressed', 'No.'],
    ])
  })

  it('still missing after the second ask: reported as no outcome from the model', () => {
    const [goal] = assessRequirements(REQS, [])
    expect(goal!.explanation).toBe(NO_OUTCOME_EXPLANATION)
    expect(NO_OUTCOME_EXPLANATION).not.toMatch(/did not get an answer/)
  })
})
