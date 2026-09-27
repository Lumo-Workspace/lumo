/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  // LUM-746: `repoCheckoutDir` (pure) now lives in the integration module.
  ...jest.requireActual('@/lib/integrations/vercel-sandbox'),
  createRepoSandbox: jest.fn(),
  // LUM-852: egress policy calls go to the platform; not under test here.
  restrictSandboxEgress: jest.fn(),
  denySandboxEgress: jest.fn(),
}))
// LUM-852: the credential proof has its own tests (sandbox-agent, lum852).
jest.mock('@/lib/services/sandbox-credential-scrub', () => ({
  scrubSandboxCredentials: jest.fn(),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoCloneToken: jest.fn(),
  revokeInstallationToken: jest.fn(),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
}))
// LUM-745: the sandbox step's entry guard reads the row's stages.
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { findStagesById: jest.fn() },
}))

import { logger } from '@/lib/logger'
import { createRepoSandbox } from '@/lib/integrations/vercel-sandbox'
import {
  getRepoCloneToken,
  revokeInstallationToken,
} from '@/lib/integrations/github/auth'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import {
  securityManagedScanService,
  isManagedScanEnabled,
  scrubToken,
  GITLEAKS_URL,
  SEMGREP_VERSION,
  SANDBOX_TIMEOUT_MS,
  SANDBOX_TIMEOUT_WITH_HUNT_MS,
  SANDBOX_VCPUS,
  SANDBOX_IMAGE,
  MANAGED_REPORT_MAX_BYTES,
  OSV_SCANNER_URL,
  BASELINE_MAX_FINGERPRINTS,
  SANDBOX_SCAN_TAG,
  SUPERSEDED_REASON,
  managedScanHourlyCap,
  MANAGED_SCAN_HOURLY_CAP_DEFAULT,
  MANAGED_SCAN_TOOLS,
} from '@/lib/services/security-managed-scan.service'
import { dependencyFingerprint } from '@/lib/security-scan/redact'

const TOKEN = 'ghs_INSTALLATIONTOKEN123456'
const KEY = 'AKIAABCDEFGHIJKLMNOP'
const PR = { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 }
const JOB = {
  scanId: 's1',
  pr: PR,
  headSha: 'a'.repeat(40),
  huntWanted: false,
}
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
/** LUM-846: clean zizmor / trivy reports so the pre-846 fixtures keep their meaning. */
const emptySarif = (name: string) =>
  JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name, rules: [] } }, results: [] }],
  })
const ALL_REPORTS = {
  '/tmp/gitleaks.sarif': JSON.stringify(gitleaksSarif),
  '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
  '/tmp/osv.sarif': JSON.stringify(osvSarif),
  '/tmp/zizmor.sarif': emptySarif('zizmor'),
  '/tmp/trivy.sarif': emptySarif('Trivy'),
  // LUM-851: trivy's JSON rides next to its SARIF.
  '/tmp/trivy.json': JSON.stringify({ Results: [] }),
}

type Fake = { run: jest.Mock; readFile: jest.Mock; stop: jest.Mock }
type RunOpts = { cwd?: string }
/** LUM-852: only the scanner calls — installs run from /tmp. */
const scanCalls = (run: jest.Mock) =>
  run.mock.calls.filter(c => (c[2] as RunOpts | undefined)?.cwd !== '/tmp')
