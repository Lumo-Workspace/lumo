/**
 * @jest-environment node
 */
/**
 * LUM-1259 — `lumo security scan --commit` / `--log` on a real checkout with
 * the Lumo API faked:
 * - one run per commit (first parent → commit), with sha, parent, patch-id,
 *   branch, actor and the server label — never the evidence line, the raw
 *   secret or the commit message;
 * - the patch-id survives an amend that keeps the diff and a rebase;
 * - offline (no network, a 5xx, --offline) the runs are queued under the
 *   git dir and flushed by the next run that reaches the server; a refusal
 *   that will not change (logging off) drops the queue;
 * - logging never fails the scan (exit 0), and the usage errors (exit 2).
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  commitModeError,
  securityScanCommand,
} from '../../cli/src/commands/security-scan'
import { EXIT_USAGE } from '../../cli/src/lib/exit-codes'
import type { Credentials } from '../../cli/src/lib/config'
import {
  buildRunPayload,
  commitsInRange,
  detectActor,
  LOCAL_RUNS_PATH,
  patchIdOf,
  queueFile,
  readQueue,
  type LocalRunPayload,
} from '../../cli/src/lib/local-scan-log'
import { EXIT_FAIL_ON } from '../../cli/src/lib/local-scan-report'
import type { ScanContext } from '../../cli/src/lib/scan-context'
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

type Upload = { version: 1; runs: LocalRunPayload[] }

/**
 * A fake Lumo API: the scan context, and the local-runs endpoint answering
 * with `uploadStatus` (200 = every run created). Uploads are recorded.
 */
function fakeApi(uploadStatus: number | 'network' = 200, body?: unknown) {
  const uploads: Upload[] = []
  const fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes(LOCAL_RUNS_PATH)) {
      if (uploadStatus === 'network') throw new Error('getaddrinfo ENOTFOUND')
      const upload = JSON.parse(String(init?.body)) as Upload
      uploads.push(upload)
      const answer =
        body ??
        (uploadStatus === 200
          ? {
              version: 1,
              results: upload.runs.map(r => ({
                commitSha: r.commitSha,
                status: 'created',
              })),
            }
          : { error: 'nope' })
      return new Response(JSON.stringify(answer), {
        status: uploadStatus,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(context), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: '"e1"' },
    })
  })
  return { fetch, uploads }
}

