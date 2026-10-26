/**
 * @jest-environment node
 */
/**
 * LUM-1258 — the `lumo security scan` flags the scan hooks run with, on a
 * real checkout with the Lumo API faked:
 * - `--fail-on done` exits 3 only on a finding the workspace policy would
 *   block DONE on (a HIGH under the default policy), not on a LOW, and never
 *   without server context (it says so instead);
 * - `--until <ref>` ends the diff at a commit (the commits a push sends), so
 *   uncommitted and untracked files are not read;
 * - `--timeout <seconds>` bounds the wait for the server, then the cache;
 * - the usage errors (exit 2).
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  parseTimeoutSeconds,
  securityScanCommand,
} from '../../cli/src/commands/security-scan'
import { EXIT_USAGE } from '../../cli/src/lib/exit-codes'
import type { Credentials } from '../../cli/src/lib/config'
import { EXIT_FAIL_ON, parseFailOn } from '../../cli/src/lib/local-scan-report'
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
import { scanDeps } from '../../cli/src/lib/deps-scan'
import { resolveScanBase } from '../../cli/src/lib/local-diff'
import {
  fakeOsv,
  LODASH_VULN,
  MAL_VULN,
  npmLock,
} from '../../cli/test-support/osv-fixtures'

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

/** The default policy: deterministic HIGH blocks DONE. */
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

const api = () =>
  jest.fn(
    async () =>
      new Response(JSON.stringify(context), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"e1"' },
      })
  )

describe('lumo security scan flags for the scan hooks', () => {
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
    fetch: jest.Mock = api(),
    readCredentials: () => Credentials | null = () => creds
  ) =>
    inDir(sb.main, () =>
      captureOutput(() =>
        securityScanCommand(opts, {
          fetch: fetch as unknown as typeof globalThis.fetch,
          readCredentials,
          cacheDir,
        })
      )
    )

  describe('--fail-on done', () => {
    it('exits 3 on a HIGH the policy would block DONE on', async () => {
      write('config.ts', `export const awsKey = "${key}"\n`)
      git(sb.main, 'add', 'config.ts')
      const { result, out } = await run({ staged: true, failOn: 'done' })
      expect(result).toBe(EXIT_FAIL_ON)
      expect(out).toContain('scan: 1 finding (1 high, 0 medium, 0 low)')
      expect(out).toContain('1 would block DONE')
      expect(out).not.toContain(key)
    })

    it('exits 0 on a LOW (a key under a test path) — a warning, not a block', async () => {
      write('__tests__/fixture.ts', `export const awsKey = "${key}"\n`)
      git(sb.main, 'add', '__tests__/fixture.ts')
      const { result, out } = await run({ staged: true, failOn: 'done' })
      expect(result).toBe(0)
      expect(out).toContain('scan: 1 finding (0 high, 0 medium, 1 low)')
      expect(out).toContain('0 would block DONE')
      // The same LOW does meet a severity threshold: `done` is not `low`.
      expect((await run({ staged: true, failOn: 'low' })).result).toBe(
        EXIT_FAIL_ON
      )
    })

    it('never exits 3 without server context, and says why on stderr', async () => {
      write('config.ts', `export const awsKey = "${key}"\n`)
      git(sb.main, 'add', 'config.ts')
      const { result, out, err } = await run(
        { staged: true, failOn: 'DONE' },
        api(),
        () => null
      )
      expect(result).toBe(0)
      expect(out).toContain('Server: no context — not logged in')
      expect(err).toContain(
        '--fail-on done: no server context, so no finding can be judged'
      )
    })

    it('parses case-insensitively next to the severities', () => {
      expect(parseFailOn('Done')).toBe('DONE')
      expect(parseFailOn('high')).toBe('HIGH')
      expect(parseFailOn('critical')).toBeNull()
    })
  })

  describe('--until', () => {
    it('scans only the commits up to <ref>: not uncommitted or untracked files', async () => {
      write('pushed.ts', `export const awsKey = "${key}"\n`)
      const pushed = commit('pushed')
      write('later.ts', `export const k = "${key}"\n`)
      commit('later')
      write('untracked.ts', `export const k = "${key}"\n`)
      const { result, out } = await run({
        json: true,
        until: pushed,
        failOn: 'done',
      })
      expect(result).toBe(EXIT_FAIL_ON)
      const json = JSON.parse(out)
      expect(
        json.findings.map((f: { filePath: string }) => f.filePath)
      ).toEqual(['pushed.ts'])
      // A full sha (what git hands a pre-push hook) is shortened in the scope.
      expect(json.scope).toMatch(
        new RegExp(
          `^origin/main \\(merge-base [0-9a-f]{7,}\\) → ${pushed.slice(0, 7)}`
        )
      )
    })

    it('with --since covers exactly <since> → <until>', async () => {
      write('a.ts', `export const awsKey = "${key}"\n`)
      const first = commit('a')
      write('b.ts', `export const k = "${key}"\n`)
      const second = commit('b')
      const { out } = await run({ json: true, since: first, until: second })
      const json = JSON.parse(out)
      expect(
        json.findings.map((f: { filePath: string }) => f.filePath)
      ).toEqual(['b.ts'])
      expect(json.filesScanned).toBe(1)
    })

    it('fails (exit 1) on an unknown ref', async () => {
      const { result, err } = await inDir(sb.main, () =>
        captureOutput(async () => {
          try {
            return await securityScanCommand(
              { until: 'no-such-ref' },
              { readCredentials: () => null, cacheDir }
            )
          } catch (e) {
            console.error((e as Error).message)
            return 1
          }
        })
      )
      expect(result).toBe(1)
      expect(err).toContain('Unknown ref "no-such-ref"')
      expect(err).toContain('--until')
    })
  })

  describe('--timeout', () => {
    it('gives up on a slow server after the budget and uses the cache', async () => {
      write('config.ts', `export const awsKey = "${key}"\n`)
      git(sb.main, 'add', 'config.ts')
      await run({ staged: true }) // fills the cache
      const hanging = jest.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(init.signal!.reason)
            )
          })
      )
      const started = Date.now()
      const { result, out } = await run(
        { staged: true, failOn: 'done', timeout: '0.2' },
        hanging as unknown as jest.Mock
      )
      expect(Date.now() - started).toBeLessThan(5000)
      expect(result).toBe(EXIT_FAIL_ON)
      expect(out).toMatch(/Server: acme\/app · could not reach Lumo .* cached/)
    })

    it('parses seconds in (0, 60], rounding up to whole ms', () => {
      expect(parseTimeoutSeconds('2')).toBe(2000)
      expect(parseTimeoutSeconds('0.5')).toBe(500)
      // Rounded up: a tiny budget still waits, never aborts at 0 ms.
      expect(parseTimeoutSeconds('0.0001')).toBe(1)
      expect(parseTimeoutSeconds('0')).toBeNull()
      expect(parseTimeoutSeconds('61')).toBeNull()
      expect(parseTimeoutSeconds('2s')).toBeNull()
    })
  })

  it.each([
    [{ staged: true, until: 'HEAD' }, '--until ends a commit range'],
    [{ offline: true, timeout: '2' }, '--offline makes no call'],
    [{ timeout: 'soon' }, 'invalid --timeout "soon"'],
    [{ failOn: 'blocking' }, 'allowed: low, medium, high, done'],
  ])('usage error (exit 2): %p', async (opts, message) => {
    const { result, err } = await run(opts)
    expect(result).toBe(EXIT_USAGE)
    expect(err).toContain(message)
  })
})

