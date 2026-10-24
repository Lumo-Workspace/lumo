// Mock auth module to avoid @octokit/auth-app ESM issue in Jest
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('test-token'),
  revokeInstallationToken: jest.fn().mockResolvedValue(true),
}))

import { addedLinesFromDiff } from '@/lib/integrations/github/contents'
import {
  fetchCompareDiff,
  fetchReviewChangedPaths,
} from '@/lib/integrations/github/contents'

test('LUM-1056 compare refuses divergent and capped histories, includes previous paths on rename', async () => {
  const original = global.fetch
  const fetchMock = jest.fn()
  global.fetch = fetchMock
  try {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'ahead',
        files: [{ filename: 'new.ts', previous_filename: 'old.ts' }],
      }),
    })
    expect(
      await fetchReviewChangedPaths({
        workspaceId: 'w',
        fullName: 'o/r',
        base: 'a',
        head: 'b',
      })
    ).toEqual(['new.ts', 'old.ts'])
    for (const value of [
      { status: 'diverged', files: [] },
      {
        status: 'ahead',
        files: Array.from({ length: 300 }, () => ({ filename: 'f' })),
      },
      { status: 'ahead' },
    ]) {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => value })
      await expect(
        fetchReviewChangedPaths({
          workspaceId: 'w',
          fullName: 'o/r',
          base: 'a',
          head: 'b',
        })
      ).rejects.toThrow()
    }
    fetchMock.mockResolvedValueOnce({ ok: false })
    await expect(
      fetchReviewChangedPaths({
        workspaceId: 'w',
        fullName: 'o/r',
        base: 'gone',
        head: 'b',
      })
    ).rejects.toThrow()
  } finally {
    global.fetch = original
  }
})

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

// ── readRepoFileWithToken / encodeRepoPath (LUM-988) ─────────────────────────

import {
  encodeRepoPath,
  readRepoFileWithToken,
  withRepoReadToken,
} from '@/lib/integrations/github/contents'
import * as ghAuth from '@/lib/integrations/github/auth'

describe('LUM-988 readRepoFileWithToken', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('encodes each path segment, keeps the slashes', () => {
    expect(encodeRepoPath('docs/faq#1.md')).toBe('docs/faq%231.md')
    expect(encodeRepoPath('src/a?b.ts')).toBe('src/a%3Fb.ts')
    expect(encodeRepoPath('a b/c%d.ts')).toBe('a%20b/c%25d.ts')
  })

  it('reads with the given token at the ref, the path encoded; 404 is null', async () => {
    const urls: string[] = []
    const auths: string[] = []
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(input))
        auths.push(
          (init?.headers as Record<string, string> | undefined)
            ?.Authorization ?? ''
        )
        return String(input).includes('missing')
          ? { status: 404, ok: false, text: async () => '' }
          : { status: 200, ok: true, text: async () => 'body' }
      }
    ) as unknown as typeof fetch

    await expect(
      readRepoFileWithToken({
        token: 'tok-1',
        fullName: 'o/r',
        path: 'docs/faq#1.md',
        ref: 'abc',
      })
    ).resolves.toBe('body')
    await expect(
      readRepoFileWithToken({
        token: 'tok-1',
        fullName: 'o/r',
        path: 'missing.ts',
      })
    ).resolves.toBeNull()
    expect(urls[0]).toBe(
      'https://api.github.com/repos/o/r/contents/docs/faq%231.md?ref=abc'
    )
    expect(auths).toEqual(['Bearer tok-1', 'Bearer tok-1'])
  })

  it('throws with the status on any other failure', async () => {
    global.fetch = jest.fn(async () => ({
      status: 429,
      ok: false,
      text: async () => '',
    })) as unknown as typeof fetch
    await expect(
      readRepoFileWithToken({ token: 't', fullName: 'o/r', path: 'a.ts' })
    ).rejects.toMatchObject({ status: 429 })
  })
})