function fakeSandbox(
  files: Record<string, string | null>,
  exits: Record<string, number> = {},
  stderrs: Record<string, string> = {}
): Fake {
  const run = jest.fn(async (_cmd: string, args: string[], opts?: RunOpts) => {
    // LUM-852: phase-1 installs (and the hunt marker) run from /tmp and are
    // not what `exits` / `stderrs` describe.
    if (opts?.cwd === '/tmp') return { exitCode: 0, stdout: '', stderr: '' }
    const script = args.join(' ')
    const tool = script.includes('osv-scanner')
      ? 'osv-scanner'
      : script.includes('gitleaks')
        ? 'gitleaks'
        : script.includes('/tmp/zizmor')
          ? 'zizmor'
          : script.includes('/tmp/trivy')
            ? 'trivy'
            : 'semgrep'
    return {
      exitCode: exits[tool] ?? 0,
      stdout: '',
      stderr: stderrs[tool] ?? '',
    }
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
const token = getRepoCloneToken as jest.Mock
const diff = fetchPrDiff as jest.Mock
const stagesById = prSecurityScanRepository.findStagesById as jest.Mock

beforeEach(() => {
  jest.resetAllMocks()
  // LUM-869: a failed revoke is fail-closed; these suites test what follows a good one.
  ;(revokeInstallationToken as jest.Mock).mockResolvedValue(true)
  token.mockResolvedValue(TOKEN)
  diff.mockResolvedValue(DIFF)
  stagesById.mockResolvedValue({ external: 'PENDING', supplyChain: 'PENDING' })
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
    expect(token).toHaveBeenCalledWith('w1', 'o/r')
    expect(create).toHaveBeenCalledWith({
      repository: 'o/r',
      revision: JOB.headSha,
      token: TOKEN,
      timeoutMs: SANDBOX_TIMEOUT_MS,
      vcpus: SANDBOX_VCPUS,
      image: SANDBOX_IMAGE,
      tags: { [SANDBOX_SCAN_TAG]: 's1' },
    })
  })

  describe('LUM-758: the VM is shared with the hunt when huntWanted', () => {
    const reports = {
      '/tmp/gitleaks.sarif': JSON.stringify(gitleaksSarif),
      '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
    }

    it('leaves the VM running and gives it the longer timeout', async () => {
      const sb = fakeSandbox(reports)
      create.mockResolvedValue(sb)

      await securityManagedScanService.scanRepository({
        ...JOB,
        huntWanted: true,
      })

      expect(create.mock.calls[0][0].timeoutMs).toBe(
        SANDBOX_TIMEOUT_WITH_HUNT_MS
      )
      // Deliberate: the hunt attaches to this VM by tag. Stopping it here
      // would kill the hunt's checkout, and having the hunt stop it would
      // kill semgrep — the two workflows have no ordering guarantee. Release
      // is left to the VM timeout, the 15-minute sweep and supersede-by-tag.
      expect(sb.stop).not.toHaveBeenCalled()
    })

    it('still stops the VM (and uses the short timeout) when no hunt is coming', async () => {
      const sb = fakeSandbox(reports)
      create.mockResolvedValue(sb)

      await securityManagedScanService.scanRepository(JOB)

      expect(create.mock.calls[0][0].timeoutMs).toBe(SANDBOX_TIMEOUT_MS)
      expect(sb.stop).toHaveBeenCalledTimes(1)
    })

    it('stops the VM when a tool blows up mid-run, even with a hunt coming', async () => {
      // LUM-852: a crashed run hands nothing to the hunt (no completion
      // marker), so there is nothing to keep the VM alive for — it used to
      // run out its 35 minutes here.
      const sb = fakeSandbox(reports)
      sb.run.mockRejectedValue(new Error('sandbox exploded'))
      create.mockResolvedValue(sb)

      await expect(
        securityManagedScanService.scanRepository({
          ...JOB,
          huntWanted: true,
        })
      ).rejects.toThrow('sandbox exploded')
      expect(sb.stop).toHaveBeenCalledTimes(1)
    })

    it('never keeps a baseline scan VM alive — it has no hunt', async () => {
      const sb = fakeSandbox(reports)
      create.mockResolvedValue(sb)

      await securityManagedScanService.scanBaseline({
        workspaceId: 'w1',
        repo: 'o/r',
        sha: 'c'.repeat(40),
      })

      expect(sb.stop).toHaveBeenCalledTimes(1)
    })
  })

  it('runs gitleaks then semgrep with the pinned versions and reads both reports', async () => {
    const sb = fakeSandbox({
      '/tmp/gitleaks.sarif': JSON.stringify(gitleaksSarif),
      '/tmp/semgrep.sarif': JSON.stringify(semgrepSarif),
    })
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanRepository(JOB)
    const scripts = scanCalls(sb.run).map(c => (c[1] as string[]).join(' '))
    // LUM-852: the downloads are phase 1 (cwd /tmp), before the scrub.
    const installs = sb.run.mock.calls
      .filter(c => (c[2] as RunOpts | undefined)?.cwd === '/tmp')
      .map(c => (c[1] as string[]).join(' '))
    const guard = `test "$(git rev-parse HEAD 2>/dev/null | cut -c1-${JOB.headSha.length})" = "${JOB.headSha}" || exit 90; `
    expect(scripts[0]).toContain(guard)
    expect(installs[0]).toContain(GITLEAKS_URL)
    expect(scripts[0]).toContain(
      'dir . --report-format sarif --report-path /tmp/gitleaks.sarif --exit-code 0'
    )
    // The SDK clones into `<session cwd>/<repo name>`, so every scanner must
    // run there — running in the session cwd is exactly what exited 90 in
    // production on the first dogfood PR.
    for (const call of scanCalls(sb.run)) {
      expect(call[2]).toEqual({ cwd: '/vercel/r' })
    }
    expect(scripts[1]).toContain(guard)
    expect(installs[1]).toContain('pip install --quiet semgrep==')
    expect(installs[1]).toContain(`semgrep==${SEMGREP_VERSION}`)
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

  it('LUM-745: a row already SUPERSEDED boots no sandbox and reports every tool skipped:superseded', async () => {
    stagesById.mockResolvedValue({ external: 'SUPERSEDED' })
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(stagesById).toHaveBeenCalledWith('s1')
    expect(token).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(diff).not.toHaveBeenCalled()
    for (const tool of ['gitleaks', 'semgrep', 'osv-scanner'] as const) {
      expect(out[tool]).toEqual({ kind: 'skipped', reason: SUPERSEDED_REASON })
    }
  })

  it('LUM-745: a missing row (deleted PR) also boots no sandbox', async () => {
    stagesById.mockResolvedValue(null)
    await securityManagedScanService.scanRepository(JOB)
    expect(create).not.toHaveBeenCalled()
  })

  it('LUM-745: a supersede that lands while the sandbox runs discards the result — no diff fetch, every tool skipped:superseded', async () => {
    const sandbox = fakeSandbox(ALL_REPORTS)
    create.mockResolvedValue(sandbox)
    stagesById
      .mockResolvedValueOnce({ external: 'PENDING', supplyChain: 'PENDING' })
      .mockResolvedValueOnce({
        external: 'SUPERSEDED',
        supplyChain: 'SUPERSEDED',
      })
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(create).toHaveBeenCalledTimes(1)
    expect(sandbox.stop).toHaveBeenCalled()
    expect(diff).not.toHaveBeenCalled()
    for (const tool of ['gitleaks', 'semgrep', 'osv-scanner'] as const) {
      expect(out[tool]).toEqual({ kind: 'skipped', reason: SUPERSEDED_REASON })
    }
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
    const scripts = scanCalls(sb.run).map(c => (c[1] as string[]).join(' '))
    expect(scripts).toHaveLength(5)
    expect(JSON.stringify(sb.run.mock.calls)).toContain(OSV_SCANNER_URL)
    expect(scripts[2]).toContain(
      'scan source -r . --format sarif --output-file /tmp/osv.sarif'
    )
    expect(scanCalls(sb.run)[2]![2]).toEqual({ cwd: '/vercel/r' })
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

  // LUM-738 follow-up. osv-scanner v2 documents exit codes as BANDS: 1–126 are
  // result-related, 127 general, 128 no packages, 129–255 non-result. We were
  // failing everything outside {0, 1, 128}, so a code from the documented
  // result band was discarded UNREAD — production hit exit 2 and the layer
  // landed FAILED with zero findings while its report sat in /tmp.
  it('an undocumented code inside the result band still uses the report it produced', async () => {
    const sb = fakeSandbox(ALL_REPORTS, { 'osv-scanner': 2 })
    create.mockResolvedValue(sb)

    const out = await securityManagedScanService.scanRepository(JOB)

    expect(out['osv-scanner'].kind).toBe('ok')
    expect(sb.readFile).toHaveBeenCalledWith('/tmp/osv.sarif')
    // Said out loud — an undocumented code recurring deserves attention.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('documented result band')
    )
  })

  it('the band has edges: 126 reads its report, 127 does not', async () => {
    create.mockResolvedValue(fakeSandbox(ALL_REPORTS, { 'osv-scanner': 126 }))
    expect(
      (await securityManagedScanService.scanRepository(JOB))['osv-scanner'].kind
    ).toBe('ok')

    create.mockResolvedValue(fakeSandbox(ALL_REPORTS, { 'osv-scanner': 127 }))
    expect(
      (await securityManagedScanService.scanRepository(JOB))['osv-scanner'].kind
    ).toBe('failed')
  })

  it('a result-band code with no report is still a failure, and now says why', async () => {
    // The exit code alone could not settle this: `set -e` surfaces curl's codes
    // from the same script, and curl's own 2 means "failed to initialize". The
    // number was the entire record; the tool's last words were only ever in a
    // log line.
    const sb = fakeSandbox(
      { ...ALL_REPORTS, '/tmp/osv.sarif': null },
      { 'osv-scanner': 2 },
      { 'osv-scanner': 'failed to resolve api.osv.dev: temporary failure' }
    )
    create.mockResolvedValue(sb)

    const out = await securityManagedScanService.scanRepository(JOB)

    expect(out['osv-scanner']).toEqual({
      kind: 'failed',
      reason: expect.stringContaining('osv-scanner exit 2'),
    })
    expect((out['osv-scanner'] as { reason: string }).reason).toContain(
      'temporary failure'
    )
  })

  it('never puts the installation token in the reason it persists', async () => {
    // This string is rendered to the customer as the scanner's own reason.
    const sb = fakeSandbox(
      { ...ALL_REPORTS, '/tmp/osv.sarif': null },
      { 'osv-scanner': 2 },
      {
        'osv-scanner': `clone failed for https://x-access-token:${TOKEN}@github.com/o/r`,
      }
    )
    create.mockResolvedValue(sb)

    const reason = (
      (await securityManagedScanService.scanRepository(JOB))['osv-scanner'] as {
        reason: string
      }
    ).reason
    expect(reason).not.toContain(TOKEN)
  })

  it('the band belongs to osv-scanner alone — semgrep exit 2 is still a failure', async () => {
    // The band is osv-scanner's documented contract, not a general rule.
    // semgrep exit 2 is an error in semgrep's own scheme; widening this to
    // every tool would swallow that.
    create.mockResolvedValue(fakeSandbox(ALL_REPORTS, { semgrep: 2 }))

    const out = await securityManagedScanService.scanRepository(JOB)

    expect(out.semgrep.kind).toBe('failed')
    expect(out['osv-scanner'].kind).toBe('ok')
  })

  it('bounds the reason it persists — stderr can be a whole build log', async () => {
    const sb = fakeSandbox(
      { ...ALL_REPORTS, '/tmp/osv.sarif': null },
      { 'osv-scanner': 2 },
      { 'osv-scanner': 'x'.repeat(5_000) + ' the actual cause' }
    )
    create.mockResolvedValue(sb)

    const reason = (
      (await securityManagedScanService.scanRepository(JOB))['osv-scanner'] as {
        reason: string
      }
    ).reason
    expect(reason.length).toBeLessThan(300)
    // Kept from the TAIL: that is where a tool puts the thing that went wrong.
    expect(reason).toContain('the actual cause')
  })

  it('the sha guard stays absolute: exit 90 fails even with a report present', async () => {
    // 90 sits inside [1,126]. A guard whose whole job is "this is the wrong
    // tree, report nothing" must not become conditional on whether a report
    // happens to exist — and the old regression test could not see this,
    // because it stubbed the report away.
    create.mockResolvedValue(fakeSandbox(ALL_REPORTS, { 'osv-scanner': 90 }))

    const out = await securityManagedScanService.scanRepository(JOB)

    expect(out['osv-scanner'].kind).toBe('failed')
  })

  it('redacts a secret quoted in a failing tool’s stderr before persisting it', async () => {
    // This string is not a log line: it becomes PrSecurityScan.error and from
    // there the GitHub PR comment, which is emailed to every watcher. gitleaks
    // and semgrep talk ABOUT matched content, so their stderr can quote the
    // very secret the layer exists to find. scrubToken only knows the
    // installation token.
    const sb = fakeSandbox(
      ALL_REPORTS,
      { gitleaks: 3 },
      {
        gitleaks:
          'WRN leak found file=src/db.ts secret=AKIAABCDEFGHIJKLMNOP rule=aws-access-token',
      }
    )
    create.mockResolvedValue(sb)

    const reason = (
      (await securityManagedScanService.scanRepository(JOB)).gitleaks as {
        reason: string
      }
    ).reason
    expect(reason).not.toContain('AKIAABCDEFGHIJKLMNOP')
    expect(reason).toContain('gitleaks exit 3')
  })

  it('carries stderr for every tool, not only osv-scanner', async () => {
    // The detail is in the shared failure branch. Pinning only osv leaves the
    // publishing path for the other two untested — which is how a secret gets
    // out through semgrep instead.
    create.mockResolvedValue(
      fakeSandbox(
        ALL_REPORTS,
        { semgrep: 2 },
        { semgrep: 'rule file parse error at line 9' }
      )
    )
    const out = await securityManagedScanService.scanRepository(JOB)
    expect((out.semgrep as { reason: string }).reason).toContain(
      'rule file parse error at line 9'
    )
  })

  it('does not engage the band on the ordinary success exits', async () => {
    // Without the `!isSuccessExit` conjunct the "documented result band"
    // warning fires on every normal findings run, and exit 1 with no report
    // reports the exit code instead of "produced no report".
    const sb = fakeSandbox(
      { ...ALL_REPORTS, '/tmp/osv.sarif': null },
      { 'osv-scanner': 1 }
    )
    create.mockResolvedValue(sb)

    const out = await securityManagedScanService.scanRepository(JOB)

    expect(out['osv-scanner']).toEqual({
      kind: 'failed',
      reason: 'osv-scanner produced no report',
    })
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('documented result band')
    )
  })

  it('says out loud when a band code produced no report — the shape of the incident', async () => {
    const sb = fakeSandbox(
      { ...ALL_REPORTS, '/tmp/osv.sarif': null },
      { 'osv-scanner': 2 },
      { 'osv-scanner': 'curl: (2) failed to initialize' }
    )
    create.mockResolvedValue(sb)

    await securityManagedScanService.scanRepository(JOB)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('and no report')
    )
  })

  it('the band excludes gitleaks as well as semgrep', async () => {
    // gitleaks' success set is {0}, so widening the band to it would make its
    // exit 1 an "unusual result code" and start reading its report.
    create.mockResolvedValue(fakeSandbox(ALL_REPORTS, { gitleaks: 1 }))
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out.gitleaks.kind).toBe('failed')
  })

  it('trims before budgeting, so trailing blank lines cannot eat the window', async () => {
    const sb = fakeSandbox(
      { ...ALL_REPORTS, '/tmp/osv.sarif': null },
      { 'osv-scanner': 2 },
      // ` \n` pairs, not bare newlines: `/[\r\n]+/g` collapses a RUN of
      // newlines to ONE space, so 300 of them fold to nothing and would not
      // exercise the trim at all. The literal spaces are what survive the
      // flatten and can eat the whole window.
      { 'osv-scanner': 'the real cause is here' + ' \n'.repeat(300) }
    )
    create.mockResolvedValue(sb)

    const reason = (
      (await securityManagedScanService.scanRepository(JOB))['osv-scanner'] as {
        reason: string
      }
    ).reason
    expect(reason).toContain('the real cause is here')
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
    expect(out.tools.sort()).toEqual([
      'gitleaks',
      'osv-scanner',
      'semgrep',
      'trivy',
      'zizmor',
    ])
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
    expect(out.tools).toEqual(['gitleaks', 'zizmor', 'trivy'])
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
    expect(out.failed).toHaveLength(MANAGED_SCAN_TOOLS.length)
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

  it('LUM-745: the baseline run reads no scan row and carries no scan tag', async () => {
    create.mockResolvedValue(fakeSandbox(ALL_REPORTS))
    await securityManagedScanService.scanBaseline(BASELINE)
    expect(stagesById).not.toHaveBeenCalled()
    expect(create.mock.calls[0][0]).not.toHaveProperty('tags')
  })
})

describe('LUM-745 managedScanHourlyCap', () => {
  it('defaults to 20 and accepts a positive integer override only', () => {
    expect(managedScanHourlyCap({})).toBe(MANAGED_SCAN_HOURLY_CAP_DEFAULT)
    expect(managedScanHourlyCap({ LUMO_MANAGED_SCAN_HOURLY_CAP: '5' })).toBe(5)
    expect(managedScanHourlyCap({ LUMO_MANAGED_SCAN_HOURLY_CAP: '0' })).toBe(20)
    expect(managedScanHourlyCap({ LUMO_MANAGED_SCAN_HOURLY_CAP: 'lots' })).toBe(
      20
    )
    expect(managedScanHourlyCap({ LUMO_MANAGED_SCAN_HOURLY_CAP: '2.5' })).toBe(
      20
    )
  })
})
