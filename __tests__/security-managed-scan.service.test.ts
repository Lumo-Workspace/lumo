/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  createRepoSandbox: jest.fn(),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn(),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
}))

import { logger } from '@/lib/logger'
import { createRepoSandbox } from '@/lib/integrations/vercel-sandbox'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import {
  securityManagedScanService,
  isManagedScanEnabled,
  scrubToken,
  GITLEAKS_URL,
  SEMGREP_VERSION,
  SANDBOX_TIMEOUT_MS,
  SANDBOX_VCPUS,
  SANDBOX_IMAGE,
  MANAGED_REPORT_MAX_BYTES,
  OSV_SCANNER_URL,
  BASELINE_MAX_FINGERPRINTS,
} from '@/lib/services/security-managed-scan.service'
import { dependencyFingerprint } from '@/lib/security-scan/redact'

const TOKEN = 'ghs_INSTALLATIONTOKEN123456'
const KEY = 'AKIAABCDEFGHIJKLMNOP'
const PR = { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 }
const JOB = { scanId: 's1', pr: PR, headSha: 'a'.repeat(40) }
const DIFF = [
  '--- a/src/db.ts',
  '+++ b/src/db.ts',
  '@@ -1,0 +1,2 @@',
  '+const a = 1',
  `+const k = "${KEY}"`,
].join('\n')

const gitleaksSarif = {
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: 'gitleaks',
          rules: [
            { id: 'aws-access-token', shortDescription: { text: 'AWS key' } },
          ],
        },
      },
      results: [
        {
          ruleId: 'aws-access-token',
          level: 'error',
          message: {
            text: `aws-access-token has detected secret for file src/db.ts: ${KEY}`,
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'src/db.ts' },
                region: {
                  startLine: 2,
                  snippet: { text: `const k = "${KEY}"` },
                },
              },
            },
          ],
        },
      ],
    },
  ],
}
const semgrepSarif = {
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'semgrep', rules: [] } }, results: [] }],
}
/** LUM-738: osv-scanner's SARIF — a lockfile hit that is NOT in the PR diff. */
const osvSarif = {
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: 'osv-scanner',
          rules: [
            {
              id: 'GHSA-35jh-r3h4-6jhm',
              shortDescription: { text: 'GHSA-35jh-r3h4-6jhm: lodash' },
              properties: { 'security-severity': '7.2' },
            },
          ],
        },
      },
      results: [
        {
          ruleId: 'GHSA-35jh-r3h4-6jhm',
          level: 'warning',
          message: {
            text: "Package 'lodash@4.17.15' is vulnerable to 'GHSA-35jh-r3h4-6jhm'.",
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'package-lock.json' },
              },
            },
          ],
          partialFingerprints: { primaryLocationLineHash: 'a'.repeat(64) },
        },
      ],
    },
  ],
}
/** A semgrep hit OUTSIDE the PR diff — dropped by a PR scan, kept by the baseline. */
const semgrepOutsideDiffSarif = {
  version: '2.1.0',
  runs: [
    {
      tool: { driver: { name: 'semgrep', rules: [{ id: 'js.sqli' }] } },
      results: [
        {
          ruleId: 'js.sqli',
          level: 'error',
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'src/old.ts' },
                region: { startLine: 40, snippet: { text: 'raw(q)' } },
              },
            },
          ],
          partialFingerprints: { primaryLocationLineHash: 'semgrep-old-40' },
        },
      ],
    },
  ],
}
const ALL_REPORTS = {
  '/tmp/gitleaks.sarif': JSON.stringify(gitleaksSarif),
  '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
  '/tmp/osv.sarif': JSON.stringify(osvSarif),
}

type Fake = { run: jest.Mock; readFile: jest.Mock; stop: jest.Mock }
function fakeSandbox(
  files: Record<string, string | null>,
  exits: Record<string, number> = {}
): Fake {
  const run = jest.fn(async (_cmd: string, args: string[]) => {
    const script = args.join(' ')
    const tool = script.includes('osv-scanner')
      ? 'osv-scanner'
      : script.includes('gitleaks')
        ? 'gitleaks'
        : 'semgrep'
    return { exitCode: exits[tool] ?? 0, stdout: '', stderr: '' }
  })
  const readFile = jest.fn(async (path: string) => {
    const v = files[path]
    return v == null ? null : Buffer.from(v)
  })
  return {
    cwd: '/vercel',
    run,
    readFile,
    stop: jest.fn(async () => undefined),
  } as Fake & { cwd: string }
}

