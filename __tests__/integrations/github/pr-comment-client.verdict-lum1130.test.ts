/**
 * @jest-environment node
 *
 * LUM-1130 — the GitHub calls of the request-changes / approve workflow:
 * a verdict review, the review listing, a dismissal, the live head read and
 * the inline review's event.
 */
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'

const repo = { owner: 'o', name: 'r' }
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

describe('prCommentClient verdict endpoints', () => {
  let fetchSpy: jest.SpyInstance
  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch')
  })
  afterEach(() => fetchSpy.mockRestore())

  const sent = () => {
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    return {
      url,
      method: init.method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    }
  }

  it('submitReview POSTs a body-only review with the event and commit', async () => {
    fetchSpy.mockResolvedValue(json({ id: 5, html_url: 'h' }))
    await prCommentClient.submitReview({
      repo,
      prNumber: 7,
      token: 't',
      commitId: 'abc',
      body: 'ok',
      event: 'APPROVE',
    })
    expect(sent()).toEqual({
      url: 'https://api.github.com/repos/o/r/pulls/7/reviews',
      method: 'POST',
      body: { commit_id: 'abc', body: 'ok', event: 'APPROVE' },
    })
  })

  it('createReview defaults to COMMENT and passes REQUEST_CHANGES through', async () => {
    fetchSpy.mockResolvedValue(json({ id: 5, html_url: 'h' }))
    const base = {
      repo,
      prNumber: 7,
      token: 't',
      commitId: 'abc',
      body: 'b',
      comments: [],
    }
    await prCommentClient.createReview(base)
    expect(sent().body.event).toBe('COMMENT')
    fetchSpy.mockClear()
    await prCommentClient.createReview({ ...base, event: 'REQUEST_CHANGES' })
    expect(sent().body.event).toBe('REQUEST_CHANGES')
  })

  it('listReviews GETs /pulls/{n}/reviews', async () => {
    fetchSpy.mockResolvedValue(
      json([{ id: 1, state: 'APPROVED', commit_id: 'abc', user: null }])
    )
    const out = await prCommentClient.listReviews({
      repo,
      prNumber: 7,
      token: 't',
    })
    expect(sent().url).toBe(
      'https://api.github.com/repos/o/r/pulls/7/reviews?per_page=100&page=1'
    )
    expect(out).toEqual([
      { id: 1, state: 'APPROVED', commit_id: 'abc', user: null },
    ])
  })

  it('dismissReview PUTs the dismissal', async () => {
    fetchSpy.mockResolvedValue(json({ id: 3 }))
    await prCommentClient.dismissReview({
      repo,
      prNumber: 7,
      reviewId: 3,
      message: 'm',
      token: 't',
    })
    expect(sent()).toEqual({
      url: 'https://api.github.com/repos/o/r/pulls/7/reviews/3/dismissals',
      method: 'PUT',
      body: { message: 'm', event: 'DISMISS' },
    })
  })

  it('getPullRequestHead reads head sha and state; null when absent', async () => {
    fetchSpy.mockResolvedValue(json({ state: 'open', head: { sha: 'abc' } }))
    await expect(
      prCommentClient.getPullRequestHead({ repo, prNumber: 7, token: 't' })
    ).resolves.toEqual({ sha: 'abc', state: 'open' })
    fetchSpy.mockResolvedValue(json({ state: 'open' }))
    await expect(
      prCommentClient.getPullRequestHead({ repo, prNumber: 7, token: 't' })
    ).resolves.toBeNull()
  })
})
