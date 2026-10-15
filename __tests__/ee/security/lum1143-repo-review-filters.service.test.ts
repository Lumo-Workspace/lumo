/**
 * @jest-environment node
 *
 * LUM-1143 — storing the auto-review filters: lists are trimmed and
 * de-duplicated, an empty keyword clears, only changed keys hit an existing
 * row, OWNER only and audited; the request schema refuses bad regexes /
 * globs.
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

import {
  applyRepoReviewUpdate,
  changedRepoReviewValues,
  normalizeFilterList,
  repoReviewSettingsService,
} from '@/ee/security/services/repo-review-settings.service'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'
import { updateRepoReviewSettingsSchema } from '@/ee/security/validation/security-scan-settings'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { recordAuditEvent } from '@/lib/services/audit.service'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const CALLER = { workspaceId: 'ws_1', memberId: 'm_1' }
const AUDIT = {
  actor: { type: 'MEMBER' as const, memberId: 'm_1' },
  source: 'CLI' as const,
}

beforeEach(() => {
  jest.clearAllMocks()
  m(miscRepository.findMemberRoleById).mockResolvedValue('OWNER')
  m(githubAppInstallationRepository.findByWorkspace).mockResolvedValue({
    repositories: ['Acme/App'],
  })
  m(repoReviewSettingRepository.findForWorkspace).mockResolvedValue([])
  m(repoReviewSettingRepository.upsert).mockResolvedValue({})
})

describe('pure helpers', () => {
  it('normalizeFilterList trims, drops blanks and duplicates', () => {
    expect(normalizeFilterList([' wip ', '', 'wip', 'draft'])).toEqual([
      'wip',
      'draft',
    ])
  })

  it('applyRepoReviewUpdate replaces given lists and clears an empty keyword', () => {
    const from = {
      ...DEFAULT_REPO_REVIEW_SETTING,
      labels: ['bug'],
      descriptionKeyword: '/review',
    }
    expect(
      applyRepoReviewUpdate(from, {
        repo: 'a/b',
        ignoreTitleKeywords: ['WIP '],
        descriptionKeyword: '  ',
      })
    ).toEqual({
      ...from,
      ignoreTitleKeywords: ['WIP'],
      descriptionKeyword: null,
    })
  })

  it('changedRepoReviewValues lists only differing keys', () => {
    const from = { ...DEFAULT_REPO_REVIEW_SETTING }
    expect(
      changedRepoReviewValues(from, {
        ...from,
        labels: ['x'],
        autoReview: true,
      })
    ).toEqual({ labels: ['x'] })
  })
})

describe('update with filters', () => {
  it('stores the filters, upserts only what changed and audits it', async () => {
    const out = await repoReviewSettingsService.update(
      CALLER,
      {
        repo: 'acme/app',
        baseBranches: ['release/.*'],
        labels: ['review-me', '!wip'],
        ignoreTitleKeywords: ['WIP'],
        ignoreUsernames: ['dependabot[bot]'],
        descriptionKeyword: '@lumo review',
        pathFilters: ['!docs/**'],
      },
      AUDIT
    )
    const changed = {
      baseBranches: ['release/.*'],
      labels: ['review-me', '!wip'],
      ignoreTitleKeywords: ['WIP'],
      ignoreUsernames: ['dependabot[bot]'],
      descriptionKeyword: '@lumo review',
      pathFilters: ['!docs/**'],
    }
    expect(repoReviewSettingRepository.upsert).toHaveBeenCalledWith(
      'ws_1',
      'acme/app',
      { ...DEFAULT_REPO_REVIEW_SETTING, ...changed },
      changed
    )
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'repository.review_settings_updated',
        metadata: expect.objectContaining({
          to: expect.objectContaining(changed),
        }),
      })
    )
    expect(out.repositories[0]).toMatchObject({
      repo: 'Acme/App',
      emptyBaseBranchesMeans: expect.any(String),
    })
  })

  it('an unchanged list writes nothing and audits nothing', async () => {
    m(repoReviewSettingRepository.findForWorkspace).mockResolvedValue([
      { repo: 'acme/app', ...DEFAULT_REPO_REVIEW_SETTING, labels: ['bug'] },
    ])
    await repoReviewSettingsService.update(
      CALLER,
      { repo: 'acme/app', labels: [' bug '] },
      AUDIT
    )
    expect(repoReviewSettingRepository.upsert).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('a MEMBER cannot change filters', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    await expect(
      repoReviewSettingsService.update(
        CALLER,
        { repo: 'acme/app', labels: ['x'] },
        AUDIT
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(repoReviewSettingRepository.upsert).not.toHaveBeenCalled()
  })
})

describe('updateRepoReviewSettingsSchema', () => {
  const parse = (body: Record<string, unknown>) =>
    updateRepoReviewSettingsSchema.safeParse({ repo: 'acme/app', ...body })

  it('accepts each filter alone (and [] / null to clear)', () => {
    expect(parse({ baseBranches: ['release/.*'] }).success).toBe(true)
    expect(parse({ labels: [] }).success).toBe(true)
    expect(parse({ descriptionKeyword: null }).success).toBe(true)
    expect(parse({ pathFilters: ['!**/*.md'] }).success).toBe(true)
  })

  it('refuses an invalid regex, a bare `!` glob, a multi-line entry, nothing to change', () => {
    expect(parse({ baseBranches: ['('] }).success).toBe(false)
    expect(parse({ pathFilters: ['!'] }).success).toBe(false)
    expect(parse({ ignoreTitleKeywords: ['a\nb'] }).success).toBe(false)
    expect(parse({}).success).toBe(false)
    expect(parse({ labels: Array(51).fill('x') }).success).toBe(false)
  })
})
