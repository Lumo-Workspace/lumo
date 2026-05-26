/**
 * @jest-environment node
 */
// __tests__/integrations/github/pr-comment-client.test.ts
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'

describe('prCommentClient', () => {
  const baseRepo = { owner: 'foo', name: 'bar' }
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 999,
          node_id: 'IC_x',
          html_url: 'https://github.com/foo/bar/pull/1#issuecomment-999',
          updated_at: '2026-05-24T00:00:00Z',
          body: 'echo',
        }),
        { status: 201 }
      )
    )
  })
  afterEach(() => fetchSpy.mockRestore())

  it('createIssueComment POSTs to /issues/{n}/comments with bearer auth', async () => {
    const r = await prCommentClient.createIssueComment({
      repo: baseRepo,
      prNumber: 1,
      body: 'hello',
      token: 'tok123',
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.github.com/repos/foo/bar/issues/1/comments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok123',
          Accept: 'application/vnd.github+json',
        }),
        body: JSON.stringify({ body: 'hello' }),
      })
    )
    expect(r.id).toBe(999)
    expect(r.updated_at).toBe('2026-05-24T00:00:00Z')
  })

  it('createReviewLineReply POSTs to /pulls/{n}/comments with in_reply_to', async () => {
    await prCommentClient.createReviewLineReply({
      repo: baseRepo,
      prNumber: 1,
      inReplyTo: 555,
      body: 'reply',
      token: 'tok',
    })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/foo/bar/pulls/1/comments')
    expect(JSON.parse(init.body)).toEqual({ body: 'reply', in_reply_to: 555 })
  })

  it('updateIssueComment PATCHes /issues/comments/{id}', async () => {
    await prCommentClient.updateIssueComment({
      repo: baseRepo,
      externalId: '999',
      body: 'edit',
      token: 'tok',
    })
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/foo/bar/issues/comments/999'
    )
    expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH')
  })

  it('updateReviewLineComment PATCHes /pulls/comments/{id}', async () => {
    await prCommentClient.updateReviewLineComment({
      repo: baseRepo,
      externalId: '999',
      body: 'edit',
      token: 'tok',
    })
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/foo/bar/pulls/comments/999'
    )
  })

  it('deleteIssueComment returns void on 204', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(
      prCommentClient.deleteIssueComment({
        repo: baseRepo,
        externalId: '999',
        token: 'tok',
      })
    ).resolves.toBeUndefined()
  })

  it('throws GithubApiError on non-2xx with status and body', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
    )
    await expect(
      prCommentClient.createIssueComment({
        repo: baseRepo,
        prNumber: 1,
        body: 'x',
        token: 'tok',
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('detects rate-limit error from 403 + X-RateLimit-Remaining=0', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: 'rate limit' }), {
        status: 403,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
        },
      })
    )
    await expect(
      prCommentClient.createIssueComment({
        repo: baseRepo,
        prNumber: 1,
        body: 'x',
        token: 'tok',
      })
    ).rejects.toMatchObject({ status: 403, rateLimitResetAt: expect.any(Date) })
  })

  it('listIssueCommentsSince GETs with since param for idempotency check', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([{ id: 1, body: 'a', user: { id: 1 } }]), {
        status: 200,
      })
    )
    const since = new Date('2026-05-23T00:00:00Z')
    await prCommentClient.listIssueCommentsSince({
      repo: baseRepo,
      prNumber: 1,
      since,
      token: 'tok',
    })
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/foo/bar/issues/1/comments?since=2026-05-23T00%3A00%3A00.000Z'
    )
  })
})