describe('LUM-988 withRepoReadToken', () => {
  const getRepoToken = ghAuth.getRepoToken as jest.Mock
  const revoke = ghAuth.revokeInstallationToken as jest.Mock
  beforeEach(() => {
    getRepoToken.mockClear()
    revoke.mockClear()
  })

  it('mints one contents:read token, runs fn with it, then revokes it', async () => {
    const out = await withRepoReadToken(
      { workspaceId: 'w1', fullName: 'o/r' },
      async t => `used ${t}`
    )
    expect(out).toBe('used test-token')
    expect(getRepoToken).toHaveBeenCalledTimes(1)
    expect(getRepoToken).toHaveBeenCalledWith('w1', 'o/r', { contents: 'read' })
    expect(revoke).toHaveBeenCalledWith('test-token')
  })

  it('revokes even when fn throws, and rethrows', async () => {
    await expect(
      withRepoReadToken({ workspaceId: 'w1', fullName: 'o/r' }, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(revoke).toHaveBeenCalledWith('test-token')
  })

  it('propagates a refused mint without calling fn', async () => {
    getRepoToken.mockRejectedValueOnce(new Error('repo_not_confirmed'))
    const fn = jest.fn()
    await expect(
      withRepoReadToken({ workspaceId: 'w1', fullName: 'o/r' }, fn)
    ).rejects.toThrow('repo_not_confirmed')
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('LUM-988 readRepoFileWithToken abort', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })
  it('passes the abort signal to fetch', async () => {
    const seen: Array<AbortSignal | undefined> = []
    global.fetch = jest.fn(async (_input: unknown, init?: RequestInit) => {
      seen.push(init?.signal ?? undefined)
      return { status: 200, ok: true, text: async () => 'ok' }
    }) as unknown as typeof fetch
    const ctrl = new AbortController()
    await readRepoFileWithToken({
      token: 't',
      fullName: 'o/r',
      path: 'a.ts',
      signal: ctrl.signal,
    })
    expect(seen[0]).toBe(ctrl.signal)
  })
})

// ── listRepoDirWithToken (LUM-1208) ──────────────────────────────────────────

import { listRepoDirWithToken } from '@/lib/integrations/github/contents'

describe('LUM-1208 listRepoDirWithToken', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('lists the files of a directory at the ref (root and nested); 404 or a file path is []', async () => {
    const urls: string[] = []
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const u = String(input)
      urls.push(u)
      if (u.includes('missing'))
        return { status: 404, ok: false, json: async () => ({}) }
      if (u.includes('Makefile'))
        return { status: 200, ok: true, json: async () => ({ type: 'file' }) }
      return {
        status: 200,
        ok: true,
        json: async () => [
          { type: 'file', path: 'frontend/Trunk.toml' },
          { type: 'dir', path: 'frontend/src' },
          { type: 'symlink', path: 'frontend/link.toml' },
        ],
      }
    }) as unknown as typeof fetch

    await expect(
      listRepoDirWithToken({
        token: 't',
        fullName: 'o/r',
        path: 'frontend',
        ref: 'abc',
      })
    ).resolves.toEqual(['frontend/Trunk.toml'])
    await listRepoDirWithToken({ token: 't', fullName: 'o/r', path: '' })
    await expect(
      listRepoDirWithToken({ token: 't', fullName: 'o/r', path: 'missing' })
    ).resolves.toEqual([])
    await expect(
      listRepoDirWithToken({ token: 't', fullName: 'o/r', path: 'Makefile' })
    ).resolves.toEqual([])
    expect(urls[0]).toBe(
      'https://api.github.com/repos/o/r/contents/frontend?ref=abc'
    )
    expect(urls[1]).toBe('https://api.github.com/repos/o/r/contents')
  })

  it('throws with the status on any other failure', async () => {
    global.fetch = jest.fn(async () => ({
      status: 403,
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch
    await expect(
      listRepoDirWithToken({ token: 't', fullName: 'o/r', path: 'a' })
    ).rejects.toMatchObject({ status: 403 })
  })
})

test('LUM-1312 compare diff: patches as a unified diff; not an ancestor ⇒ no diff', async () => {
  const original = global.fetch
  const fetchMock = jest.fn()
  global.fetch = fetchMock
  try {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'ahead',
        ahead_by: 2,
        files: [
          {
            filename: 'src/a.ts',
            status: 'modified',
            patch: '@@ -1 +1 @@\n-a\n+b',
          },
          {
            filename: 'src/new.ts',
            status: 'added',
            patch: '@@ -0,0 +1 @@\n+n',
          },
          { filename: 'img.png', status: 'added' },
          { filename: 'b.ts', previous_filename: 'old.ts', status: 'renamed' },
        ],
      }),
    })
    expect(
      await fetchCompareDiff({
        workspaceId: 'w',
        fullName: 'o/r',
        base: 'a',
        head: 'b',
      })
    ).toEqual({
      ancestor: true,
      aheadBy: 2,
      files: 4,
      complete: true,
      diff: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@\n-a\n+b',
        'diff --git a/src/new.ts b/src/new.ts',
        '--- /dev/null',
        '+++ b/src/new.ts',
        '@@ -0,0 +1 @@\n+n',
        'diff --git a/img.png b/img.png',
        '--- /dev/null',
        '+++ b/img.png',
        'diff --git a/old.ts b/b.ts',
        '--- a/old.ts',
        '+++ b/b.ts',
        '',
      ].join('\n'),
    })
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.github.com/repos/o/r/compare/a...b'
    )
    for (const status of ['diverged', 'behind']) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status, files: [] }),
      })
      expect(
        await fetchCompareDiff({
          workspaceId: 'w',
          fullName: 'o/r',
          base: 'a',
          head: 'b',
        })
      ).toEqual({ ancestor: false, status })
    }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'ahead',
        files: Array.from({ length: 300 }, () => ({
          filename: 'f',
          status: 'modified',
        })),
      }),
    })
    expect(
      await fetchCompareDiff({
        workspaceId: 'w',
        fullName: 'o/r',
        base: 'a',
        head: 'b',
      })
    ).toMatchObject({ ancestor: true, complete: false, aheadBy: 0 })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })
    await expect(
      fetchCompareDiff({
        workspaceId: 'w',
        fullName: 'o/r',
        base: 'gone',
        head: 'b',
      })
    ).rejects.toMatchObject({ status: 404 })
  } finally {
    global.fetch = original
  }
})
