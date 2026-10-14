/**
 * @jest-environment node
 *
 * LUM-1133 — per-repository automatic review settings: any member reads,
 * only an OWNER changes, only a confirmed repository can be set, and every
 * real change writes an audit event.
 */
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
  recordAuditEvent: jest.fn().mockResolvedValue(true),
}))

import { repoReviewSettingsService } from '@/ee/security/services/repo-review-settings.service'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { recordAuditEvent } from '@/lib/services/audit.service'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const CALLER = { workspaceId: 'ws_1', memberId: 'm_1' }
const AUDIT = {
  actor: { type: 'MEMBER' as const, memberId: 'm_1' },
  source: 'WEB' as const,
}

beforeEach(() => {
  jest.clearAllMocks()
  m(miscRepository.findMemberRoleById).mockResolvedValue('OWNER')
  m(githubAppInstallationRepository.findByWorkspace).mockResolvedValue({
    repositories: ['Acme/App', 'acme/web'],
  })
  m(repoReviewSettingRepository.findForWorkspace).mockResolvedValue([
    { repo: 'acme/web', autoReview: false, reviewDrafts: false },
  ])
  m(repoReviewSettingRepository.upsert).mockResolvedValue({})
})

describe('list', () => {
  it('lists every confirmed repository with its setting or the defaults', async () => {
    await expect(repoReviewSettingsService.list(CALLER)).resolves.toEqual({
      canEdit: true,
      repositories: [
        { repo: 'Acme/App', autoReview: true, reviewDrafts: false },
        { repo: 'acme/web', autoReview: false, reviewDrafts: false },
      ],
    })
  })

  it('a MEMBER may read but not edit; no App means no repositories', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    m(githubAppInstallationRepository.findByWorkspace).mockResolvedValue(null)
    await expect(repoReviewSettingsService.list(CALLER)).resolves.toEqual({
      canEdit: false,
      repositories: [],
    })
  })
})

describe('update', () => {
  it('an OWNER turns a repository off: stored lower-cased and audited', async () => {
    await repoReviewSettingsService.update(
      CALLER,
      { repo: 'ACME/app', autoReview: false },
      AUDIT
    )
    expect(repoReviewSettingRepository.upsert).toHaveBeenCalledWith(
      'ws_1',
      'acme/app',
      { autoReview: false, reviewDrafts: false }
    )
    expect(recordAuditEvent).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      action: 'repository.review_settings_updated',
      target: { type: 'repository', id: 'acme/app' },
      metadata: {
        repo: 'Acme/App',
        from: { autoReview: true, reviewDrafts: false },
        to: { autoReview: false, reviewDrafts: false },
      },
      context: AUDIT,
    })
  })

  it('a MEMBER gets 403 and nothing is written', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    await expect(
      repoReviewSettingsService.update(
        CALLER,
        { repo: 'acme/app', reviewDrafts: true },
        AUDIT
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(repoReviewSettingRepository.upsert).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('a repository the workspace has not confirmed is 404', async () => {
    await expect(
      repoReviewSettingsService.update(
        CALLER,
        { repo: 'other/repo', autoReview: false },
        AUDIT
      )
    ).rejects.toMatchObject({ status: 404 })
    expect(repoReviewSettingRepository.upsert).not.toHaveBeenCalled()
  })

  it('a no-op change writes no audit event', async () => {
    await repoReviewSettingsService.update(
      CALLER,
      { repo: 'acme/web', autoReview: false },
      AUDIT
    )
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })
})
