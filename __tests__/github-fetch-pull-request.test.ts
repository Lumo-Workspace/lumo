/** @jest-environment node */
import {
  fetchPullRequest,
  parsePrUrl,
  toPrState,
} from '@/lib/integrations/github/fetch-pull-request'

describe('parsePrUrl', () => {
  it('parses a GitHub PR URL into repo and number', () => {
    expect(parsePrUrl('https://github.com/acme/app/pull/42')).toEqual({
      repo: 'acme/app',
      number: 42,
    })
  })

  it('parses a PR URL with trailing path segments', () => {
    expect(parsePrUrl('https://github.com/acme/app/pull/7/files')).toEqual({
      repo: 'acme/app',
      number: 7,
    })
  })

  it('returns null for a non-PR URL so callers can map it to 400', () => {
    expect(parsePrUrl('https://example.com/acme/app/issues/42')).toBeNull()
    expect(parsePrUrl('https://github.com/acme/app')).toBeNull()
    expect(parsePrUrl('nonsense')).toBeNull()
  })
})

describe('toPrState', () => {
  it('reports a merged PR as merged even though GitHub calls it closed', () => {
    expect(toPrState({ state: 'closed', merged: true })).toBe('merged')
  })

  it('distinguishes closed-unmerged from open', () => {
    expect(toPrState({ state: 'closed', merged: false })).toBe('closed')
    expect(toPrState({ state: 'open', merged: false })).toBe('open')
  })
})

describe('fetchPullRequest', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('requests the PR with the caller OAuth token and returns the payload', async () => {
    const payload = { number: 42, title: 'Add thing' }
    const mockFetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => payload })
    global.fetch = mockFetch as unknown as typeof fetch

    const result = await fetchPullRequest({
      token: 'tok',
      repo: 'acme/app',
      number: 42,
    })

    expect(result).toEqual(payload)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/app/pulls/42',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'token tok' }),
      })
    )
  })

  it('returns null on a non-ok response so the caller owns the status', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch

    await expect(
      fetchPullRequest({ token: 'tok', repo: 'acme/app', number: 42 })
    ).resolves.toBeNull()
  })
})
