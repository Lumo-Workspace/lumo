/**
 * @jest-environment node
 *
 * LUM-1133: GET/PATCH /api/workspaces/me/security-scan/repositories through
 * the real service — OWNER changes (audited), MEMBER gets 403, bad bodies 400.
 */
jest.mock('@/lib/auth/identity', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberRoleById: jest.fn() },
}))
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: { findByWorkspace: jest.fn() },
}))
jest.mock('@/ee/security/repositories/repo-review-setting.repository', () => ({
  repoReviewSettingRepository: {
    findForWorkspace: jest.fn(),
    upsert: jest.fn(),
  },
}))
jest.mock('@/lib/services/audit.service', () => ({
  ...jest.requireActual('@/lib/services/audit.service'),
  recordAuditEvent: jest.fn().mockResolvedValue(true),
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { recordAuditEvent } from '@/lib/services/audit.service'
import {
  GET,
  PATCH,
} from '@/app/api/workspaces/me/security-scan/repositories/route'

const m = <T>(fn: T) => fn as unknown as jest.Mock

function req(method: string, body?: unknown) {
  return new NextRequest(
    'http://localhost/api/workspaces/me/security-scan/repositories',
    {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  m(requireIdentity).mockResolvedValue({
    clerkId: 'u_1',
    memberId: 'm_1',
    workspaceId: 'ws_1',
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    source: 'bearer',
  })
  m(miscRepository.findMemberRoleById).mockResolvedValue('OWNER')
  m(githubAppInstallationRepository.findByWorkspace).mockResolvedValue({
    repositories: ['acme/app'],
  })
  m(repoReviewSettingRepository.findForWorkspace).mockResolvedValue([])
  m(repoReviewSettingRepository.upsert).mockResolvedValue({})
})

it('GET lists the confirmed repositories for any member', async () => {
  m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
  const res = await GET(req('GET'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    canEdit: false,
    repositories: [{ repo: 'acme/app', autoReview: true, reviewDrafts: false }],
  })
})

it('PATCH by an OWNER changes the repository and writes a CLI audit event', async () => {
  const res = await PATCH(req('PATCH', { repo: 'acme/app', autoReview: false }))
  expect(res.status).toBe(200)
  expect(repoReviewSettingRepository.upsert).toHaveBeenCalledWith(
    'ws_1',
    'acme/app',
    { autoReview: false, reviewDrafts: false }
  )
  const [event] = m(recordAuditEvent).mock.calls[0]
  expect(event.action).toBe('repository.review_settings_updated')
  expect(event.context.source).toBe('CLI')
})

it('PATCH by a MEMBER is 403', async () => {
  m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
  const res = await PATCH(
    req('PATCH', { repo: 'acme/app', reviewDrafts: true })
  )
  expect(res.status).toBe(403)
  expect(repoReviewSettingRepository.upsert).not.toHaveBeenCalled()
  expect(recordAuditEvent).not.toHaveBeenCalled()
})

it.each([
  [{ repo: 'acme/app' }],
  [{ repo: 'not a repo', autoReview: true }],
  [{ repo: 'acme/app', autoReview: 'off' }],
  [{ repo: 'acme/app', autoReview: true, extra: 1 }],
])('PATCH rejects %j with 400', async body => {
  expect((await PATCH(req('PATCH', body))).status).toBe(400)
  expect(repoReviewSettingRepository.upsert).not.toHaveBeenCalled()
})
