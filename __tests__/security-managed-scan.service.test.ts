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
} from '@/lib/services/security-managed-scan.service'

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

type Fake = { run: jest.Mock; readFile: jest.Mock; stop: jest.Mock }
function fakeSandbox(
  files: Record<string, string | null>,
  exits: Record<string, number> = {}
): Fake {
  const run = jest.fn(async (_cmd: string, args: string[]) => {
    const script = args.join(' ')
    const tool = script.includes('gitleaks') ? 'gitleaks' : 'semgrep'
    return { exitCode: exits[tool] ?? 0, stdout: '', stderr: '' }
  })
  const readFile = jest.fn(async (path: string) => {
    const v = files[path]
    return v == null ? null : Buffer.from(v)
  })
  return { run, readFile, stop: jest.fn(async () => undefined) }
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
    expect(create).not.toHaveBeenCalled()
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
    const sb = { run, readFile, stop: jest.fn(async () => undefined) }
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
