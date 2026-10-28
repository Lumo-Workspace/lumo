/**
 * @jest-environment node
 */
/**
 * LUM-1321 — `lumo security import`, end to end on a real checkout with the
 * Lumo API faked: the branch's PR comes from the scan context, the report is
 * sent as SARIF for the local HEAD under the agent's tool name, and every
 * refusal (no PR, unpushed HEAD, bad file, server refusal, not logged in,
 * an old server) is an error line with exit 1, or exit 2 for a usage error.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { securityImportCommand } from '../../cli/src/commands/security-import'
import type { Credentials } from '../../cli/src/lib/config'
import type { ScanContext } from '../../cli/src/lib/scan-context'
import {
  captureOutput,
  git,
  inDir,
  isolateGitEnv,
  makeSandbox,
  type Sandbox,
} from '../../cli/test-support/real-git'

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

const REPORT = {
  findings: [
    {
      file: 'app.ts',
      line: 1,
      severity: 'high',
      title: 'SQL injection',
      detail: 'q reaches a raw query',
    },
  ],
}

describe('lumo security import', () => {
  let restore: () => void
  let sb: Sandbox
  let cacheDir: string
  let head: string
  let reportFile: string

  const context = (pr: ScanContext['pullRequest']): ScanContext => ({
    version: 1,
    repo: 'acme/app',
    baseline: null,
    rulings: [],
    learnings: [],
    learningsScope: 'auto',
    policy: { block: [] },
    pullRequest: pr,
  })

  /** A fake Lumo API: the context route and the import route. */
  const api = (pr: ScanContext['pullRequest'], answer?: Response) =>
    jest.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/security-scan/context'))
        return new Response(JSON.stringify(context(pr)), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: '"e1"' },
        })
      if (url.endsWith('/api/workspaces/me/security-scan/import')) {
        if (answer) return answer
        const body = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            runId: 'run_1',
            repository: body.repository,
            prNumber: body.prNumber,
            headSha: body.headSha,
            tool: body.tool,
            results: 1,
          }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      }
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
    fs.writeFileSync(path.join(sb.main, 'app.ts'), 'query(q)\n')
    git(sb.main, 'add', 'app.ts')
    git(sb.main, 'commit', '-q', '-m', 'feat')
    head = git(sb.main, 'rev-parse', 'HEAD').trim()
    reportFile = path.join(cacheDir, 'review.json')
    fs.writeFileSync(reportFile, JSON.stringify(REPORT))
  })
  afterEach(() => {
    sb.cleanup()
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })

  const run = (
    opts: Parameters<typeof securityImportCommand>[1],
    fetch: jest.Mock,
    env: Record<string, string | undefined> = { CLAUDE_CODE_SESSION_ID: 's1' },
    file = reportFile,
    readCreds: () => Credentials | null = () => creds
  ) =>
    inDir(sb.main, () =>
      captureOutput(() =>
        securityImportCommand(file, opts, {
          fetch: fetch as unknown as typeof globalThis.fetch,
          readCredentials: readCreds,
          cacheDir,
          env,
        })
      )
    )

  const importCall = (fetch: jest.Mock) =>
    fetch.mock.calls.find(([u]) => String(u).endsWith('/security-scan/import'))

  it('sends the report for the branch PR at the local HEAD, as the agent this shell runs in', async () => {
    const fetch = api({ number: 12, headSha: null })
    const { result, out } = await run({}, fetch)
    expect(result).toBe(0)
    const call = importCall(fetch)!
    expect(call[1].method).toBe('POST')
    expect(call[1].headers.Authorization).toBe('Bearer test-token')
    const body = JSON.parse(call[1].body)
    expect(body).toMatchObject({
      repository: 'acme/app',
      prNumber: 12,
      headSha: head,
      tool: 'claude-code',
    })
    expect(body.sarif.version).toBe('2.1.0')
    expect(body.sarif.runs[0].results[0].ruleId).toBe('sql-injection')
    expect(out).toContain(
      `Imported 1 result from claude-code into acme/app#12 @ ${head.slice(0, 7)}`
    )
    expect(out).toContain('advisory unless your workspace policy')
    expect(out).toContain('lumo pr show 12')
    expect(out).not.toContain('test-token')
  })

  it('--tool and --pr override the detection; --json prints the versioned result', async () => {
    const fetch = api(null)
    const { result, out } = await run(
      { tool: 'codex', pr: '7', json: true },
      fetch,
      {}
    )
    expect(result).toBe(0)
    // --pr given: no context read needed.
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/context'))).toBe(
      false
    )
    expect(JSON.parse(out)).toEqual({
      version: 1,
      runId: 'run_1',
      repository: 'acme/app',
      prNumber: 7,
      headSha: head,
      tool: 'codex',
      results: 1,
    })
  })

  it('refuses an unpushed HEAD before sending anything', async () => {
    const fetch = api({ number: 12, headSha: 'f'.repeat(40) })
    const { result, err } = await run({}, fetch)
    expect(result).toBe(1)
    expect(err).toMatch(/acme\/app#12 head is fffffff.*push first/)
    expect(importCall(fetch)).toBeUndefined()
  })

  it('refuses a branch with no open PR', async () => {
    const fetch = api(null)
    const { result, err } = await run({}, fetch)
    expect(result).toBe(1)
    expect(err).toMatch(/no open pull request for feature in acme\/app/)
  })

  it('needs --tool outside an agent, and rejects a CI scanner name (exit 2)', async () => {
    const fetch = api({ number: 12, headSha: null })
    expect((await run({}, fetch, {})).result).toBe(2)
    const bad = await run({ tool: 'semgrep' }, fetch)
    expect(bad.result).toBe(2)
    expect(bad.err).toMatch(/invalid --tool "semgrep"/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a bad report with the reason, before any request', async () => {
    fs.writeFileSync(
      reportFile,
      JSON.stringify({
        findings: [{ file: 'app.ts', line: 1, severity: 'urgent', title: 't' }],
      })
    )
    const fetch = api({ number: 12, headSha: null })
    const { result, err } = await run({}, fetch)
    expect(result).toBe(1)
    expect(err).toMatch(/findings\[0\]\.severity/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a directory as unreadable instead of crashing', async () => {
    const { result, err } = await run({}, api(null), undefined, cacheDir)
    expect(result).toBe(1)
    expect(err).toMatch(/cannot read/)
  })

  it('refuses a report that only grows past 1 MiB once converted, before sending it', async () => {
    const findings = Array.from({ length: 500 }, (_, i) => ({
      file: 'app.ts',
      line: 1,
      severity: 'low',
      title: `finding ${i}`,
      detail: 'x'.repeat(1990),
    }))
    fs.writeFileSync(reportFile, JSON.stringify({ findings }))
    expect(fs.statSync(reportFile).size).toBeLessThan(1024 * 1024)
    const fetch = api({ number: 12, headSha: null })
    const { result, err } = await run({}, fetch)
    expect(result).toBe(1)
    expect(err).toMatch(/larger than 1 MiB once converted to SARIF/)
    expect(importCall(fetch)).toBeUndefined()
  })

  it('reports a missing file', async () => {
    const { result, err } = await run(
      {},
      api(null),
      undefined,
      path.join(cacheDir, 'nope.json')
    )
    expect(result).toBe(1)
    expect(err).toMatch(/cannot read/)
  })

  it("relays the server's refusal", async () => {
    const fetch = api(
      { number: 12, headSha: null },
      new Response(
        JSON.stringify({
          error: 'Repository acme/app is not confirmed in this workspace',
        }),
        {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }
      )
    )
    const { result, err } = await run({}, fetch)
    expect(result).toBe(1)
    expect(err).toContain(
      'Error: Repository acme/app is not confirmed in this workspace'
    )
  })

  it('says the feature is missing on a server without the security plugin', async () => {
    const fetch = api(
      null,
      new Response('<html>404</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      })
    )
    const { result, err } = await run({ pr: '12' }, fetch)
    expect(result).toBe(1)
    expect(err).toMatch(/security import.*not available on this Lumo server/)
  })

  it('needs a login', async () => {
    const { result, err } = await run(
      { pr: '12' },
      api(null),
      undefined,
      reportFile,
      () => null
    )
    expect(result).toBe(1)
    expect(err).toMatch(/lumo auth login/)
  })
})
