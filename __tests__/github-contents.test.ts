// Mock auth module to avoid @octokit/auth-app ESM issue in Jest
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('test-token'),
}))

import { addedLinesFromDiff } from '@/lib/integrations/github/contents'

test('addedLinesFromDiff returns added lines per file, excluding +++ headers', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' const x = 1',
    '+console.log(x)',
    '-const y = 2',
  ].join('\n')
  const out = addedLinesFromDiff(diff)
  expect(out).toEqual([{ path: 'src/a.ts', addedLines: ['console.log(x)'] }])
})

test('addedLinesFromDiff handles multiple files', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,1 +1,2 @@',
    ' const x = 1',
    '+const z = 3',
    'diff --git a/src/b.ts b/src/b.ts',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -1,1 +1,2 @@',
    ' const a = 1',
    '+const b = 2',
  ].join('\n')
  const out = addedLinesFromDiff(diff)
  expect(out).toEqual([
    { path: 'src/a.ts', addedLines: ['const z = 3'] },
    { path: 'src/b.ts', addedLines: ['const b = 2'] },
  ])
})

test('addedLinesFromDiff excludes files with only deletions', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,1 @@',
    ' const x = 1',
    '-const y = 2',
  ].join('\n')
  const out = addedLinesFromDiff(diff)
  expect(out).toEqual([])
})

// ── fetchPrStats (LUM-634) ───────────────────────────────────────────────────

import { fetchPrStats } from '@/lib/integrations/github/contents'

describe('fetchPrStats', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  const mockFetch = (status: number, body: unknown) => {
    const fn = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
    global.fetch = fn as unknown as typeof fetch
    return fn
  }

  test('returns the numeric change-volume fields from the pulls API JSON', async () => {
    const fn = mockFetch(200, { additions: 10, deletions: 2, changed_files: 3 })
    await expect(
      fetchPrStats({ workspaceId: 'ws', fullName: 'a/b', prNumber: 7 })
    ).resolves.toEqual({ additions: 10, deletions: 2, changedFiles: 3 })
    expect(fn).toHaveBeenCalledWith(
      'https://api.github.com/repos/a/b/pulls/7',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    )
  })

  test('a real zero passes through as 0 — 0 is a measurement, not a gap', async () => {
    mockFetch(200, { additions: 0, deletions: 0, changed_files: 0 })
    await expect(
      fetchPrStats({ workspaceId: 'ws', fullName: 'a/b', prNumber: 7 })
    ).resolves.toEqual({ additions: 0, deletions: 0, changedFiles: 0 })
  })

  test('throws on a non-2xx status (the backfill counts it as a skip)', async () => {
    mockFetch(404, {})
    await expect(
      fetchPrStats({ workspaceId: 'ws', fullName: 'a/b', prNumber: 7 })
    ).rejects.toThrow('GitHub API error 404')
  })

  test('throws when the payload lacks numeric fields — never fabricates a 0', async () => {
    mockFetch(200, { additions: '10', deletions: null })
    await expect(
      fetchPrStats({ workspaceId: 'ws', fullName: 'a/b', prNumber: 7 })
    ).rejects.toThrow('missing change-volume fields')
  })
})
