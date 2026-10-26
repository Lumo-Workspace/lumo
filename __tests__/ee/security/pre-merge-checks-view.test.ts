/** @jest-environment node */
import { preMergeChecksView } from '@/ee/security/security-scan/pre-merge-checks-view'
import { nonPassingChecks } from '@/shared/src/pre-merge-checks'

const check = {
  id: 'issue-assessment',
  name: 'Issue assessment',
  kind: 'builtin',
  mode: 'warning',
  verdict: 'failed',
  explanation: 'One unmet requirement',
  resolution: 'Implement the goal',
  requirements: [
    {
      id: 'goal',
      source: 'lumo_task',
      label: 'LUM-702 · Goal',
      text: 'Private goal',
      quotable: false,
      outcome: 'not_addressed',
      explanation: 'Private explanation',
    },
  ],
}

test('missing, malformed, or stale checks give nothing', () => {
  for (const raw of [
    undefined,
    null,
    'bad',
    {},
    { headSha: 'head', results: [null, {}] },
    { headSha: 'old', results: [check] },
  ]) {
    expect(preMergeChecksView(raw, 'head')).toEqual([])
  }
})

test('only failed and inconclusive checks need attention', () => {
  const checks = preMergeChecksView(
    {
      headSha: 'head',
      results: ['passed', 'failed', 'inconclusive', 'not_applicable'].map(
        verdict => ({ ...check, verdict })
      ),
    },
    'head'
  )
  expect(nonPassingChecks(checks).map(c => c.verdict)).toEqual([
    'failed',
    'inconclusive',
  ])
  expect(nonPassingChecks(undefined)).toEqual([])
})

test('withholds non-quotable requirement prose at the API boundary', () => {
  const [result] = preMergeChecksView(
    { headSha: 'head', results: [check] },
    'head'
  )
  expect(JSON.stringify(result)).not.toContain('Private')
})

test('keeps quotable requirement prose', () => {
  const [result] = preMergeChecksView(
    {
      headSha: 'head',
      results: [
        {
          ...check,
          requirements: [{ ...check.requirements[0], quotable: true }],
        },
      ],
    },
    'head'
  )
  expect(result?.requirements?.[0]).toMatchObject({
    text: 'Private goal',
    explanation: 'Private explanation',
  })
})
