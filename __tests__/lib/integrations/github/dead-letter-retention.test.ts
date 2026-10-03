import {
  buildPurgedDeadLetterPayload,
  deadLetterPurgeCutoff,
} from '@/lib/integrations/github/dead-letter-retention'

describe('buildPurgedDeadLetterPayload', () => {
  it('keeps only allow-listed scalar metadata and drops raw', () => {
    const out = buildPurgedDeadLetterPayload({
      event: 'issue_comment',
      action: 'edited',
      pullRequestId: 'pr_1',
      raw: {
        comment: { body: 'secret code', diff_hunk: '@@ -1 +1 @@' },
        issue: { number: 7, body: 'issue text' },
        repository: { full_name: 'acme/app' },
      },
      extra: 'unknown key with code',
      taskId: { nested: 'object' },
    })
    expect(out).toEqual({
      rawPurged: true,
      event: 'issue_comment',
      action: 'edited',
      pullRequestId: 'pr_1',
      repo: 'acme/app',
      prNumber: 7,
    })
  })

  it('keeps an outbound job payload as op and mirror id', () => {
    expect(
      buildPurgedDeadLetterPayload({ op: 'CREATE', mirrorId: 'm1' })
    ).toEqual({ rawPurged: true, op: 'CREATE', mirrorId: 'm1' })
  })

  it('handles a non-object payload', () => {
    expect(buildPurgedDeadLetterPayload(null)).toEqual({ rawPurged: true })
    expect(buildPurgedDeadLetterPayload('x')).toEqual({ rawPurged: true })
  })
})

describe('deadLetterPurgeCutoff', () => {
  it('is 7 days before now', () => {
    expect(deadLetterPurgeCutoff(new Date('2026-10-10T00:00:00Z'))).toEqual(
      new Date('2026-10-03T00:00:00Z')
    )
  })
})
