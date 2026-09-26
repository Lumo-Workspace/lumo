import { projectCiChecks, type GateSignalRow } from '@/lib/services/gate-audit'

function row(
  checkName: string,
  outcome: string,
  createdAt: string,
  headSha: string | null
): GateSignalRow {
  return {
    checkName,
    outcome,
    detailsUrl: null,
    source: 'github_check',
    createdAt: new Date(createdAt),
    headSha,
  }
}

describe('projectCiChecks', () => {
  it('maps outcomes to passed, failed and did not run', () => {
    const { ci } = projectCiChecks(
      [
        row('a', 'success', '2026-06-28T10:00:00.000Z', 'h1'),
        row('b', 'failure', '2026-06-28T10:00:00.000Z', 'h1'),
        row('c', 'not_run', '2026-06-28T10:00:00.000Z', 'h1'),
      ],
      'h1'
    )
    expect(ci.map(c => [c.name, c.status])).toEqual([
      ['a', 'passed'],
      ['b', 'failed'],
      ['c', 'did_not_run'],
    ])
  })

  it('falls back to the commit of the latest CI result when the head is unknown', () => {
    const out = projectCiChecks([
      row('build', 'failure', '2026-06-28T09:00:00.000Z', 'old'),
      row('build', 'success', '2026-06-28T10:00:00.000Z', 'new'),
      row('lint', 'success', '2026-06-28T09:30:00.000Z', 'old'),
    ])
    expect(out.headSha).toBe('new')
    expect(out.ci.map(c => [c.name, c.status])).toEqual([['build', 'passed']])
  })

  it('reports no commit and no checks when there are no rows', () => {
    expect(projectCiChecks([])).toEqual({ headSha: null, ci: [] })
    expect(projectCiChecks([], 'h1')).toEqual({ headSha: 'h1', ci: [] })
  })

  it('drops a CI details link that is not http or https', () => {
    const rows = [
      'https://ci.example/run/1',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'not a url',
    ].map((detailsUrl, i) => ({
      ...row(`check${i}`, 'success', '2026-06-28T10:00:00.000Z', 'h1'),
      detailsUrl,
    }))
    const { ci } = projectCiChecks(rows, 'h1')
    expect(ci.map(c => c.detailsUrl)).toEqual([
      'https://ci.example/run/1',
      null,
      null,
      null,
    ])
  })
})
