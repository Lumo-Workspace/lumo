/**
 * @jest-environment node
 */
/**
 * LUM-1257 — `lumo security scan --deps` on real git checkouts: the lockfile
 * delta per scope, the OSV lookups it makes (mocked — no test touches the
 * network), `osv-scanner.toml` ignores and their expiry, API down →
 * incomplete (exit 1, never clean), `--full` / `--offline` through a fake
 * osv-scanner on PATH, and the exit codes.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { dependencyFingerprint } from '@/lib/security-scan/redact'
import { securityScanCommand } from '../../cli/src/commands/security-scan'
import { scanDeps } from '../../cli/src/lib/deps-scan'
import { EXIT_USAGE } from '../../cli/src/lib/exit-codes'
import { resolveScanBase } from '../../cli/src/lib/local-diff'
import { EXIT_FAIL_ON } from '../../cli/src/lib/local-scan-report'
import {
  fetchVulns,
  OsvUnavailableError,
  queryBatch,
} from '../../cli/src/lib/osv-api'
import {
  findOnPath,
  OSV_SCANNER_INSTALL_HINT,
  parseScannerJson,
} from '../../cli/src/lib/osv-scanner-run'
import {
  fakeOsv,
  LODASH_VULN,
  MAL_VULN,
  npmLock,
  unreachableFetch,
} from '../../cli/test-support/osv-fixtures'
import {
  captureOutput,
  git,
  inDir,
  isolateGitEnv,
  makeSandbox,
  type Sandbox,
} from '../../cli/test-support/real-git'

const NOW = new Date('2026-10-19T00:00:00Z')
const LODASH_FP = dependencyFingerprint(
  'npm',
  'lodash',
  '4.17.15',
  'GHSA-35jh-r3h4-6jhm'
)

describe('osv-api', () => {
  it('pages a batch query and returns ids in query order', async () => {
    const seen: unknown[] = []
    const impl = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        queries: { page_token?: string; package: { name: string } }[]
      }
      seen.push(body)
      const results = body.queries.map(q =>
        q.package.name === 'a' && !q.page_token
          ? { vulns: [{ id: 'GHSA-1' }], next_page_token: 't1' }
          : q.package.name === 'a'
            ? { vulns: [{ id: 'GHSA-2' }] }
            : {}
      )
      return new Response(JSON.stringify({ results }), { status: 200 })
    }) as unknown as typeof fetch
    const ids = await queryBatch(
      [
        { ecosystem: 'npm', name: 'a', version: '1.0.0' },
        { ecosystem: 'npm', name: 'b', version: '1.0.0' },
      ],
      impl
    )
    expect(ids).toEqual([['GHSA-1', 'GHSA-2'], []])
    expect(seen).toHaveLength(2)
  })

  it('sends only ecosystem, name and version', async () => {
    const osv = fakeOsv({}, [])
    await queryBatch(
      [{ ecosystem: 'npm', name: 'a', version: '1.0.0' }],
      osv.fetch
    )
    expect(osv.calls[0]?.body).toEqual({
      queries: [{ package: { ecosystem: 'npm', name: 'a' }, version: '1.0.0' }],
    })
  })

  it('turns unreachable, timeout, HTTP errors and bad bodies into OsvUnavailableError', async () => {
    const q = [{ ecosystem: 'npm', name: 'a', version: '1.0.0' }]
    await expect(queryBatch(q, unreachableFetch)).rejects.toThrow(
      /api\.osv\.dev unreachable/
    )
    const timeout = (async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' })
    }) as unknown as typeof fetch
    await expect(queryBatch(q, timeout)).rejects.toThrow(
      /did not answer within 10s/
    )
    const http = (async () =>
      new Response('oops', { status: 503 })) as unknown as typeof fetch
    await expect(queryBatch(q, http)).rejects.toBeInstanceOf(
      OsvUnavailableError
    )
    const short = (async () =>
      new Response(JSON.stringify({ results: [] }))) as unknown as typeof fetch
    await expect(queryBatch(q, short)).rejects.toThrow(/malformed/)
    await expect(fetchVulns(['GHSA-x'], fakeOsv({}, []).fetch)).rejects.toThrow(
      /HTTP 404/
    )
  })

  it('stops fetching records once one fetch fails', async () => {
    const osv = fakeOsv({}, [])
    const ids = Array.from({ length: 40 }, (_, i) => `GHSA-${i}`)
    await expect(fetchVulns(ids, osv.fetch)).rejects.toBeInstanceOf(
      OsvUnavailableError
    )
    // At most one in-flight fetch per worker; the queue is not drained.
    expect(osv.calls.length).toBeLessThanOrEqual(8)
  })
})

describe('parseScannerJson', () => {
  it("keeps osv-scanner's groups, max_severity and repo-relative sources", () => {
    const pkgs = parseScannerJson(
      {
        results: [
          {
            source: { path: '/repo/sub/package-lock.json', type: 'lockfile' },
            packages: [
              {
                package: {
                  name: 'lodash',
                  version: '4.17.15',
                  ecosystem: 'npm',
                },
                vulnerabilities: [LODASH_VULN],
                groups: [
                  {
                    ids: ['GHSA-35jh-r3h4-6jhm'],
                    aliases: ['GHSA-35jh-r3h4-6jhm', 'CVE-2021-23337'],
                    max_severity: '7.2',
                  },
                ],
              },
            ],
          },
        ],
      },
      '/repo'
    )
    expect(pkgs).toEqual([
      {
        filePath: 'sub/package-lock.json',
        ecosystem: 'npm',
        name: 'lodash',
        version: '4.17.15',
        groups: [
          { ids: ['GHSA-35jh-r3h4-6jhm'], maxScore: 7.2, vulns: [LODASH_VULN] },
        ],
      },
    ])
    expect(() => parseScannerJson('nope', '/repo')).toThrow()
  })

  it('findOnPath finds an executable and nothing else', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-path-'))
    try {
      expect(findOnPath('osv-scanner', dir)).toBeNull()
      const bin = path.join(dir, 'osv-scanner')
      fs.writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 })
      expect(findOnPath('osv-scanner', dir)).toBe(bin)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('scanDeps / securityScanCommand on a checkout', () => {
  let restore: () => void
  let sb: Sandbox
  const BASE_LOCK = npmLock({ lodash: '4.17.21', keep: '1.0.0' })
  const HEAD_LOCK = npmLock({
    lodash: '4.17.15',
    keep: '1.0.0',
    'evil-pkg': '1.0.0',
  })
  const osvApi = () =>
    fakeOsv(
      {
        'lodash@4.17.15': ['GHSA-35jh-r3h4-6jhm'],
        'evil-pkg@1.0.0': ['MAL-2024-1234'],
      },
      [LODASH_VULN, MAL_VULN]
    )
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(sb.main, rel)), { recursive: true })
    fs.writeFileSync(path.join(sb.main, rel), text)
  }

  beforeAll(() => {
    restore = isolateGitEnv()
  })
  afterAll(() => restore())

  beforeEach(() => {
    sb = makeSandbox('main')
    write('package-lock.json', BASE_LOCK)
    git(sb.main, 'add', '.')
    git(sb.main, 'commit', '-q', '-m', 'lock')
    git(sb.main, 'push', '-q', 'origin', 'main')
    git(sb.main, 'checkout', '-q', '-b', 'feature')
  })
  afterEach(() => sb.cleanup())

  const fast = (fetchImpl: typeof fetch, now = NOW) =>
    scanDeps(resolveScanBase({ kind: 'default' }, sb.main), {
      full: false,
      offline: false,
      fetchImpl,
      now,
    })

  it('looks up only the added / re-versioned packages and reports them with server fingerprints', async () => {
    write('package-lock.json', HEAD_LOCK)
    const osv = osvApi()
    const r = await fast(osv.fetch)
    expect(osv.calls[0]?.body).toEqual({
      queries: [
        { package: { ecosystem: 'npm', name: 'evil-pkg' }, version: '1.0.0' },
        { package: { ecosystem: 'npm', name: 'lodash' }, version: '4.17.15' },
      ],
    })
    expect(r).toMatchObject({
      mode: 'fast',
      source: 'api.osv.dev',
      lockfiles: ['package-lock.json'],
      packagesChecked: 2,
      incomplete: null,
      notCovered: [],
    })
    expect(
      r.findings.map(f => [f.ruleId, f.severity, f.malicious, f.fixedVersion])
    ).toEqual([
      ['ext:osv-scanner:MAL-2024-1234', 'HIGH', true, null],
      ['ext:osv-scanner:GHSA-35jh-r3h4-6jhm', 'HIGH', false, '4.17.21'],
    ])
    expect(r.findings[1]?.fingerprint).toBe(LODASH_FP)
  })

  it('makes no lookup when no lockfile changed', async () => {
    const osv = osvApi()
    const r = await fast(osv.fetch)
    expect(osv.calls).toHaveLength(0)
    expect(r.packagesChecked).toBe(0)
    expect(r.findings).toEqual([])
  })

  it('reads a new untracked lockfile and a nested one, and flags non-npm lockfiles as not covered', async () => {
    write('web/package-lock.json', npmLock({ lodash: '4.17.15' }))
    write('yarn.lock', '# yarn\n')
    const r = await fast(osvApi().fetch)
    expect(r.lockfiles).toEqual(['web/package-lock.json'])
    expect(r.notCovered).toEqual(['yarn.lock'])
    expect(r.findings.map(f => f.filePath)).toEqual(['web/package-lock.json'])
  })

  it('--staged compares HEAD with the index', async () => {
    write('package-lock.json', HEAD_LOCK)
    const staged = () =>
      scanDeps(resolveScanBase({ kind: 'staged' }, sb.main), {
        full: false,
        offline: false,
        fetchImpl: osvApi().fetch,
        now: NOW,
      })
    expect((await staged()).packagesChecked).toBe(0)
    git(sb.main, 'add', 'package-lock.json')
    expect((await staged()).packagesChecked).toBe(2)
  })

  it('honours osv-scanner.toml next to the lockfile until ignoreUntil, then reports the advisory again', async () => {
    write('package-lock.json', HEAD_LOCK)
    write(
      'osv-scanner.toml',
      '[[IgnoredVulns]]\nid = "CVE-2021-23337" # alias of the GHSA\nignoreUntil = 2027-01-05\nreason = """\nno fix\n"""\n'
    )
    const before = await fast(osvApi().fetch)
    expect(before.findings.map(f => f.osvId)).toEqual(['MAL-2024-1234'])
    expect(before.ignored).toEqual([
      {
        osvId: 'GHSA-35jh-r3h4-6jhm',
        package: 'lodash',
        version: '4.17.15',
        until: '2027-01-05',
      },
    ])
    const after = await fast(osvApi().fetch, new Date('2027-01-06T00:00:00Z'))
    expect(after.ignored).toEqual([])
    expect(
      after.findings.find(f => f.package === 'lodash')?.ignoreExpired
    ).toBe('2027-01-05')
  })

  it('API unreachable → incomplete, no findings claimed', async () => {
    write('package-lock.json', HEAD_LOCK)
    const r = await fast(unreachableFetch)
    expect(r.findings).toEqual([])
    expect(r.incomplete).toMatch(
      /api\.osv\.dev unreachable.*unknown, not clean/
    )
  })

  it('a lockfile that is not JSON (a merge conflict) is incomplete, not clean', async () => {
    write('package-lock.json', '<<<<<<< HEAD\n')
    const r = await fast(osvApi().fetch)
    expect(r.incomplete).toMatch(
      /not valid JSON, not checked: package-lock\.json/
    )
  })

  const run = (
    opts: Parameters<typeof securityScanCommand>[0],
    seams: Parameters<typeof securityScanCommand>[1]
  ) =>
    inDir(sb.main, () => captureOutput(() => securityScanCommand(opts, seams)))

  it('prints DEPS findings, calls out MAL-* and the fix, and exits 3 at --fail-on', async () => {
    write('package-lock.json', HEAD_LOCK)
    const { result, out } = await run(
      { deps: true, failOn: 'high' },
      { osvFetch: osvApi().fetch, now: () => NOW }
    )
    expect(result).toBe(EXIT_FAIL_ON)
    const lines = out.split('\n')
    expect(lines[0]).toBe('scan: 2 findings (2 high, 0 medium, 0 low)')
    expect(lines[1]).toMatch(
      /^Scope: DEPS · origin\/main \(merge-base \w+\) → working tree · \d+ms$/
    )
    expect(out).toContain(
      'Deps: 2 added or changed packages in package-lock.json checked against api.osv.dev'
    )
    expect(out).toContain(
      'MALICIOUS: evil-pkg@1.0.0 (MAL-2024-1234) — known-malicious; remove before you install or push'
    )
    expect(out).toContain('Fix:       upgrade to 4.17.21 or later')
    expect(out).toContain(
      'Advisory:  https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm'
    )
  })

  it('API down → exit 1 and "incomplete" on line 1, even with no findings; --json says complete: false', async () => {
    write('package-lock.json', HEAD_LOCK)
    const human = await run(
      { deps: true },
      { osvFetch: unreachableFetch, now: () => NOW }
    )
    expect(human.result).toBe(1)
    expect(human.out.split('\n')[0]).toBe(
      'scan: 0 findings (0 high, 0 medium, 0 low) · incomplete: DEPS'
    )
    expect(human.out).toContain('Incomplete: DEPS — api.osv.dev unreachable')
    const json = await run(
      { deps: true, json: true },
      { osvFetch: unreachableFetch, now: () => NOW }
    )
    expect(json.result).toBe(1)
    expect(JSON.parse(json.out)).toMatchObject({
      scanners: ['DEPS'],
      complete: false,
      incomplete: [{ scanner: 'DEPS' }],
      findings: [],
    })
  })

  it('--json carries the dependency block and the server fingerprint', async () => {
    write('package-lock.json', HEAD_LOCK)
    const { result, out } = await run(
      { deps: true, json: true },
      { osvFetch: osvApi().fetch, now: () => NOW }
    )
    expect(result).toBe(0)
    const json = JSON.parse(out)
    expect(json).toMatchObject({
      complete: true,
      deps: { mode: 'fast', source: 'api.osv.dev', packagesChecked: 2 },
    })
    expect(json.findings[0]).toMatchObject({
      scanner: 'DEPS',
      kind: 'DEPENDENCY',
      ruleId: 'ext:osv-scanner:GHSA-35jh-r3h4-6jhm',
      line: null,
      evidence: null,
      fingerprint: LODASH_FP,
      dependency: {
        ecosystem: 'npm',
        name: 'lodash',
        version: '4.17.15',
        fixedVersion: '4.17.21',
        malicious: false,
      },
    })
  })

  it('--full with --secrets only is a usage error; --offline is not (it also covers the server context)', async () => {
    const { result, err } = await run({ secrets: true, full: true }, {})
    expect(result).toBe(EXIT_USAGE)
    expect(err).toMatch(/--full applies to --deps/)
    const offline = await run({ secrets: true, offline: true }, {})
    expect(offline.result).toBe(0)
  })

  describe('osv-scanner (fake binary on PATH)', () => {
    const report = {
      results: [
        {
          source: { path: '', type: 'lockfile' },
          packages: [
            {
              package: { name: 'lodash', version: '4.17.15', ecosystem: 'npm' },
              vulnerabilities: [LODASH_VULN],
              groups: [{ ids: ['GHSA-35jh-r3h4-6jhm'], max_severity: '7.2' }],
            },
            {
              package: { name: 'keep', version: '1.0.0', ecosystem: 'npm' },
              vulnerabilities: [{ id: 'GHSA-old', summary: 'old debt' }],
              groups: [{ ids: ['GHSA-old'], max_severity: '5.0' }],
            },
          ],
        },
      ],
    }
    let bin: string
    let argsFile: string

    beforeEach(() => {
      const lock = path.join(sb.main, 'package-lock.json')
      report.results[0]!.source.path = lock
      const reportFile = path.join(sb.tmp, 'report.json')
      fs.writeFileSync(reportFile, JSON.stringify(report))
      argsFile = path.join(sb.tmp, 'args.txt')
      bin = path.join(sb.tmp, 'osv-scanner')
      fs.writeFileSync(
        bin,
        `#!/bin/sh\necho "$@" > "${argsFile}"\ncat "${reportFile}"\nexit 1\n`,
        { mode: 0o755 }
      )
      write('package-lock.json', HEAD_LOCK)
    })

    it('--full runs `scan source -r . --format json` and reports the whole tree', async () => {
      const r = await scanDeps(resolveScanBase({ kind: 'default' }, sb.main), {
        full: true,
        offline: false,
        scannerBin: bin,
        now: NOW,
      })
      expect(fs.readFileSync(argsFile, 'utf8').trim()).toBe(
        'scan source --format json -r .'
      )
      expect(r).toMatchObject({
        mode: 'full',
        source: 'osv-scanner',
        packagesChecked: null,
      })
      expect(r.findings.map(f => [f.osvId, f.severity, f.fingerprint])).toEqual(
        [
          ['GHSA-35jh-r3h4-6jhm', 'HIGH', LODASH_FP],
          [
            'GHSA-old',
            'MEDIUM',
            dependencyFingerprint('npm', 'keep', '1.0.0', 'GHSA-old'),
          ],
        ]
      )
    })

    it('--offline in fast mode runs osv-scanner offline on the changed lockfile and keeps only changed packages', async () => {
      const r = await scanDeps(resolveScanBase({ kind: 'default' }, sb.main), {
        full: false,
        offline: true,
        scannerBin: bin,
        fetchImpl: unreachableFetch,
        now: NOW,
      })
      expect(fs.readFileSync(argsFile, 'utf8').trim()).toBe(
        'scan source --format json --offline --lockfile package-lock.json'
      )
      expect(r.source).toBe('osv-scanner (offline)')
      expect(r.incomplete).toBeNull()
      // `keep@1.0.0` is unchanged since the merge-base: not this change's.
      expect(r.findings.map(f => f.osvId)).toEqual(['GHSA-35jh-r3h4-6jhm'])
    })

    it('missing binary → exit 1 with install instructions, nothing downloaded', async () => {
      const empty = fs.mkdtempSync(path.join(sb.tmp, 'empty-'))
      // Resolved first: git itself must stay on PATH.
      const base = resolveScanBase({ kind: 'default' }, sb.main)
      const saved = process.env.PATH
      process.env.PATH = empty
      try {
        await expect(
          scanDeps(base, {
            full: true,
            offline: false,
            now: NOW,
          })
        ).rejects.toThrow(OSV_SCANNER_INSTALL_HINT)
      } finally {
        process.env.PATH = saved
      }
      expect(OSV_SCANNER_INSTALL_HINT).toMatch(/brew install osv-scanner/)
      expect(OSV_SCANNER_INSTALL_HINT).toMatch(/never downloads it/)
    })

    it('--offline in fast mode without osv-scanner → DEPS incomplete, not a crash, not clean', async () => {
      const empty = fs.mkdtempSync(path.join(sb.tmp, 'empty-'))
      const base = resolveScanBase({ kind: 'default' }, sb.main)
      const saved = process.env.PATH
      process.env.PATH = empty
      try {
        const r = await scanDeps(base, { full: false, offline: true, now: NOW })
        expect(r.findings).toEqual([])
        expect(r.incomplete).toMatch(
          /^--offline: osv-scanner is not on PATH.*unknown, not clean$/
        )
      } finally {
        process.env.PATH = saved
      }
    })
  })
})