describe('lumo security scan --log', () => {
  let restore: () => void
  let sb: Sandbox
  let cacheDir: string
  const key = fakeAwsKeyId()

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
  })
  afterEach(() => {
    sb.cleanup()
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })

  const write = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(sb.main, rel)), { recursive: true })
    fs.writeFileSync(path.join(sb.main, rel), text)
  }
  const commit = (msg: string): string => {
    git(sb.main, 'add', '-A')
    git(sb.main, 'commit', '-q', '-m', msg)
    return git(sb.main, 'rev-parse', 'HEAD')
  }
  const run = (
    opts: Parameters<typeof securityScanCommand>[0],
    fetch: jest.Mock,
    env: Record<string, string | undefined> = {}
  ) =>
    inDir(sb.main, () =>
      captureOutput(() =>
        securityScanCommand(opts, {
          fetch: fetch as unknown as typeof globalThis.fetch,
          readCredentials: () => creds,
          cacheDir,
          env,
          now: () => new Date('2026-10-19T12:00:00.000Z'),
        })
      )
    )
  const queue = (): LocalRunPayload[] => {
    const file = queueFile(sb.main)
    return file ? readQueue(file) : []
  }

  it('records one run for the commit: sha, parent, patch-id, branch, label — no evidence, secret or message', async () => {
    const parent = git(sb.main, 'rev-parse', 'HEAD')
    write('config.ts', `export const awsKey = "${key}"\n`)
    const sha = commit('add the deploy key SECRET-MESSAGE-MARKER')
    const api = fakeApi()
    const { result, out } = await run(
      { commit: sha, log: true, json: true },
      api.fetch,
      { CLAUDE_CODE_SESSION_ID: 'sess-1' }
    )
    expect(result).toBe(0)
    expect(api.uploads).toHaveLength(1)
    const [r] = api.uploads[0]!.runs
    expect(r).toMatchObject({
      repo: 'acme/app',
      commitSha: sha,
      parentSha: parent,
      branch: 'feature',
      actor: 'AGENT',
      sessionId: 'sess-1',
      trigger: 'MANUAL',
      scanners: ['SECRETS'],
      scannerVersion: 'secrets@1',
      findingCount: 1,
      scannedAt: '2026-10-19T12:00:00.000Z',
    })
    expect(r!.patchId).toMatch(/^[0-9a-f]{40}$/)
    expect(r!.findings[0]).toMatchObject({
      scanner: 'SECRETS',
      filePath: 'config.ts',
      line: 1,
      severity: 'HIGH',
      label: 'NEW',
    })
    expect(Object.keys(r!.findings[0]!).sort()).toEqual(
      [
        'scanner',
        'fingerprint',
        'ruleId',
        'severity',
        'filePath',
        'line',
        'title',
        'label',
      ].sort()
    )
    const sent = JSON.stringify(api.uploads)
    expect(sent).not.toContain(key)
    expect(sent).not.toContain('SECRET-MESSAGE-MARKER')
    expect(sent).not.toContain('evidence')
    const json = JSON.parse(out)
    expect(json.log).toMatchObject({
      commits: [sha],
      sent: 1,
      created: 1,
      queued: 0,
      note: null,
    })
    expect(json.findings[0].commitSha).toBe(sha)
    expect(out).not.toContain(key)
  })

  it('reads as a person (USER, no session) outside an agent', async () => {
    write('a.ts', 'export const a = 1\n')
    const sha = commit('a')
    const api = fakeApi()
    await run({ commit: sha, log: true }, api.fetch, {})
    expect(api.uploads[0]!.runs[0]).toMatchObject({
      actor: 'USER',
      sessionId: null,
      findingCount: 0,
      findings: [],
    })
    expect(detectActor({ CODEX_THREAD_ID: 't1' })).toEqual({
      actor: 'AGENT',
      sessionId: 't1',
    })
  })

  it('--until with --since records each non-merge commit of the range, oldest first', async () => {
    const base = git(sb.main, 'rev-parse', 'HEAD')
    write('a.ts', `export const awsKey = "${key}"\n`)
    const a = commit('a')
    write('b.ts', 'export const b = 2\n')
    const b = commit('b')
    const api = fakeApi()
    const { out } = await run(
      { since: base, until: b, log: true, hook: 'pre-push' },
      api.fetch
    )
    const runs = api.uploads[0]!.runs
    expect(runs.map(r => r.commitSha)).toEqual([a, b])
    expect(runs.map(r => r.trigger)).toEqual(['PRE_PUSH', 'PRE_PUSH'])
    expect(runs.map(r => r.findingCount)).toEqual([1, 0])
    expect(out).toContain('scan: 1 finding (1 high, 0 medium, 0 low)')
    expect(out).toContain('Log: 2 commits scanned · 2 sent (2 new')
    expect(out).toMatch(new RegExp(`Commit: +${a.slice(0, 12)}`))
    expect(out.split('\n').find(l => l.startsWith('Log:'))).toBe(
      'Log: 2 commits scanned · 2 sent (2 new, 0 already logged) · 0 queued'
    )
    expect(commitsInRange(sb.main, base, b)).toEqual({
      shas: [a, b],
      truncated: false,
    })
  })

  it('--until alone starts at the merge-base with the default branch', async () => {
    write('a.ts', 'export const a = 1\n')
    const a = commit('a')
    const api = fakeApi()
    await run({ until: a, log: true }, api.fetch)
    expect(api.uploads[0]!.runs.map(r => r.commitSha)).toEqual([a])
  })

  it('skips a merge commit', async () => {
    git(sb.main, 'checkout', '-q', '-b', 'side')
    write('s.ts', 'export const s = 1\n')
    commit('side')
    git(sb.main, 'checkout', '-q', 'feature')
    write('f.ts', 'export const f = 1\n')
    commit('feature')
    git(sb.main, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side')
    const merge = git(sb.main, 'rev-parse', 'HEAD')
    const api = fakeApi()
    const { out } = await run(
      { commit: merge, log: true, json: true },
      api.fetch
    )
    expect(api.uploads).toHaveLength(0)
    expect(JSON.parse(out).log).toMatchObject({ commits: [], skipped: 1 })
  })

  describe('patch-id', () => {
    it('survives an amend that keeps the diff, and a rebase onto a new base', () => {
      write('a.ts', `export const awsKey = "${key}"\n`)
      const original = commit('first message')
      const id = patchIdOf(sb.main, original)
      expect(id).toMatch(/^[0-9a-f]{40}$/)

      git(sb.main, 'commit', '-q', '--amend', '-m', 'reworded')
      const amended = git(sb.main, 'rev-parse', 'HEAD')
      expect(amended).not.toBe(original)
      expect(patchIdOf(sb.main, amended)).toBe(id)

      git(sb.main, 'checkout', '-q', 'main')
      write('other.ts', 'export const o = 1\n')
      commit('main moved on')
      git(sb.main, 'checkout', '-q', 'feature')
      git(sb.main, 'rebase', '-q', 'main')
      const rebased = git(sb.main, 'rev-parse', 'HEAD')
      expect(rebased).not.toBe(amended)
      expect(patchIdOf(sb.main, rebased)).toBe(id)
    })

    it('changes when the amend changes the diff', () => {
      write('a.ts', 'export const a = 1\n')
      const first = commit('a')
      write('a.ts', 'export const a = 2\n')
      git(sb.main, 'add', '-A')
      git(sb.main, 'commit', '-q', '--amend', '-m', 'a')
      const amended = git(sb.main, 'rev-parse', 'HEAD')
      expect(patchIdOf(sb.main, amended)).not.toBe(patchIdOf(sb.main, first))
    })
  })

  describe('offline queue', () => {
    it('queues under the git dir when Lumo is unreachable, and the next run flushes it', async () => {
      write('a.ts', `export const awsKey = "${key}"\n`)
      const a = commit('a')
      const down = fakeApi('network')
      const first = await run({ commit: a, log: true, json: true }, down.fetch)
      expect(first.result).toBe(0)
      expect(JSON.parse(first.out).log).toMatchObject({ sent: 0, queued: 1 })
      expect(JSON.parse(first.out).log.note).toContain('could not reach Lumo')
      expect(queue().map(r => r.commitSha)).toEqual([a])
      const file = queueFile(sb.main)!
      expect(file).toBe(
        path.join(
          fs.realpathSync(sb.main),
          '.git',
          'lumo',
          'scan-log-queue.json'
        )
      )
      expect(fs.readFileSync(file, 'utf8')).not.toContain(key)

      write('b.ts', 'export const b = 1\n')
      const b = commit('b')
      const up = fakeApi()
      const second = await run({ commit: b, log: true, json: true }, up.fetch)
      expect(up.uploads[0]!.runs.map(r => r.commitSha)).toEqual([a, b])
      expect(JSON.parse(second.out).log).toMatchObject({
        sent: 2,
        flushed: 1,
        queued: 0,
      })
      expect(queue()).toEqual([])
      expect(fs.existsSync(file)).toBe(false)
    })

    it('a server error (5xx) or a rate limit queues; --offline queues without a call', async () => {
      write('a.ts', 'export const a = 1\n')
      const a = commit('a')
      for (const status of [503, 429]) {
        const api = fakeApi(status)
        await run({ commit: a, log: true }, api.fetch)
        expect(queue().map(r => r.commitSha)).toEqual([a])
      }
      const api = fakeApi()
      const { out } = await run(
        { commit: a, log: true, offline: true, json: true },
        api.fetch
      )
      expect(api.fetch).not.toHaveBeenCalled()
      expect(JSON.parse(out).log.note).toContain('--offline')
      // The same run is queued once, not once per attempt.
      expect(queue()).toHaveLength(1)
    })

    it('logging off for the workspace drops the queue instead of retrying forever', async () => {
      write('a.ts', 'export const a = 1\n')
      const a = commit('a')
      await run({ commit: a, log: true }, fakeApi('network').fetch)
      expect(queue()).toHaveLength(1)
      const off = fakeApi(403, {
        error: 'Local scan logging is off',
        code: 'LOCAL_SCAN_LOG_OFF',
      })
      const { result, out } = await run(
        { commit: a, log: true, json: true },
        off.fetch
      )
      expect(result).toBe(0)
      expect(JSON.parse(out).log.note).toContain(
        'local scan logging is off for this workspace'
      )
      expect(queue()).toEqual([])
    })

    it('a repository the workspace does not have (404) is dropped, not queued', async () => {
      write('a.ts', 'export const a = 1\n')
      const a = commit('a')
      await run({ commit: a, log: true }, fakeApi(404).fetch)
      expect(queue()).toEqual([])
    })
  })

  it('--fail-on still decides the exit code; the upload never does', async () => {
    write('a.ts', `export const awsKey = "${key}"\n`)
    const a = commit('a')
    const { result } = await run(
      { commit: a, log: true, failOn: 'high' },
      fakeApi(500).fetch
    )
    expect(result).toBe(EXIT_FAIL_ON)
    const ok = await run({ commit: a, log: true }, fakeApi(500).fetch)
    expect(ok.result).toBe(0)
  })

  it('--commit without --log scans one commit and sends nothing', async () => {
    write('a.ts', `export const awsKey = "${key}"\n`)
    const a = commit('a')
    write('b.ts', `export const k = "${key}"\n`)
    commit('b')
    const api = fakeApi()
    const { out } = await run({ commit: a, json: true }, api.fetch)
    const json = JSON.parse(out)
    expect(json.findings.map((f: { filePath: string }) => f.filePath)).toEqual([
      'a.ts',
    ])
    expect(json.scope).toBe(`commit ${a.slice(0, 7)}`)
    expect(json.log).toBeNull()
    expect(
      api.fetch.mock.calls.some(c => String(c[0]).includes(LOCAL_RUNS_PATH))
    ).toBe(false)
  })

  describe('usage errors (exit 2)', () => {
    it.each([
      [{ log: true, staged: true }, 'staged changes have no sha yet'],
      [{ log: true }, 'pass --commit <ref>, or --until'],
      [{ log: true, commit: 'HEAD', pr: true }, '--log cannot run with --pr'],
      [{ commit: 'HEAD', since: 'HEAD~1' }, '--commit scans one commit'],
      [{ commit: 'HEAD', staged: true }, '--commit scans one commit'],
      [{ log: true, commit: 'HEAD', hook: 'pre-rebase' }, 'invalid --hook'],
      [{ commit: 'HEAD', hook: 'post-commit' }, '--hook needs --log'],
    ])('%j', async (opts, message) => {
      expect(commitModeError(opts)).toContain(message)
      const { result, err } = await run(opts, fakeApi().fetch)
      expect(result).toBe(EXIT_USAGE)
      expect(err).toContain(message)
    })
  })

  it('caps the findings sent per run at 200, most severe first, and counts them all', () => {
    const findings = Array.from({ length: 250 }, (_, i) => ({
      kind: 'SECRET' as const,
      ruleId: 'r',
      severity: (i === 249 ? 'HIGH' : 'LOW') as 'HIGH' | 'LOW',
      title: 't',
      filePath: 'f.ts',
      line: i + 1,
      evidence: 'redacted',
      fingerprint: 'abcdef0123456789',
      detail: '',
      scanner: 'SECRETS' as const,
    }))
    const payload = buildRunPayload({
      repo: 'acme/app',
      facts: { sha: 'a'.repeat(40), parentSha: null, patchId: null },
      branch: null,
      trigger: 'MANUAL',
      scanners: ['SECRETS'],
      cliVersion: '1.2.3',
      filesScanned: 1,
      scannedAt: new Date(0),
      findings: findings as never,
    })
    expect(payload.findingCount).toBe(250)
    expect(payload.findings).toHaveLength(200)
    expect(payload.findings[0]!.severity).toBe('HIGH')
    expect(JSON.stringify(payload)).not.toContain('evidence')
  })
})
