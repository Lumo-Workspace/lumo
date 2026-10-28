/**
 * @jest-environment node
 *
 * LUM-1256 — the local scan's server context: GitHub remote parsing, the
 * ETag cache (200 writes it, the next call sends If-None-Match and a 304
 * serves it), `--offline` reading only the cache, and every way the server
 * can be absent (no plugin's HTML 404, a repo not linked, no network, no
 * credentials) degrading to "no context" or the cache — never an error.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  cacheFile,
  loadPrScan,
  loadScanContext,
  parseGithubRepo,
  SCAN_CONTEXT_PATH,
  type ScanContext,
} from '../../cli/src/lib/scan-context'
import type { Credentials } from '../../cli/src/lib/config'

const creds: Credentials = {
  token: 'test-token',
  apiUrl: 'https://lumo.example.test',
  userId: 'u1',
  email: 'dev@example.test',
  workspaceId: 'ws_1',
  workspaceSlug: 'acme',
  workspaceName: 'Acme',
  apiKeyId: 'k1',
  apiKeyName: 'cli',
  apiKeyPrefix: 'lum_',
}

const context: ScanContext = {
  version: 1,
  repo: 'acme/app',
  baseline: null,
  rulings: [],
  learnings: [],
  learningsScope: 'auto',
  policy: { block: [{ provenance: 'DETERMINISTIC', severity: 'HIGH' }] },
  pullRequest: null,
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('parseGithubRepo', () => {
  it.each([
    ['https://github.com/acme/app.git', 'acme/app'],
    ['https://github.com/acme/app', 'acme/app'],
    ['https://user@github.com/acme/app.git/', 'acme/app'],
    ['git@github.com:acme/app.git', 'acme/app'],
    ['ssh://git@github.com/acme/my.app.git', 'acme/my.app'],
    ['ssh://git@github.com:22/acme/app', 'acme/app'],
  ])('%s → %s', (url, repo) => {
    expect(parseGithubRepo(url)).toBe(repo)
  })

  it.each(['/tmp/remote.git', 'https://gitlab.com/acme/app.git', ''])(
    '%s is not a GitHub repository',
    url => {
      expect(parseGithubRepo(url)).toBeNull()
    }
  )
})

describe('loadScanContext', () => {
  let dir: string
  const base = () => ({
    readCredentials: () => creds,
    cacheDir: dir,
    now: () => new Date('2026-10-19T12:00:00Z'),
  })
  const opts = { repo: 'acme/app', branch: 'feature/x', offline: false }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-ctx-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('fetches with the bearer token and caches the body under its ETag', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(json(context, 200, { etag: '"e1"' }))
    const r = await loadScanContext(opts, { ...base(), fetch })
    expect(r).toEqual({
      source: 'live',
      note: null,
      repo: 'acme/app',
      fetchedAt: '2026-10-19T12:00:00.000Z',
      context,
    })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(
      `https://lumo.example.test${SCAN_CONTEXT_PATH}?repo=acme%2Fapp&branch=feature%2Fx`
    )
    expect(init.headers).toEqual({ Authorization: 'Bearer test-token' })
    const file = cacheFile(dir, {
      apiUrl: creds.apiUrl,
      workspaceId: 'ws_1',
      repo: 'acme/app',
      branch: 'feature/x',
    })
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(cached).toMatchObject({ etag: '"e1"', context })
    expect(fs.statSync(file).mode & 0o077).toBe(0)
    // The token is never cached.
    expect(fs.readFileSync(file, 'utf8')).not.toContain('test-token')
  })

  it('revalidates with If-None-Match and serves the cache on 304', async () => {
    await loadScanContext(opts, {
      ...base(),
      fetch: jest.fn().mockResolvedValue(json(context, 200, { etag: '"e1"' })),
    })
    const fetch = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 304 }))
    const r = await loadScanContext(opts, {
      ...base(),
      now: () => new Date('2026-10-19T13:00:00Z'),
      fetch,
    })
    expect(fetch.mock.calls[0][1].headers['If-None-Match']).toBe('"e1"')
    expect(r.source).toBe('live')
    expect(r.fetchedAt).toBe('2026-10-19T13:00:00.000Z')
    expect(r.context).toEqual(context)
  })

  it('keys the cache by repository and branch', async () => {
    await loadScanContext(opts, {
      ...base(),
      fetch: jest.fn().mockResolvedValue(json(context, 200, { etag: '"e1"' })),
    })
    const fetch = jest
      .fn()
      .mockResolvedValue(json(context, 200, { etag: '"e2"' }))
    await loadScanContext({ ...opts, branch: 'other' }, { ...base(), fetch })
    expect(fetch.mock.calls[0][1].headers['If-None-Match']).toBeUndefined()
  })

  it('--offline reads only the cache', async () => {
    const fetch = jest.fn()
    const empty = await loadScanContext(
      { ...opts, offline: true },
      { ...base(), fetch }
    )
    expect(empty).toMatchObject({ source: 'none', context: null })
    expect(empty.note).toMatch(/--offline and no cached context/)

    await loadScanContext(opts, {
      ...base(),
      fetch: jest.fn().mockResolvedValue(json(context, 200, { etag: '"e1"' })),
    })
    const r = await loadScanContext(
      { ...opts, offline: true },
      { ...base(), fetch }
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(r).toMatchObject({ source: 'cache', context })
    expect(r.note).toMatch(
      /^--offline — using the context cached 2026-10-19T12:00/
    )
  })

  it('a server without the security plugin (its HTML 404) is no context, not a failure', async () => {
    const fetch = jest.fn().mockResolvedValue(
      new Response('<html>404</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      })
    )
    const r = await loadScanContext(opts, { ...base(), fetch })
    expect(r).toMatchObject({
      source: 'none',
      note: 'this Lumo server does not serve scan context (no security plugin, or an older server)',
      context: null,
    })
  })

  it('LUM-1330 the server followed a rename: the result carries the current name', async () => {
    const fetch = jest.fn().mockResolvedValue(
      json({ ...context, repo: 'acme/new', renamedFrom: 'acme/app' }, 200, {
        etag: '"e9"',
      })
    )
    const r = await loadScanContext(opts, { ...base(), fetch })
    expect(r).toMatchObject({
      source: 'live',
      repo: 'acme/new',
      context: { renamedFrom: 'acme/app' },
    })
    // A 304 from the cache keeps following it.
    const again = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 304 }))
    const r2 = await loadScanContext(opts, { ...base(), fetch: again })
    expect(r2.repo).toBe('acme/new')
    // So do --offline and the fallback to the cache when Lumo is down.
    const offline = await loadScanContext(
      { ...opts, offline: true },
      { ...base(), fetch: jest.fn() }
    )
    expect(offline).toMatchObject({ source: 'cache', repo: 'acme/new' })
    const down = await loadScanContext(opts, {
      ...base(),
      fetch: jest.fn().mockRejectedValue(new Error('fetch failed')),
    })
    expect(down).toMatchObject({ source: 'cache', repo: 'acme/new' })
  })

  it('a repository the workspace does not own (JSON 404) is no context', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(
        json({ error: 'Repository not linked to this workspace' }, 404)
      )
    const r = await loadScanContext(opts, { ...base(), fetch })
    expect(r).toMatchObject({
      source: 'none',
      note: 'acme/app is not linked to this Lumo workspace',
    })
  })

  it('falls back to the cache when Lumo is unreachable or failing', async () => {
    const down = jest.fn().mockRejectedValue(new Error('fetch failed'))
    expect(
      await loadScanContext(opts, { ...base(), fetch: down })
    ).toMatchObject({
      source: 'none',
      note: 'could not reach Lumo (fetch failed)',
    })
    await loadScanContext(opts, {
      ...base(),
      fetch: jest.fn().mockResolvedValue(json(context, 200, { etag: '"e1"' })),
    })
    const r = await loadScanContext(opts, { ...base(), fetch: down })
    expect(r.source).toBe('cache')
    expect(r.context).toEqual(context)
    expect(r.note).toMatch(
      /^could not reach Lumo \(fetch failed\) — using the context cached/
    )
    const r500 = await loadScanContext(opts, {
      ...base(),
      fetch: jest.fn().mockResolvedValue(json({ error: 'x' }, 500)),
    })
    expect(r500).toMatchObject({ source: 'cache', context })
  })

  it('ignores a body of an unknown version', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(json({ ...context, version: 2 }, 200, { etag: '"e"' }))
    expect((await loadScanContext(opts, { ...base(), fetch })).source).toBe(
      'none'
    )
  })

  it('needs credentials and a repository, and makes no call without them', async () => {
    const fetch = jest.fn()
    expect(
      await loadScanContext(opts, {
        ...base(),
        readCredentials: () => null,
        fetch,
      })
    ).toMatchObject({ source: 'none', note: 'not logged in (lumo auth login)' })
    expect(
      await loadScanContext({ ...opts, repo: null }, { ...base(), fetch })
    ).toMatchObject({
      source: 'none',
      note: 'no GitHub origin remote (pass --repo owner/name)',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('loadPrScan', () => {
  const deps = { readCredentials: () => creds }

  it('reads the latest scan of the PR through the pr show route', async () => {
    const fetch = jest.fn().mockResolvedValue(
      json({
        scans: [
          { headSha: 'abc', findings: [{ ruleId: 'r' }] },
          { headSha: 'old' },
        ],
      })
    )
    const r = await loadPrScan(12, 'acme/app', { ...deps, fetch })
    expect(fetch.mock.calls[0][0]).toBe(
      'https://lumo.example.test/api/pull-requests/12/scans?repo=acme%2Fapp'
    )
    expect(r).toEqual({ ok: true, headSha: 'abc', findings: [{ ruleId: 'r' }] })
  })

  it('reports a PR with no scan, or a failed read, as a note', async () => {
    expect(
      await loadPrScan(12, 'acme/app', {
        ...deps,
        fetch: jest.fn().mockResolvedValue(json({ scans: [] })),
      })
    ).toEqual({ ok: false, note: 'PR #12 has no scan yet' })
    expect(
      await loadPrScan(12, 'acme/app', {
        ...deps,
        fetch: jest.fn().mockResolvedValue(json({}, 500)),
      })
    ).toEqual({ ok: false, note: 'reading PR #12 failed (HTTP 500)' })
  })
})