/**
 * After LUM-1257 the hooks also run `DEPS` (no scanner flag = every local
 * scanner): `--until` must read the lockfile of that commit, and
 * `--timeout` must bound the api.osv.dev lookup too.
 */
describe('DEPS under the hook flags', () => {
  let restore: () => void
  let sb: Sandbox
  const NOW = new Date('2026-10-19T00:00:00Z')
  const osvApi = () =>
    fakeOsv(
      {
        'lodash@4.17.15': ['GHSA-35jh-r3h4-6jhm'],
        'evil-pkg@1.0.0': ['MAL-2024-1234'],
      },
      [LODASH_VULN, MAL_VULN]
    )
  const writeLock = (pkgs: Record<string, string>): void =>
    fs.writeFileSync(path.join(sb.main, 'package-lock.json'), npmLock(pkgs))

  beforeAll(() => {
    restore = isolateGitEnv()
  })
  afterAll(() => restore())
  beforeEach(() => {
    sb = makeSandbox('main')
    writeLock({ lodash: '4.17.21' })
    git(sb.main, 'add', '.')
    git(sb.main, 'commit', '-q', '-m', 'lock')
    git(sb.main, 'push', '-q', 'origin', 'main')
    git(sb.main, 'checkout', '-q', '-b', 'feature')
  })
  afterEach(() => sb.cleanup())

  it('--until reads the lockfile of that commit, not the working tree', async () => {
    writeLock({ lodash: '4.17.15' })
    git(sb.main, 'commit', '-q', '-am', 'downgrade lodash')
    const pushed = git(sb.main, 'rev-parse', 'HEAD')
    // An uncommitted edit after the commit: not part of what is pushed.
    writeLock({ lodash: '4.17.15', 'evil-pkg': '1.0.0' })
    const osv = osvApi()
    const r = await scanDeps(
      resolveScanBase({ kind: 'default', until: pushed }, sb.main),
      { full: false, offline: false, fetchImpl: osv.fetch, now: NOW }
    )
    expect(osv.calls[0]?.body).toEqual({
      queries: [
        { package: { ecosystem: 'npm', name: 'lodash' }, version: '4.17.15' },
      ],
    })
    expect(r.findings.map(f => f.ruleId)).toEqual([
      'ext:osv-scanner:GHSA-35jh-r3h4-6jhm',
    ])
  })

  it('--timeout bounds the whole api.osv.dev lookup: past it DEPS is incomplete', async () => {
    writeLock({ lodash: '4.17.15' })
    const hanging = ((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal!.reason)
        )
      })) as unknown as typeof fetch
    const started = Date.now()
    const r = await scanDeps(resolveScanBase({ kind: 'default' }, sb.main), {
      full: false,
      offline: false,
      fetchImpl: hanging,
      now: NOW,
      timeoutMs: 200,
    })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(r.incomplete).toMatch(/did not answer within --timeout/)
    expect(r.findings).toEqual([])
  })
})
