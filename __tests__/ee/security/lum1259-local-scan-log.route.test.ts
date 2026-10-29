/**
 * @jest-environment node
 *
 * LUM-1259: POST /api/workspaces/me/security-scan/local-runs through the real
 * service and validator — refused (403 LOCAL_SCAN_LOG_OFF) until the
 * workspace opts in, a repository of another workspace is a 404, identical
 * reruns are duplicates, titles are redacted again and nothing beyond the
 * declared fields (an evidence line, a commit message) is stored, a session
 * counts only when it is the caller's, and the per-member rate limit.
 */
jest.mock('@/lib/auth/identity', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: { findLocalScanLogEnabled: jest.fn() },
}))
jest.mock('@/ee/security/repositories/local-scan-log.repository', () => ({
  localScanLogRepository: {
    findLinkedRepo: jest.fn(),
    findExistingRuns: jest.fn(),
    create: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findForMemberWithBinding: jest.fn() },
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { localScanLogRepository } from '@/ee/security/repositories/local-scan-log.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import {
  __resetLocalScanLogRateLimitForTests,
  LOCAL_SCAN_LOG_RATE_LIMIT,
  resultKeyOf,
} from '@/ee/security/services/local-scan-log.service'
import { POST } from '@/app/api/workspaces/me/security-scan/local-runs/route'
import { fakeAwsKeyId, fakeGithubToken } from '@/cli/test-support/fake-secrets'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const URL_ = 'http://localhost/api/workspaces/me/security-scan/local-runs'
const SHA = 'a'.repeat(40)
const PARENT = 'b'.repeat(40)
const PATCH = 'c'.repeat(40)

function run(over: Record<string, unknown> = {}) {
  return {
    repo: 'acme/app',
    commitSha: SHA,
    parentSha: PARENT,
    patchId: PATCH,
    branch: 'feature',
    sessionId: null,
    actor: 'USER',
    trigger: 'POST_COMMIT',
    scanners: ['SECRETS'],
    scannerVersion: 'secrets@1',
    cliVersion: '1.127.0',
    filesScanned: 2,
    findingCount: 1,
    scannedAt: '2026-10-19T12:00:00.000Z',
    findings: [
      {
        scanner: 'SECRETS',
        fingerprint: '0123456789abcdef',
        ruleId: 'secret:aws-access-key-id',
        severity: 'HIGH',
        filePath: 'config.ts',
        line: 3,
        title: 'AWS access key ID',
        label: 'NEW',
      },
    ],
    ...over,
  }
}

function req(body: unknown) {
  return new NextRequest(URL_, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

beforeEach(() => {
  jest.clearAllMocks()
  __resetLocalScanLogRateLimitForTests()
  m(requireIdentity).mockResolvedValue({
    clerkId: 'u_1',
    memberId: 'm_1',
    workspaceId: 'ws_1',
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    source: 'bearer',
  })
  m(securityColumnsRepository.findLocalScanLogEnabled).mockResolvedValue(true)
  m(localScanLogRepository.findLinkedRepo).mockResolvedValue('Acme/App')
  m(localScanLogRepository.findExistingRuns).mockResolvedValue([])
  m(localScanLogRepository.create).mockResolvedValue({ id: 'run_1' })
  m(sessionRepository.findForMemberWithBinding).mockResolvedValue(null)
})

describe('POST /api/workspaces/me/security-scan/local-runs', () => {
  it('records a run in the caller workspace under the stored repo spelling', async () => {
    const res = await POST(req({ version: 1, runs: [run()] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      version: 1,
      results: [{ commitSha: SHA, status: 'created' }],
    })
    expect(localScanLogRepository.findLinkedRepo).toHaveBeenCalledWith(
      'ws_1',
      'acme/app'
    )
    const row = m(localScanLogRepository.create).mock.calls[0][0]
    expect(row).toMatchObject({
      workspaceId: 'ws_1',
      repo: 'Acme/App',
      commitSha: SHA,
      parentSha: PARENT,
      patchId: PATCH,
      branch: 'feature',
      memberId: 'm_1',
      actor: 'USER',
      trigger: 'POST_COMMIT',
      sessionId: null,
      taskId: null,
      findingCount: 1,
    })
    expect(row.scannedAt).toEqual(new Date('2026-10-19T12:00:00.000Z'))
    expect(row.findings).toEqual([
      {
        scanner: 'SECRETS',
        fingerprint: '0123456789abcdef',
        ruleId: 'secret:aws-access-key-id',
        severity: 'HIGH',
        filePath: 'config.ts',
        line: 3,
        title: 'AWS access key ID',
        label: 'NEW',
      },
    ])
  })

  it('refuses with 403 LOCAL_SCAN_LOG_OFF while the workspace has not opted in', async () => {
    m(securityColumnsRepository.findLocalScanLogEnabled).mockResolvedValue(
      false
    )
    const res = await POST(req({ version: 1, runs: [run()] }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('LOCAL_SCAN_LOG_OFF')
    expect(body.error).toContain('--local-scan-log on')
    expect(localScanLogRepository.create).not.toHaveBeenCalled()
    expect(localScanLogRepository.findLinkedRepo).not.toHaveBeenCalled()
  })

  it('refuses a repository the workspace does not have (another workspace’s) with 404', async () => {
    m(localScanLogRepository.findLinkedRepo).mockResolvedValue(null)
    const res = await POST(
      req({ version: 1, runs: [run({ repo: 'other/secret-repo' })] })
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('not linked to this workspace')
    expect(localScanLogRepository.create).not.toHaveBeenCalled()
  })

  it('answers an identical rerun as a duplicate without writing', async () => {
    await POST(req({ version: 1, runs: [run()] }))
    const { resultKey } = m(localScanLogRepository.create).mock.calls[0][0]
    jest.clearAllMocks()
    m(localScanLogRepository.findExistingRuns).mockResolvedValue([
      // Same commit and result under another repo: not this run.
      { repo: 'Acme/Other', commitSha: SHA, resultKey },
      { repo: 'Acme/App', commitSha: SHA, resultKey },
    ])
    const res = await POST(
      req({ version: 1, runs: [run({ trigger: 'PRE_PUSH' })] })
    )
    expect(await res.json()).toEqual({
      version: 1,
      results: [{ commitSha: SHA, status: 'duplicate' }],
    })
    expect(localScanLogRepository.create).not.toHaveBeenCalled()
  })

  it('checks every run of an upload for an earlier copy in one read, and a run repeated within it is a duplicate', async () => {
    const other = 'b'.repeat(40)
    const res = await POST(
      req({
        version: 1,
        runs: [run(), run({ commitSha: other }), run({ trigger: 'PRE_PUSH' })],
      })
    )
    expect(localScanLogRepository.findExistingRuns).toHaveBeenCalledTimes(1)
    const [workspaceId, asked] = m(localScanLogRepository.findExistingRuns).mock
      .calls[0]
    expect(workspaceId).toBe('ws_1')
    expect(asked.map((r: { commitSha: string }) => r.commitSha)).toEqual([
      SHA,
      other,
      SHA,
    ])
    expect((await res.json()).results).toEqual([
      { commitSha: SHA, status: 'created' },
      { commitSha: other, status: 'created' },
      { commitSha: SHA, status: 'duplicate' },
    ])
    expect(localScanLogRepository.create).toHaveBeenCalledTimes(2)
  })

  it('a create that loses the race on the unique key is a duplicate too', async () => {
    m(localScanLogRepository.create).mockResolvedValue(null)
    const res = await POST(req({ version: 1, runs: [run()] }))
    expect((await res.json()).results[0].status).toBe('duplicate')
  })

  it('dedupes on the result: same findings → same key; trigger and time do not count', () => {
    const findings = run().findings.map(f => ({
      ...f,
      severity: 'HIGH' as const,
      label: 'NEW' as const,
      scanner: 'SECRETS' as const,
    }))
    const base = {
      scanners: ['SECRETS' as const],
      scannerVersion: 'secrets@1',
      findingCount: 1,
    }
    const k = resultKeyOf(base, findings)
    expect(resultKeyOf(base, [...findings].reverse())).toBe(k)
    expect(resultKeyOf(base, [{ ...findings[0]!, line: 4 }])).not.toBe(k)
    expect(resultKeyOf(base, [{ ...findings[0]!, label: null }])).not.toBe(k)
    expect(resultKeyOf({ ...base, findingCount: 0 }, [])).not.toBe(k)
  })

  it('redacts a credential in a title again, and drops evidence and a commit message', async () => {
    const key = fakeAwsKeyId()
    const token = fakeGithubToken()
    const finding = {
      ...run().findings[0],
      title: `AWS key ${key} leaked`,
      evidence: `export const awsKey = "${key}"`,
    }
    const res = await POST(
      req({
        version: 1,
        runs: [
          run({
            findings: [finding],
            message: `add ${token}`,
            evidence: key,
          }),
        ],
      })
    )
    expect(res.status).toBe(200)
    const row = m(localScanLogRepository.create).mock.calls[0][0]
    const stored = JSON.stringify(row)
    expect(stored).not.toContain(key)
    expect(stored).not.toContain(token)
    expect(row).not.toHaveProperty('message')
    expect(row).not.toHaveProperty('evidence')
    expect(row.findings[0]).not.toHaveProperty('evidence')
    expect(row.findings[0].title).toContain('AWS key')
  })

  it('records the session and its task only when the session is the caller’s', async () => {
    m(sessionRepository.findForMemberWithBinding).mockImplementation(
      async (id: string, member: string) =>
        id === 'sess-mine' && member === 'm_1'
          ? { id: 'sess-mine', task: { id: 'task_1' } }
          : null
    )
    await POST(
      req({
        version: 1,
        runs: [
          run({ sessionId: 'sess-mine', actor: 'AGENT' }),
          run({ sessionId: 'sess-someone-else', commitSha: 'd'.repeat(40) }),
        ],
      })
    )
    const [mine, other] = m(localScanLogRepository.create).mock.calls.map(
      c => c[0]
    )
    expect(mine).toMatchObject({
      sessionId: 'sess-mine',
      taskId: 'task_1',
      actor: 'AGENT',
    })
    expect(other).toMatchObject({ sessionId: null, taskId: null })
  })

  it.each([
    ['a short sha', { commitSha: 'abc123' }],
    ['an unknown scanner', { scanners: ['SEMGREP'] }],
    ['a finding count below the findings sent', { findingCount: 0 }],
    ['a multi-line branch', { branch: 'a\nb' }],
  ])('rejects %s with 400', async (_label, over) => {
    const res = await POST(req({ version: 1, runs: [run(over)] }))
    expect(res.status).toBe(400)
    expect(localScanLogRepository.create).not.toHaveBeenCalled()
  })

  it('rejects more than 50 runs per call, and an unknown version', async () => {
    const runs = Array.from({ length: 51 }, () => run())
    expect((await POST(req({ version: 1, runs }))).status).toBe(400)
    expect((await POST(req({ version: 2, runs: [run()] }))).status).toBe(400)
  })

  it(`rate-limits each member at ${LOCAL_SCAN_LOG_RATE_LIMIT.max} calls a minute`, async () => {
    for (let i = 0; i < LOCAL_SCAN_LOG_RATE_LIMIT.max; i++)
      expect((await POST(req({ version: 1, runs: [run()] }))).status).toBe(200)
    expect((await POST(req({ version: 1, runs: [run()] }))).status).toBe(429)
  })

  it('refuses a body over 1 MiB by the bytes read, not only by Content-Length', async () => {
    const big = JSON.stringify({
      version: 1,
      runs: [run()],
      pad: 'x'.repeat(1024 * 1024 + 1),
    })
    const res = await POST(new NextRequest(URL_, { method: 'POST', body: big }))
    expect(res.status).toBe(413)
    expect(localScanLogRepository.create).not.toHaveBeenCalled()
  })

  it('passes an auth failure through untouched', async () => {
    const { NextResponse } = await import('next/server')
    m(requireIdentity).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    expect((await POST(req({ version: 1, runs: [run()] }))).status).toBe(401)
  })
})
