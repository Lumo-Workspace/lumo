import {
  buildPurgedDeadLetterPayload,
  deadLetterPurgeCutoff,
  inferWebhookEvent,
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

  // The only INBOUND shape written in production (pr-comment-mirror's
  // parent-mirror-missing retry): no top-level event / action.
  it('recovers event and action from raw for the real inbound payload shape', () => {
    const out = buildPurgedDeadLetterPayload({
      reason: 'parent-mirror-missing',
      commentId: 'c_1',
      pullRequestId: 'pr_1',
      raw: {
        action: 'created',
        comment: { id: 9, body: 'secret code', diff_hunk: '@@ -1 +1 @@' },
        pull_request: { number: 42 },
        repository: { full_name: 'acme/app' },
      },
    })
    expect(out).toEqual({
      rawPurged: true,
      reason: 'parent-mirror-missing',
      commentId: 'c_1',
      pullRequestId: 'pr_1',
      event: 'pull_request_review_comment',
      action: 'created',
      repo: 'acme/app',
      prNumber: 42,
    })
  })

  it('prefers top-level event and action over the raw-derived ones', () => {
    const out = buildPurgedDeadLetterPayload({
      event: 'issue_comment',
      action: 'edited',
      raw: {
        action: 'created',
        review: { id: 1 },
        pull_request: { number: 3 },
      },
    })
    expect(out.event).toBe('issue_comment')
    expect(out.action).toBe('edited')
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

describe('inferWebhookEvent', () => {
  it('maps a review body to pull_request_review', () => {
    expect(
      inferWebhookEvent({ review: { id: 1 }, pull_request: { number: 1 } })
    ).toBe('pull_request_review')
  })

  it('maps a comment on an issue to issue_comment', () => {
    expect(
      inferWebhookEvent({ comment: { id: 1 }, issue: { number: 1 } })
    ).toBe('issue_comment')
  })

  it('maps a comment on a pull request to pull_request_review_comment', () => {
    expect(
      inferWebhookEvent({ comment: { id: 1 }, pull_request: { number: 1 } })
    ).toBe('pull_request_review_comment')
  })

  it('returns undefined for an unrecognised body', () => {
    expect(inferWebhookEvent({ pull_request: { number: 1 } })).toBeUndefined()
    expect(inferWebhookEvent({})).toBeUndefined()
  })
})

describe('deadLetterPurgeCutoff', () => {
  it('is 7 days before now', () => {
    expect(deadLetterPurgeCutoff(new Date('2026-10-10T00:00:00Z'))).toEqual(
      new Date('2026-10-03T00:00:00Z')
    )
  })
})
