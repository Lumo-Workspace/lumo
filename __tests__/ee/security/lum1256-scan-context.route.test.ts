/**
 * @jest-environment node
 *
 * LUM-1256: GET /api/workspaces/me/security-scan/context through the real
 * service — pinned to the caller's workspace (a repository of another
 * workspace, or one not linked, is a JSON 404), Zod at the edge, ETag /
 * 304, the per-member rate limit, and a body of ids and statuses only.
 */
jest.mock('@/lib/auth/identity', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityBaseline: jest.fn(),
    findLearningsScope: jest.fn(),
    findSecurityPolicy: jest.fn(),
  },
}))
jest.mock(
  '@/ee/security/repositories/security-scan-context.repository',
  () => ({
    securityScanContextRepository: {
      findRulingRows: jest.fn(),
      findOpenPullRequestByBranch: jest.fn(),
    },
  })
)
jest.mock('@/ee/security/repositories/pr-review-learning.repository', () => ({
  prReviewLearningRepository: { findActiveKeys: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { labelsByIds: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findStatesByIds: jest.fn() },
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { securityScanContextRepository } from '@/ee/security/repositories/security-scan-context.repository'
import { prReviewLearningRepository } from '@/ee/security/repositories/pr-review-learning.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { __resetScanContextRateLimitForTests } from '@/ee/security/services/security-scan-context.service'
import { GET } from '@/app/api/workspaces/me/security-scan/context/route'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const BASE = 'http://localhost/api/workspaces/me/security-scan/context'

function req(query: string, headers: Record<string, string> = {}) {
  return new NextRequest(`${BASE}${query}`, { headers })
}

beforeAll(() => {
  // The in-memory limiter warns once that no KV is configured.
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

beforeEach(() => {
  jest.clearAllMocks()
  __resetScanContextRateLimitForTests()
  m(requireIdentity).mockResolvedValue({
    clerkId: 'u_1',
    memberId: 'm_1',
    workspaceId: 'ws_1',
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    source: 'bearer',
  })
  m(securityColumnsRepository.findSecurityBaseline).mockResolvedValue({
    sha: 'abc123',
    at: '2026-10-18T10:00:00.000Z',
    requestedAt: '2026-10-18T09:55:00.000Z',
    fingerprints: ['fp-main-2', 'fp-main-1'],
    partial: false,
    tools: ['osv'],
  })
  m(securityColumnsRepository.findLearningsScope).mockResolvedValue('local')
  m(securityColumnsRepository.findSecurityPolicy).mockResolvedValue(null)
  m(securityScanContextRepository.findRulingRows).mockResolvedValue([
    {
      fingerprint: 'fp-ruled',
      ruleId: 'secret:aws-access-key-id',
      disposition: 'FALSE_POSITIVE',
      dispositionedById: 'm_alice',
      dispositionedAt: new Date('2026-10-17T08:00:00Z'),
      pullRequestNumber: 12,
    },
  ])
  m(
    securityScanContextRepository.findOpenPullRequestByBranch
  ).mockResolvedValue({ id: 'pr_12', number: 12, headSha: 'def456' })
  m(prReviewLearningRepository.findActiveKeys).mockResolvedValue([])
  m(memberRepository.labelsByIds).mockResolvedValue(
    new Map([['m_alice', 'Alice']])
  )
  m(pullRequestRepository.findStatesByIds).mockResolvedValue(new Map())
})

it('serves the context of a repository of the caller workspace', async () => {
  const res = await GET(req('?repo=acme/app&branch=feature/x'))
  expect(res.status).toBe(200)
  expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{32}"$/)
  expect(securityColumnsRepository.findSecurityBaseline).toHaveBeenCalledWith(
    'ws_1',
    'acme/app'
  )
  expect(
    securityScanContextRepository.findOpenPullRequestByBranch
  ).toHaveBeenCalledWith('ws_1', 'acme/app', 'feature/x')
  await expect(res.json()).resolves.toEqual({
    version: 1,
    repo: 'acme/app',
    baseline: {
      sha: 'abc123',
      at: '2026-10-18T10:00:00.000Z',
      partial: false,
      fingerprints: ['fp-main-1', 'fp-main-2'],
    },
    rulings: [
      {
        fingerprint: 'fp-ruled',
        ruleId: 'secret:aws-access-key-id',
        disposition: 'FALSE_POSITIVE',
        by: 'Alice',
        at: '2026-10-17T08:00:00.000Z',
        pullRequest: 12,
      },
    ],
    learnings: [],
    learningsScope: 'local',
    policy: { block: [{ provenance: 'DETERMINISTIC', severity: 'HIGH' }] },
    pullRequest: { number: 12, headSha: 'def456' },
  })
})

it('answers a matching If-None-Match with 304 and no body', async () => {
  const first = await GET(req('?repo=acme/app'))
  const etag = first.headers.get('etag') as string
  const again = await GET(req('?repo=acme/app', { 'if-none-match': etag }))
  expect(again.status).toBe(304)
  expect(again.headers.get('etag')).toBe(etag)
  expect(await again.text()).toBe('')
  const stale = await GET(req('?repo=acme/app', { 'if-none-match': '"old"' }))
  expect(stale.status).toBe(200)
})

it('refuses a repository not linked to the caller workspace (another workspace) with a JSON 404', async () => {
  m(securityColumnsRepository.findSecurityBaseline).mockResolvedValue(undefined)
  const res = await GET(req('?repo=other/app'))
  expect(res.status).toBe(404)
  expect(res.headers.get('content-type')).toContain('application/json')
  await expect(res.json()).resolves.toEqual({
    error:
      'Repository not linked to this workspace (if it was renamed, pass its current owner/name with --repo)',
  })
  // The workspace came from the identity, never from the query.
  expect(securityColumnsRepository.findSecurityBaseline).toHaveBeenCalledWith(
    'ws_1',
    'other/app'
  )
  expect(securityScanContextRepository.findRulingRows).not.toHaveBeenCalled()
})

it('ignores a workspace in the query string', async () => {
  await GET(req('?repo=acme/app&workspaceId=ws_2'))
  expect(securityColumnsRepository.findSecurityBaseline).toHaveBeenCalledWith(
    'ws_1',
    'acme/app'
  )
})

it('is 400 on a missing or malformed repo', async () => {
  expect((await GET(req(''))).status).toBe(400)
  expect((await GET(req('?repo=not-a-repo'))).status).toBe(400)
  expect((await GET(req('?repo=acme/app&branch=a%20b'))).status).toBe(400)
  expect(securityColumnsRepository.findSecurityBaseline).not.toHaveBeenCalled()
})

it('passes an unauthenticated caller the identity response', async () => {
  m(requireIdentity).mockResolvedValue(
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  )
  expect((await GET(req('?repo=acme/app'))).status).toBe(401)
  expect(securityColumnsRepository.findSecurityBaseline).not.toHaveBeenCalled()
})

it('rate-limits a member past 30 requests a minute', async () => {
  for (let i = 0; i < 30; i++)
    expect((await GET(req('?repo=acme/app'))).status).toBe(200)
  const res = await GET(req('?repo=acme/app'))
  expect(res.status).toBe(429)
})

it('never serves code, evidence, notes or learning text', async () => {
  m(prReviewLearningRepository.findActiveKeys).mockImplementation(
    async (_ws: string, _repo: string, which: string) =>
      which === 'own'
        ? [
            {
              memoryId: 'mem-1',
              repo: 'acme/app',
              pathGlob: 'fixtures/**',
              ruleId: 'secret:generic',
              fingerprint: 'fp-l',
              sourcePullRequestId: null,
              repoWideAt: new Date('2026-10-01T00:00:00Z'),
            },
          ]
        : []
  )
  const body = await (await GET(req('?repo=acme/app'))).text()
  for (const key of [
    'evidence',
    'detail',
    'dispositionNote',
    'content',
    'title',
  ])
    expect(body).not.toContain(`"${key}"`)
  expect(JSON.parse(body).learnings).toEqual([
    {
      id: 'mem-1',
      repo: 'acme/app',
      fingerprint: 'fp-l',
      ruleId: 'secret:generic',
      pathGlob: 'fixtures/**',
    },
  ])
})
