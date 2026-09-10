/**
 * @jest-environment node
 *
 * LUM-735 Task 2 — the three endpoints the security write-back needs:
 * `createReview` (one review carrying every inline comment) and the two
 * paginated list calls that make the marker dedupe possible.
 */
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'

const repo = { owner: 'o', name: 'r' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** `n` listed comments whose ids start at `from`. */
function page(n: number, from: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: from + i,
    node_id: `IC_${from + i}`,
    html_url: `https://github.com/o/r/pull/7#c${from + i}`,
    body: `body ${from + i}`,
    updated_at: '2026-09-10T00:00:00Z',
    user: { id: 1 },
  }))
}

describe('prCommentClient review endpoints', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch')
  })
  afterEach(() => fetchSpy.mockRestore())

  it('createReview POSTs /pulls/{n}/reviews with commit_id, event COMMENT and the comments', async () => {
    fetchSpy.mockResolvedValue(
      json({
        id: 42,
        html_url: 'https://github.com/o/r/pull/7#pullrequestreview-42',
      })
    )
    const res = await prCommentClient.createReview({
      repo,
      prNumber: 7,
      token: 'tok',
      commitId: 'a'.repeat(40),
      body: 'summary',
      comments: [
        { path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'one' },
        { path: 'src/b.ts', line: 3, side: 'RIGHT', body: 'two' },
      ],
    })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/o/r/pulls/7/reviews')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer tok' })
    )
    expect(JSON.parse(init.body)).toEqual({
      commit_id: 'a'.repeat(40),
      body: 'summary',
      event: 'COMMENT',
      comments: [
        { path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'one' },
        { path: 'src/b.ts', line: 3, side: 'RIGHT', body: 'two' },
      ],
    })
    expect(res.id).toBe(42)
  })

  it('listIssueComments walks pages until a short one and concatenates them', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(page(100, 1)))
      .mockResolvedValueOnce(json(page(3, 101)))
    const rows = await prCommentClient.listIssueComments({
      repo,
      prNumber: 7,
      token: 'tok',
    })
    expect(rows).toHaveLength(103)
    expect(fetchSpy.mock.calls.map(c => c[0])).toEqual([
      'https://api.github.com/repos/o/r/issues/7/comments?per_page=100&page=1',
      'https://api.github.com/repos/o/r/issues/7/comments?per_page=100&page=2',
    ])
  })

  it('listIssueComments stops after one request when the first page is short', async () => {
    fetchSpy.mockResolvedValueOnce(json(page(2, 1)))
    const rows = await prCommentClient.listIssueComments({
      repo,
      prNumber: 7,
      token: 'tok',
    })
    expect(rows).toHaveLength(2)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('listReviewComments paginates /pulls/{n}/comments the same way', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(page(100, 1)))
      .mockResolvedValueOnce(json(page(1, 101)))
    const rows = await prCommentClient.listReviewComments({
      repo,
      prNumber: 7,
      token: 'tok',
    })
    expect(rows).toHaveLength(101)
    expect(fetchSpy.mock.calls.map(c => c[0])).toEqual([
      'https://api.github.com/repos/o/r/pulls/7/comments?per_page=100&page=1',
      'https://api.github.com/repos/o/r/pulls/7/comments?per_page=100&page=2',
    ])
  })

  it('a 404 from a list call throws GithubApiError with the status', async () => {
    fetchSpy.mockResolvedValueOnce(json({ message: 'Not Found' }, 404))
    await expect(
      prCommentClient.listReviewComments({ repo, prNumber: 7, token: 'tok' })
    ).rejects.toMatchObject({ status: 404 })
  })
})
