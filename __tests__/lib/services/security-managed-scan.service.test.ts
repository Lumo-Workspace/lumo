/** @jest-environment node */
/**
 * LUM-846 — zizmor and `trivy config` in the managed sandbox: pinned and
 * sha256-checked downloads, their exit-code semantics, and that one of them
 * failing never stops the others. The reports read back are the real tool
 * output in `__tests__/fixtures/lum846/`.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  ...jest.requireActual('@/lib/integrations/vercel-sandbox'),
  createRepoSandbox: jest.fn(),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn(),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { findStagesById: jest.fn() },
}))

import { readFileSync } from 'fs'
import { join } from 'path'
import { createRepoSandbox } from '@/lib/integrations/vercel-sandbox'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import {
  securityManagedScanService,
  MANAGED_SCAN_TOOLS,
  TRIVY_SHA256,
  TRIVY_URL,
  ZIZMOR_SHA256,
  ZIZMOR_URL,
} from '@/lib/services/security-managed-scan.service'

const TOKEN = 'ghs_INSTALLATIONTOKEN123456'
const PR = { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 }
const JOB = { scanId: 's1', pr: PR, headSha: 'a'.repeat(40), huntWanted: false }
/** The PR adds the workflow's `run:` step (line 12) and a whole Dockerfile. */
const DIFF = [
  '--- a/.github/workflows/ci.yml',
  '+++ b/.github/workflows/ci.yml',
  '@@ -11,0 +12,1 @@',
  '+      - run: echo "Title ${{ github.event.pull_request.title }}"',
  '--- /dev/null',
  '+++ b/Dockerfile',
  '@@ -0,0 +1,4 @@',
  '+FROM node:latest',
  '+ADD . /app',
  '+RUN npm install',
  '+CMD ["node", "/app/index.js"]',
].join('\n')

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../../fixtures/lum846', name), 'utf8')
const empty = (name: string) =>
  JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name, rules: [] } }, results: [] }],
  })
const REPORTS: Record<string, string | null> = {
  '/tmp/gitleaks.sarif': empty('gitleaks'),
  '/tmp/semgrep.sarif': empty('semgrep'),
  '/tmp/osv.sarif': empty('osv-scanner'),
  '/tmp/zizmor.sarif': fixture('zizmor.sarif'),
  '/tmp/trivy.sarif': fixture('trivy.sarif'),
}

function toolOf(script: string): string {
  for (const t of ['osv-scanner', 'gitleaks', 'zizmor', 'trivy']) {
    if (script.includes(`/tmp/${t}`)) return t
  }
  return 'semgrep'
}

function fakeSandbox(
  files: Record<string, string | null>,
  exits: Record<string, number> = {},
  stderrs: Record<string, string> = {}
) {
  return {
    cwd: '/vercel',
    run: jest.fn(async (...[, args]: [string, string[], unknown?]) => {
      const tool = toolOf(args.join(' '))
      return {
        exitCode: exits[tool] ?? 0,
        stdout: '',
        stderr: stderrs[tool] ?? '',
      }
    }),
    readFile: jest.fn(async (path: string) => {
      const v = files[path]
      return v == null ? null : Buffer.from(v)
    }),
    stop: jest.fn(async () => undefined),
  }
}

const create = createRepoSandbox as jest.Mock

beforeEach(() => {
  jest.resetAllMocks()
  ;(getGithubInstallationToken as jest.Mock).mockResolvedValue(TOKEN)
  ;(fetchPrDiff as jest.Mock).mockResolvedValue(DIFF)
  ;(prSecurityScanRepository.findStagesById as jest.Mock).mockResolvedValue({
    external: 'PENDING',
    supplyChain: 'PENDING',
  })
})