const create = createRepoSandbox as jest.Mock
const token = getGithubInstallationToken as jest.Mock
const diff = fetchPrDiff as jest.Mock

beforeEach(() => {
  jest.resetAllMocks()
  token.mockResolvedValue(TOKEN)
  diff.mockResolvedValue(DIFF)
})

describe('isManagedScanEnabled', () => {
  it('is on by default and off only for the exact value "off"', () => {
    expect(isManagedScanEnabled({})).toBe(true)
    expect(isManagedScanEnabled({ LUMO_MANAGED_SCAN: 'off' })).toBe(false)
    expect(isManagedScanEnabled({ LUMO_MANAGED_SCAN: 'false' })).toBe(true)
  })
})

describe('scanRepository', () => {
  it('creates the sandbox from a depth-1 clone of the head sha with the installation token', async () => {
    create.mockResolvedValue(
      fakeSandbox({
        '/tmp/gitleaks.sarif': JSON.stringify(gitleaksSarif),
        '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
      })
    )
    await securityManagedScanService.scanRepository(JOB)
    expect(token).toHaveBeenCalledWith('w1')
    expect(create).toHaveBeenCalledWith({
      repository: 'o/r',
      revision: JOB.headSha,
      token: TOKEN,
      timeoutMs: SANDBOX_TIMEOUT_MS,
      vcpus: SANDBOX_VCPUS,
      image: SANDBOX_IMAGE,
    })
  })

  it('runs gitleaks then semgrep with the pinned versions and reads both reports', async () => {
    const sb = fakeSandbox({
      '/tmp/gitleaks.sarif': JSON.stringify(gitleaksSarif),
      '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
    })
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanRepository(JOB)
    const scripts = sb.run.mock.calls.map(c => (c[1] as string[]).join(' '))
    const guard = `test "$(git rev-parse HEAD 2>/dev/null | cut -c1-${JOB.headSha.length})" = "${JOB.headSha}" || exit 90; `
    expect(scripts[0]).toContain(guard)
    expect(scripts[0]).toContain(GITLEAKS_URL)
    expect(scripts[0]).toContain(
      'dir . --report-format sarif --report-path /tmp/gitleaks.sarif --exit-code 0'
    )
    // The SDK clones into `<session cwd>/<repo name>`, so every scanner must
    // run there — running in the session cwd is exactly what exited 90 in
    // production on the first dogfood PR.
    for (const call of sb.run.mock.calls) {
      expect(call[2]).toEqual({ cwd: '/vercel/r' })
    }
    expect(scripts[1]).toContain(guard)
    expect(scripts[1]).toContain('pip install --quiet semgrep==')
    expect(scripts[1]).toContain(`semgrep==${SEMGREP_VERSION}`)
    expect(scripts[1]).toContain(
      '--config p/owasp-top-ten --config p/typescript --config p/nodejs --config p/python --sarif --output /tmp/semgrep.sarif --metrics=off'
    )
    expect(sb.readFile).toHaveBeenCalledWith('/tmp/gitleaks.sarif')
    expect(sb.readFile).toHaveBeenCalledWith('/tmp/semgrep.sarif')
    expect(out.gitleaks.kind).toBe('ok')
    expect(out.semgrep.kind).toBe('ok')
    expect(sb.stop).toHaveBeenCalledTimes(1)
  })

  it('keeps only findings on lines the PR added (diff-aware) and tags secrets', async () => {
    create.mockResolvedValue(
      fakeSandbox({
        '/tmp/gitleaks.sarif': JSON.stringify(gitleaksSarif),
        '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
      })
    )
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out.gitleaks).toMatchObject({ kind: 'ok', tool: 'gitleaks' })
    if (out.gitleaks.kind !== 'ok') throw new Error('unreachable')
    expect(out.gitleaks.findings).toHaveLength(1)
    expect(out.gitleaks.findings[0]).toMatchObject({
      kind: 'SECRET',
      filePath: 'src/db.ts',
      line: 2,
    })
  })

  it('RED LINE: the outcome, the logs and the sandbox commands never contain the plaintext key or the installation token', async () => {
    const sb = fakeSandbox({
      '/tmp/gitleaks.sarif': JSON.stringify(gitleaksSarif),
      '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
    })
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out.gitleaks.kind).toBe('ok')
    if (out.gitleaks.kind !== 'ok') throw new Error('unreachable')
    expect(out.gitleaks.findings).toHaveLength(1)
    expect(out.gitleaks.findings[0]).toMatchObject({ kind: 'SECRET' })
    expect(JSON.stringify(out)).not.toContain(KEY)
    expect(JSON.stringify(out)).not.toContain(TOKEN)
    const logged = [logger.info, logger.warn, logger.error]
      .flatMap(l => (l as jest.Mock).mock.calls)
      .map(c => c.join(' '))
      .join('\n')
    expect(logged).not.toContain(KEY)
    expect(logged).not.toContain(TOKEN)
    for (const call of sb.run.mock.calls)
      expect(JSON.stringify(call)).not.toContain(TOKEN)
  })

  it('a scanner exiting with an unexpected code is that tool’s deterministic failure; the other tool still runs', async () => {
    const sb = fakeSandbox(
      {
        '/tmp/gitleaks.sarif': null,
        '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
      },
      { gitleaks: 2 }
    )
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out.gitleaks).toMatchObject({
      kind: 'failed',
      reason: expect.stringContaining('exit 2'),
    })
    expect(out.semgrep.kind).toBe('ok')
    expect(sb.stop).toHaveBeenCalledTimes(1)
  })

  it('the guard exiting 90 (checkout does not match the job head sha) is that tool’s deterministic failure', async () => {
    const sb = fakeSandbox(
      {
        '/tmp/gitleaks.sarif': null,
        '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
      },
      { gitleaks: 90 }
    )
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out.gitleaks).toEqual({
      kind: 'failed',
      reason: 'gitleaks exit 90',
    })
  })

  it('rejects an invalid head sha for both tools without creating a sandbox', async () => {
    const out = await securityManagedScanService.scanRepository({
      ...JOB,
      headSha: 'not-a-sha',
    })
    expect(out.gitleaks).toEqual({ kind: 'failed', reason: 'invalid head sha' })
    expect(out.semgrep).toEqual({ kind: 'failed', reason: 'invalid head sha' })
    expect(out['osv-scanner']).toEqual({
      kind: 'failed',
      reason: 'invalid head sha',
    })
    expect(create).not.toHaveBeenCalled()
    expect(token).not.toHaveBeenCalled()
  })

  it('semgrep exit 1 (findings present) is success; a missing report file is a failure', async () => {
    const sb = fakeSandbox(
      {
        '/tmp/gitleaks.sarif': JSON.stringify(gitleaksSarif),
        '/tmp/semgrep.sarif': null,
      },
      { semgrep: 1 }
    )
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out.semgrep).toMatchObject({
      kind: 'failed',
      reason: 'semgrep produced no report',
    })
  })

  it('a report that is not SARIF 2.1.0 is that tool’s failure, not a throw', async () => {
    create.mockResolvedValue(
      fakeSandbox({
        '/tmp/gitleaks.sarif': '{"version":"2.0.0","runs":[]}',
        '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
      })
    )
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out.gitleaks.kind).toBe('failed')
  })

  it('a report over the size cap is that tool’s failure, without reading its content, and the other tool still succeeds', async () => {
    const oversized = Buffer.alloc(1)
    Object.defineProperty(oversized, 'byteLength', {
      value: MANAGED_REPORT_MAX_BYTES + 1,
    })
    const run = jest.fn(async (_cmd: string, _args: string[]) => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
    }))
    const readFile = jest.fn(async (path: string) => {
      if (path === '/tmp/semgrep.sarif') return oversized
      if (path === '/tmp/gitleaks.sarif')
        return Buffer.from(JSON.stringify(gitleaksSarif))
      return null
    })
    const sb = {
      cwd: '/vercel',
      run,
      readFile,
      stop: jest.fn(async () => undefined),
    }
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out.semgrep).toMatchObject({
      kind: 'failed',
      reason: 'semgrep report exceeds size cap',
    })
    expect(out.gitleaks.kind).toBe('ok')
  })

  it('sandbox creation failure throws (retryable) with the token scrubbed from the message', async () => {
    create.mockRejectedValue(
      new Error(
        `clone failed for https://x-access-token:${TOKEN}@github.com/o/r.git`
      )
    )
    await expect(
      securityManagedScanService.scanRepository(JOB)
    ).rejects.toThrow(/clone failed/)
    await expect(
      securityManagedScanService.scanRepository(JOB)
    ).rejects.not.toThrow(new RegExp(TOKEN))
  })

  it('a diff fetch failure throws (retryable) and still stops the sandbox', async () => {
    const sb = fakeSandbox({
      '/tmp/gitleaks.sarif': JSON.stringify(gitleaksSarif),
      '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
    })
    create.mockResolvedValue(sb)
    diff.mockRejectedValue(new Error(`github 502 for token ${TOKEN}`))
    await expect(
      securityManagedScanService.scanRepository(JOB)
    ).rejects.toThrow(/github 502/)
    await expect(
      securityManagedScanService.scanRepository(JOB)
    ).rejects.not.toThrow(new RegExp(TOKEN))
    expect(sb.stop).toHaveBeenCalledTimes(2)
  })

  it('stop() failing never masks the outcome', async () => {
    const sb = fakeSandbox({
      '/tmp/gitleaks.sarif': JSON.stringify(gitleaksSarif),
      '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
    })
    sb.stop.mockRejectedValue(new Error('already stopped'))
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out.semgrep.kind).toBe('ok')
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('scrubToken', () => {
  it('replaces every occurrence and is a no-op for an empty token', () => {
    expect(scrubToken(`a ${TOKEN} b ${TOKEN}`, TOKEN)).toBe('a *** b ***')
    expect(scrubToken('plain', '')).toBe('plain')
  })
})

// ── LUM-738: osv-scanner (L2 supply chain) + repository baseline ────────────

describe('LUM-738 osv-scanner in the managed sandbox', () => {
  it('runs osv-scanner third from the pinned release binary and its report yields DEPENDENCY findings the diff filter does not touch', async () => {
    const sb = fakeSandbox(ALL_REPORTS)
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanRepository(JOB)
    const scripts = sb.run.mock.calls.map(c => (c[1] as string[]).join(' '))
    expect(scripts).toHaveLength(3)
    expect(scripts[2]).toContain(OSV_SCANNER_URL)
    expect(scripts[2]).toContain(
      'scan source -r . --format sarif --output-file /tmp/osv.sarif'
    )
    expect(sb.run.mock.calls[2]![2]).toEqual({ cwd: '/vercel/r' })
    expect(sb.readFile).toHaveBeenCalledWith('/tmp/osv.sarif')
    // package-lock.json is not in DIFF — a diff-aware row would be dropped.
    expect(out['osv-scanner']).toMatchObject({
      kind: 'ok',
      tool: 'osv-scanner',
      dropped: { notInDiff: 0 },
    })
    if (out['osv-scanner'].kind !== 'ok') throw new Error('unreachable')
    expect(out['osv-scanner'].findings).toEqual([
      expect.objectContaining({
        kind: 'DEPENDENCY',
        ruleId: 'ext:osv-scanner:GHSA-35jh-r3h4-6jhm',
        severity: 'HIGH',
        filePath: 'package-lock.json',
        line: null,
        fingerprint: dependencyFingerprint(
          'npm',
          'lodash',
          '4.17.15',
          'GHSA-35jh-r3h4-6jhm'
        ),
      }),
    ])
    expect(out.gitleaks.kind).toBe('ok')
    expect(out.semgrep.kind).toBe('ok')
  })

  it('exit 1 (vulnerabilities found) is success', async () => {
    create.mockResolvedValue(fakeSandbox(ALL_REPORTS, { 'osv-scanner': 1 }))
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out['osv-scanner'].kind).toBe('ok')
  })

  it('exit 128 (no package sources) is a skipped value — not a failure — and the other tools are unaffected', async () => {
    const sb = fakeSandbox(
      { ...ALL_REPORTS, '/tmp/osv.sarif': null },
      { 'osv-scanner': 128 }
    )
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out['osv-scanner']).toEqual({
      kind: 'skipped',
      reason: 'osv-scanner found no package sources',
    })
    expect(sb.readFile).not.toHaveBeenCalledWith('/tmp/osv.sarif')
    expect(out.gitleaks.kind).toBe('ok')
    expect(out.semgrep.kind).toBe('ok')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('any other exit (129 API failed, 127 generic, 90 sha guard) is that tool’s deterministic failure', async () => {
    for (const code of [129, 127, 90]) {
      jest.clearAllMocks()
      token.mockResolvedValue(TOKEN)
      diff.mockResolvedValue(DIFF)
      create.mockResolvedValue(
        fakeSandbox(
          { ...ALL_REPORTS, '/tmp/osv.sarif': null },
          { 'osv-scanner': code }
        )
      )
      const out = await securityManagedScanService.scanRepository(JOB)
      expect(out['osv-scanner']).toEqual({
        kind: 'failed',
        reason: `osv-scanner exit ${code}`,
      })
      expect(out.semgrep.kind).toBe('ok')
    }
  })
})

describe('LUM-738 baseline scan (default branch, whole tree)', () => {
  const BASELINE = { workspaceId: 'w1', repo: 'o/r', sha: 'b'.repeat(40) }

  it('returns the fingerprint union of every tool with no diff filter and never fetches a PR diff', async () => {
    const sb = fakeSandbox({
      ...ALL_REPORTS,
      '/tmp/semgrep.sarif': JSON.stringify(semgrepOutsideDiffSarif),
    })
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanBaseline(BASELINE)
    expect(diff).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ repository: 'o/r', revision: BASELINE.sha })
    )
    expect(out.tools.sort()).toEqual(['gitleaks', 'osv-scanner', 'semgrep'])
    expect(out.failed).toEqual([])
    expect(out.skipped).toEqual([])
    expect(out.partial).toBe(false)
    expect(out.fingerprints).toEqual(
      expect.arrayContaining([
        'semgrep-old-40',
        dependencyFingerprint(
          'npm',
          'lodash',
          '4.17.15',
          'GHSA-35jh-r3h4-6jhm'
        ),
      ])
    )
    expect(out.fingerprints).toHaveLength(3)
    expect(sb.stop).toHaveBeenCalledTimes(1)
  })

  it('lists a failed tool and a skipped tool separately and still keeps the rest', async () => {
    create.mockResolvedValue(
      fakeSandbox(
        { ...ALL_REPORTS, '/tmp/osv.sarif': null, '/tmp/semgrep.sarif': null },
        { 'osv-scanner': 128, semgrep: 2 }
      )
    )
    const out = await securityManagedScanService.scanBaseline(BASELINE)
    expect(out.tools).toEqual(['gitleaks'])
    expect(out.skipped).toEqual(['osv-scanner'])
    expect(out.failed).toEqual(['semgrep exit 2'])
    expect(out.fingerprints).toHaveLength(1)
  })

  it('is partial when a tool exceeds the baseline fingerprint cap', async () => {
    const many = {
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'semgrep', rules: [] } },
          results: Array.from(
            { length: BASELINE_MAX_FINGERPRINTS + 1 },
            (_, i) => ({
              ruleId: 'r',
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: 'a.ts' },
                    region: { startLine: i + 1 },
                  },
                },
              ],
              partialFingerprints: { primaryLocationLineHash: `h${i}` },
            })
          ),
        },
      ],
    }
    create.mockResolvedValue(
      fakeSandbox({
        ...ALL_REPORTS,
        '/tmp/semgrep.sarif': JSON.stringify(many),
      })
    )
    const out = await securityManagedScanService.scanBaseline(BASELINE)
    expect(out.partial).toBe(true)
    expect(out.fingerprints.length).toBe(BASELINE_MAX_FINGERPRINTS + 2)
  })

  it('rejects an invalid sha for every tool without creating a sandbox', async () => {
    const out = await securityManagedScanService.scanBaseline({
      ...BASELINE,
      sha: 'main',
    })
    expect(out.failed).toHaveLength(3)
    expect(create).not.toHaveBeenCalled()
  })

  it('RED LINE: the baseline outcome carries fingerprints only — no key, no token, no finding text', async () => {
    const sb = fakeSandbox(ALL_REPORTS)
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanBaseline(BASELINE)
    const json = JSON.stringify(out)
    expect(json).not.toContain(KEY)
    expect(json).not.toContain(TOKEN)
    expect(json).not.toContain('lodash')
    expect(json).not.toContain('src/db.ts')
  })
})
