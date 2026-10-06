/**
 * @jest-environment node
 *
 * LUM-1003 — the backfill's GitHub reads: one page of a PR's comments reduced
 * to id + author_association, and rate-limit detection (primary + secondary).
 */
import {
  GithubApiError,
  prCommentClient,
  rateLimitResetOf,
} from '@/lib/integrations/github/pr-comment-client'

function res(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body), { status, headers })
}

describe('prCommentClient.listAuthorAssociationsPage', () => {
  let fetchSpy: jest.SpyInstance
  afterEach(() => fetchSpy.mockRestore())

  it.each([
    ['ISSUE', 'issues/5/comments'],
    ['REVIEW_LINE', 'pulls/5/comments'],
    ['REVIEW', 'pulls/5/reviews'],
  ] as const)(
    '%s reads %s with paging and reports hasNext / quota',
    async (kind, path) => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        res(
          [
            { id: 1, author_association: 'MEMBER', body: 'x' },
            { id: 2, user: null },
          ],
          200,
          {
            Link: '<https://api.github.com/x?page=3>; rel="next", <https://api.github.com/x?page=9>; rel="last"',
            'X-RateLimit-Remaining': '4321',
          }
        )
      )
      const page = await prCommentClient.listAuthorAssociationsPage({
        repo: { owner: 'acme', name: 'app' },
        prNumber: 5,
        kind,
        page: 2,
        token: 'tok',
      })
      expect(fetchSpy.mock.calls[0]![0]).toBe(
        `https://api.github.com/repos/acme/app/${path}?per_page=100&page=2`
      )
      expect(page).toEqual({
        items: [
          { id: 1, authorAssociation: 'MEMBER' },
          { id: 2, authorAssociation: null },
        ],
        hasNext: true,
        rateLimitRemaining: 4321,
      })
    }
  )

  it('reports the last page (no rel="next")', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(res([], 200, {}))
    const page = await prCommentClient.listAuthorAssociationsPage({
      repo: { owner: 'acme', name: 'app' },
      prNumber: 5,
      kind: 'ISSUE',
      page: 1,
      token: 'tok',
    })
    expect(page).toEqual({
      items: [],
      hasNext: false,
      rateLimitRemaining: null,
    })
  })

  it('throws a GithubApiError carrying the reset time on a secondary rate limit', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      res({ message: 'You have exceeded a secondary rate limit' }, 403, {
        'Retry-After': '60',
      })
    )
    const err = await prCommentClient
      .listAuthorAssociationsPage({
        repo: { owner: 'acme', name: 'app' },
        prNumber: 5,
        kind: 'ISSUE',
        page: 1,
        token: 'tok',
      })
      .catch(e => e)
    expect(err).toBeInstanceOf(GithubApiError)
    expect(err.status).toBe(403)
    expect(err.rateLimitResetAt).toBeInstanceOf(Date)
  })
})

describe('rateLimitResetOf', () => {
  const now = new Date('2026-10-06T00:00:00Z')
  const h = (o: Record<string, string>) => new Headers(o)

  it('primary limit: X-RateLimit-Reset', () => {
    expect(
      rateLimitResetOf(
        403,
        h({ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1790000000' }),
        now
      )
    ).toEqual(new Date(1790000000 * 1000))
  })

  it('secondary limit: Retry-After seconds', () => {
    expect(rateLimitResetOf(403, h({ 'Retry-After': '30' }), now)).toEqual(
      new Date(now.getTime() + 30_000)
    )
  })

  it('a bare 429 waits a minute', () => {
    expect(rateLimitResetOf(429, h({}), now)).toEqual(
      new Date(now.getTime() + 60_000)
    )
  })

  it('a plain 403 / 404 is not a rate limit', () => {
    expect(rateLimitResetOf(403, h({}), now)).toBeUndefined()
    expect(
      rateLimitResetOf(404, h({ 'Retry-After': '5' }), now)
    ).toBeUndefined()
  })
})