describe('LUM-846 zizmor and trivy in the managed sandbox', () => {
  it('LUM-846 runs zizmor then trivy after the existing three tools, from pinned sha256-checked release tarballs', async () => {
    const sb = fakeSandbox(REPORTS)
    create.mockResolvedValue(sb)
    await securityManagedScanService.scanRepository(JOB)
    expect(MANAGED_SCAN_TOOLS).toEqual([
      'gitleaks',
      'semgrep',
      'osv-scanner',
      'zizmor',
      'trivy',
    ])
    const scripts = sb.run.mock.calls.map(c => (c[1] as string[]).join(' '))
    expect(scripts).toHaveLength(5)
    const guard = `test "$(git rev-parse HEAD 2>/dev/null | cut -c1-40)" = "${JOB.headSha}" || exit 90; `
    const [zizmor, trivy] = [scripts[3]!, scripts[4]!]

    expect(zizmor.startsWith(`-c ${guard}`)).toBe(true)
    expect(zizmor).toContain(`curl -sSL -o /tmp/zizmor.tgz "${ZIZMOR_URL}"`)
    expect(zizmor).toContain(
      `echo "${ZIZMOR_SHA256}  /tmp/zizmor.tgz" | sha256sum -c --quiet -`
    )
    expect(zizmor.indexOf('sha256sum')).toBeLessThan(zizmor.indexOf('tar -xzf'))
    expect(zizmor).toContain(
      '/tmp/zizmor --offline --format sarif . > /tmp/zizmor.sarif'
    )
    expect(zizmor).toContain('set -e')

    expect(trivy.startsWith(`-c ${guard}`)).toBe(true)
    expect(trivy).toContain(`curl -sSL -o /tmp/trivy.tgz "${TRIVY_URL}"`)
    expect(trivy).toContain(
      `echo "${TRIVY_SHA256}  /tmp/trivy.tgz" | sha256sum -c --quiet -`
    )
    expect(trivy.indexOf('sha256sum')).toBeLessThan(trivy.indexOf('tar -xzf'))
    expect(trivy).toContain(
      '/tmp/trivy config --severity MEDIUM,HIGH,CRITICAL --exit-code 0 --format sarif --output /tmp/trivy.sarif .'
    )
    for (const call of sb.run.mock.calls) {
      expect(call[2]).toEqual({ cwd: '/vercel/r' })
    }
    expect(ZIZMOR_URL).toMatch(
      /\/v1\.30\.1\/zizmor-x86_64-unknown-linux-gnu\.tar\.gz$/
    )
    expect(TRIVY_URL).toMatch(
      /\/v0\.74\.0\/trivy_0\.74\.0_Linux-64bit\.tar\.gz$/
    )
  })

  it('LUM-846 real reports come back as findings on the lines the PR added only', async () => {
    create.mockResolvedValue(fakeSandbox(REPORTS))
    const out = await securityManagedScanService.scanRepository(JOB)
    if (out.zizmor.kind !== 'ok' || out.trivy.kind !== 'ok') {
      throw new Error(`not ok: ${JSON.stringify([out.zizmor, out.trivy])}`)
    }
    expect(out.zizmor.tool).toBe('zizmor')
    expect(out.zizmor.findings.map(f => f.ruleId)).toEqual([
      'ext:zizmor:zizmor/template-injection',
    ])
    expect(out.trivy.tool).toBe('trivy')
    expect(out.trivy.findings.map(f => f.ruleId).sort()).toEqual([
      'ext:trivy:DS-0001',
      'ext:trivy:DS-0002',
    ])
    // deploy/pod.yaml is not in this PR's diff.
    expect(out.trivy.dropped.notInDiff).toBe(13)
  })

  it('LUM-846 zizmor exit 3 means no workflows to audit and is skipped, not failed, with the other tools untouched', async () => {
    const sb = fakeSandbox(
      { ...REPORTS, '/tmp/zizmor.sarif': '' },
      { zizmor: 3 }
    )
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out.zizmor).toEqual({
      kind: 'skipped',
      reason: 'zizmor found no GitHub Actions workflows or actions',
    })
    expect(sb.readFile).not.toHaveBeenCalledWith('/tmp/zizmor.sarif')
    for (const t of ['gitleaks', 'semgrep', 'osv-scanner', 'trivy'] as const) {
      expect(out[t].kind).toBe('ok')
    }
  })

  it('LUM-846 zizmor findings exits 11 to 14 with a report are success', async () => {
    for (const code of [11, 12, 13, 14]) {
      create.mockResolvedValue(fakeSandbox(REPORTS, { zizmor: code }))
      const out = await securityManagedScanService.scanRepository(JOB)
      expect(out.zizmor.kind).toBe('ok')
    }
  })

  it('LUM-846 a failing zizmor is a failed value carrying its stderr and every other tool still runs', async () => {
    const sb = fakeSandbox(
      REPORTS,
      { zizmor: 1 },
      {
        zizmor: `/tmp/zizmor.tgz: FAILED\nsha256sum: WARNING: 1 computed checksum did NOT match ${TOKEN}`,
      }
    )
    create.mockResolvedValue(sb)
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out.zizmor.kind).toBe('failed')
    if (out.zizmor.kind !== 'failed') throw new Error('unreachable')
    expect(out.zizmor.reason).toMatch(/^zizmor exit 1: .*did NOT match/)
    expect(out.zizmor.reason).not.toContain(TOKEN)
    expect(sb.run).toHaveBeenCalledTimes(5)
    for (const t of ['gitleaks', 'semgrep', 'osv-scanner', 'trivy'] as const) {
      expect(out[t].kind).toBe('ok')
    }
  })

  it('LUM-846 trivy has no findings exit — any non-zero is a failure, even with a report present', async () => {
    for (const code of [1, 2]) {
      create.mockResolvedValue(fakeSandbox(REPORTS, { trivy: code }))
      const out = await securityManagedScanService.scanRepository(JOB)
      expect(out.trivy).toMatchObject({
        kind: 'failed',
        reason: `trivy exit ${code}`,
      })
      expect(out.zizmor.kind).toBe('ok')
    }
  })

  it('LUM-846 the sha guard exit 90 fails zizmor too rather than skipping it', async () => {
    create.mockResolvedValue(fakeSandbox(REPORTS, { zizmor: 90 }))
    const out = await securityManagedScanService.scanRepository(JOB)
    expect(out.zizmor).toMatchObject({
      kind: 'failed',
      reason: 'zizmor exit 90',
    })
  })

  it('LUM-846 the baseline lists a skipped zizmor and keeps trivy fingerprints for the whole tree', async () => {
    create.mockResolvedValue(
      fakeSandbox({ ...REPORTS, '/tmp/zizmor.sarif': '' }, { zizmor: 3 })
    )
    const out = await securityManagedScanService.scanBaseline({
      workspaceId: 'w1',
      repo: 'o/r',
      sha: 'b'.repeat(40),
    })
    expect(out.skipped).toEqual(['zizmor'])
    expect(out.failed).toEqual([])
    expect(out.tools).toContain('trivy')
    // 15 trivy hits (two containers each keep their own fingerprint).
    expect(out.fingerprints).toHaveLength(15)
  })
})
