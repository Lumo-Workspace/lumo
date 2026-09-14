/**
 * @jest-environment node
 *
 * LUM-735 Task 2 — the three endpoints the security write-back needs:
 * `createReview` (one review carrying every inline comment) and the two
 * paginated list calls that make the marker dedupe possible.
 */
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'

const repo = { owner: 'o', name: 'r' }

function json(
  body: unknown,
  status = 200,
  headers: HeadersInit = {}
): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

/** GitHub's paging header, as it comes back on page 1 of a multi-page listing. */
function linkHeader(base: string, last: number): HeadersInit {
  return {
    Link: [
      `<${base}?per_page=100&page=2>; rel="next"`,
      `<${base}?per_page=100&page=${last}>; rel="last"`,
    ].join(', '),
  }
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

  // `/issues/{n}/comments` ignores sort/direction — it is always oldest-first
  // — so the walk has to run BACKWARDS from the `Link` header's last page,
  // or Lumo's own summary (one of the newest comments) falls outside the
  // window on a busy PR.
  it('listIssueComments walks backwards from the Link header’s last page', async () => {
    const base = 'https://api.github.com/repos/o/r/issues/7/comments'
    fetchSpy
      .mockResolvedValueOnce(json(page(100, 1), 200, linkHeader(base, 3)))
      .mockResolvedValueOnce(json(page(4, 201))) // page 3 (newest)
      .mockResolvedValueOnce(json(page(100, 101))) // page 2
    const rows = await prCommentClient.listIssueComments({
      repo,
      prNumber: 7,
      token: 'tok',
    })
    expect(rows).toHaveLength(204)
    // Newest first: page 3, then 2, then the page-1 rows already in hand.
    expect(rows[0]!.id).toBe(201)
    expect(rows[4]!.id).toBe(101)
    expect(rows[104]!.id).toBe(1)
    expect(fetchSpy.mock.calls.map(c => c[0])).toEqual([
      `${base}?per_page=100&page=1`,
      `${base}?per_page=100&page=3`,
      `${base}?per_page=100&page=2`,
    ])
    // sort/direction are gone: the endpoint ignores them, and asking for
    // them read as a guarantee it does not give.
    for (const [url] of fetchSpy.mock.calls) {
      expect(url).not.toContain('sort=')
      expect(url).not.toContain('direction=')
    }
  })

  it('listIssueComments reads at most MAX_COMMENT_PAGES, the newest ones', async () => {
    const base = 'https://api.github.com/repos/o/r/issues/7/comments'
    fetchSpy.mockResolvedValueOnce(
      json(page(100, 1), 200, linkHeader(base, 25))
    )
    for (let i = 0; i < 10; i += 1) {
      fetchSpy.mockResolvedValueOnce(json(page(100, 1000 + i * 100)))
    }
    await prCommentClient.listIssueComments({ repo, prNumber: 7, token: 'tok' })
    // 1 probe + 10 pages, walked 25 → 16 and stopping there.
    expect(fetchSpy).toHaveBeenCalledTimes(11)
    expect(fetchSpy.mock.calls.slice(1).map(c => c[0])).toEqual(
      [25, 24, 23, 22, 21, 20, 19, 18, 17, 16].map(
        p => `${base}?per_page=100&page=${p}`
      )
    )
  })

  it('listIssueComments stops after one request when there is no next page', async () => {
    fetchSpy.mockResolvedValueOnce(json(page(2, 1)))
    const rows = await prCommentClient.listIssueComments({
      repo,
      prNumber: 7,
      token: 'tok',
    })
    expect(rows).toHaveLength(2)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('listIssueComments walks forward when the Link header has next but no last', async () => {
    const base = 'https://api.github.com/repos/o/r/issues/7/comments'
    fetchSpy
      .mockResolvedValueOnce(
        json(page(100, 1), 200, {
          Link: `<${base}?per_page=100&page=2>; rel="next"`,
        })
      )
      .mockResolvedValueOnce(json(page(100, 101)))
      .mockResolvedValueOnce(json(page(3, 201)))
    const rows = await prCommentClient.listIssueComments({
      repo,
      prNumber: 7,
      token: 'tok',
    })
    // Total unknown → oldest-first forward walk, stopping at the short page.
    expect(rows).toHaveLength(203)
    expect(rows[0]!.id).toBe(1)
    expect(rows[202]!.id).toBe(203)
    expect(fetchSpy.mock.calls.map(c => c[0])).toEqual([
      `${base}?per_page=100&page=1`,
      `${base}?per_page=100&page=2`,
      `${base}?per_page=100&page=3`,
    ])
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
      'https://api.github.com/repos/o/r/pulls/7/comments?per_page=100&page=1&sort=created&direction=desc',
      'https://api.github.com/repos/o/r/pulls/7/comments?per_page=100&page=2&sort=created&direction=desc',
    ])
  })

  it('a 404 from a list call throws GithubApiError with the status', async () => {
    fetchSpy.mockResolvedValueOnce(json({ message: 'Not Found' }, 404))
    await expect(
      prCommentClient.listReviewComments({ repo, prNumber: 7, token: 'tok' })
    ).rejects.toMatchObject({ status: 404 })
  })
})
