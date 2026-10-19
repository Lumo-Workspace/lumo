/**
 * @jest-environment node
 */
/**
 * LUM-1256 — `lumo security scan` with server context, end to end on a real
 * checkout (origin pointed at a GitHub URL, the Lumo API faked): a finding
 * ruled false positive on the branch's PR shows as "ruled false positive";
 * `--offline` serves the cached context; `--pr` reports what was fixed
 * locally since the last push; a server without the plugin is no context,
 * not a failure; and the raw credential never reaches the output.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { securityScanCommand } from '../../cli/src/commands/security-scan'
import { EXIT_USAGE } from '../../cli/src/lib/exit-codes'
import type { Credentials } from '../../cli/src/lib/config'
import type { ScanContext } from '../../cli/src/lib/scan-context'
import { scanSecrets } from '../../shared/src/secret-scan/scan-secrets'
import {
  captureOutput,
  git,
  inDir,
  isolateGitEnv,
  makeSandbox,
  type Sandbox,
} from '../../cli/test-support/real-git'
import { fakeAwsKeyId } from '../../cli/test-support/fake-secrets'

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

describe('lumo security scan with server context', () => {
  let restore: () => void
  let sb: Sandbox
  let cacheDir: string
  const key = fakeAwsKeyId()
  const line = `export const awsKey = "${key}"`
  const fingerprint = scanSecrets([
    { path: 'config.ts', lines: [{ lineNo: 1, text: line }] },
  ])[0]!.fingerprint

  const context = (over: Partial<ScanContext> = {}): ScanContext => ({
    version: 1,
    repo: 'acme/app',
    baseline: null,
    rulings: [
      {
        fingerprint,
        ruleId: 'secret:aws-access-key-id',
        disposition: 'FALSE_POSITIVE',
        by: 'Alice',
        at: '2026-10-17T08:00:00.000Z',
        pullRequest: 12,
      },
    ],
    learnings: [],
    learningsScope: 'auto',
    policy: { block: [{ provenance: 'DETERMINISTIC', severity: 'HIGH' }] },
    pullRequest: { number: 12, headSha: 'abcdef1234567' },
    ...over,
  })

  /** A fake Lumo API: the context route and the PR scans route. */
  const api = (ctx: ScanContext | Response) =>
    jest.fn(async (url: string) => {
      if (url.includes('/security-scan/context'))
        return ctx instanceof Response
          ? ctx
          : new Response(JSON.stringify(ctx), {
              status: 200,
              headers: { 'content-type': 'application/json', etag: '"e1"' },
            })
      if (url.includes('/api/pull-requests/12/scans'))
        return new Response(
          JSON.stringify({
            scans: [
              {
                headSha: 'abcdef1234567',
                findings: [
                  {
                    kind: 'SECRET',
                    ruleId: 'secret:aws-access-key-id',
                    severity: 'HIGH',
                    provenance: 'DETERMINISTIC',
                    filePath: 'config.ts',
                    line: 1,
                    title: 'AWS access key ID',
                    fingerprint,
                    open: false,
                    disposition: 'FALSE_POSITIVE',
                  },
                  {
                    kind: 'SECRET',
                    ruleId: 'secret:github-pat',
                    severity: 'HIGH',
                    provenance: 'DETERMINISTIC',
                    filePath: 'old.ts',
                    line: 4,
                    title: 'GitHub token',
                    fingerprint: 'fp-removed',
                    open: true,
                    disposition: null,
                  },
                  {
                    kind: 'VULNERABILITY',
                    ruleId: 'judge:sqli',
                    severity: 'MEDIUM',
                    provenance: 'LLM_JUDGE',
                    filePath: 'db.ts',
                    line: 3,
                    title: 'SQL injection',
                    fingerprint: 'fp-j',
                    open: true,
                    disposition: null,
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      throw new Error(`unexpected ${url}`)
    })

  beforeAll(() => {
    restore = isolateGitEnv()
  })
  afterAll(() => restore())

  beforeEach(() => {
    sb = makeSandbox('main')
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-ctx-'))
    git(
      sb.main,
      'remote',
      'set-url',
      'origin',
      'https://github.com/acme/app.git'
    )
    git(sb.main, 'checkout', '-q', '-b', 'feature')
    fs.writeFileSync(path.join(sb.main, 'config.ts'), `${line}\n`)
  })
  afterEach(() => {
    sb.cleanup()
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })

  const run = (
    opts: Parameters<typeof securityScanCommand>[0],
    fetch: jest.Mock
  ) =>
    inDir(sb.main, () =>
      captureOutput(() =>
        securityScanCommand(opts, {
          fetch: fetch as unknown as typeof globalThis.fetch,
          readCredentials: () => creds,
          cacheDir,
        })
      )
    )

  it('labels a finding ruled false positive on the branch PR', async () => {
    const fetch = api(context())
    const { result, out } = await run({}, fetch)
    expect(result).toBe(0)
    expect(fetch.mock.calls[0]![0]).toContain('repo=acme%2Fapp&branch=feature')
    const lines = out.split('\n')
    expect(lines[0]).toBe('scan: 1 finding (1 high, 0 medium, 0 low)')
    expect(out).toContain(
      'Server: acme/app · live · PR #12 · 0 would block DONE'
    )
    expect(out).toMatch(
      /Server: +ruled false positive by Alice on #12, 2026-10-17 \(this branch’s PR — carries over\)/
    )
    expect(out).not.toContain(key)
  })

  it('--json carries the label, and --offline then serves it from the cache', async () => {
    const online = await run({ json: true }, api(context()))
    const json = JSON.parse(online.out)
    expect(json.findings[0].server).toMatchObject({
      status: 'FALSE_POSITIVE',
      by: 'Alice',
      pullRequest: 12,
      carriesOver: true,
      wouldBlockDone: false,
    })
    expect(json.serverContext).toMatchObject({
      source: 'live',
      repo: 'acme/app',
    })
    expect(online.out).not.toContain(key)

    const fetch = jest.fn()
    const offline = await run({ json: true, offline: true }, fetch)
    expect(fetch).not.toHaveBeenCalled()
    const cached = JSON.parse(offline.out)
    expect(cached.serverContext.source).toBe('cache')
    expect(cached.findings[0].server.status).toBe('FALSE_POSITIVE')
  })

  it('a new finding would block DONE under the workspace policy', async () => {
    const { out } = await run({}, api(context({ rulings: [] })))
    expect(out).toContain('1 would block DONE')
    expect(out).toMatch(/Server: +new · would block DONE/)
  })

  it('--pr: fixed locally since the last push, and the server-only layers', async () => {
    const { result, out } = await run({ pr: true }, api(context()))
    expect(result).toBe(0)
    expect(out).toContain('PR #12 (server scanned abcdef1)')
    expect(out).toContain(
      '1 still reported locally · 1 fixed locally since the last push'
    )
    expect(out).toContain('fixed: [HIGH] GitHub token · old.ts:4')
    expect(out).toContain('Server-only layers: 1 AI review, 0 hunt open')
    expect(out).toContain('`lumo pr review 12`')
  })

  it('--pr with --staged names the PR but does not compare', async () => {
    git(sb.main, 'add', 'config.ts')
    const { out } = await run({ pr: true, staged: true }, api(context()))
    expect(out).toContain(
      'not compared: --staged / --since do not cover the PR diff'
    )
  })

  it('a server without the security plugin is no context, and the scan still runs', async () => {
    const fetch = api(
      new Response('<html>Not found</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      })
    )
    const { result, out } = await run({ failOn: 'high' }, fetch)
    expect(out).toContain(
      'Server: no context — this Lumo server does not serve scan context (no security plugin, or an older server)'
    )
    expect(out).not.toMatch(/Server: +new/)
    // --fail-on still judges by severity alone.
    expect(result).toBe(3)
  })

  it('usage: --pr with --offline, and a malformed --repo, exit 2 before any call', async () => {
    const fetch = jest.fn()
    const both = await run({ pr: true, offline: true }, fetch)
    expect(both.result).toBe(EXIT_USAGE)
    expect(both.err).toMatch(
      /--pr reads the server; it cannot run with --offline/
    )
    const bad = await run({ repo: 'nope' }, fetch)
    expect(bad.result).toBe(EXIT_USAGE)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('--repo overrides the origin remote', async () => {
    const fetch = api(context({ repo: 'acme/fork' }))
    await run({ repo: 'acme/fork' }, fetch)
    expect(fetch.mock.calls[0]![0]).toContain('repo=acme%2Ffork')
  })
})
