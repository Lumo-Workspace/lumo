/**
 * @jest-environment node
 *
 * LUM-1155 — the call-flow diagram as a setting: default on; OWNER-only
 * update with an audit event; the `.lumo.yaml` key `reviews.sequence_diagrams`
 * (base commit over the stored setting); the API schema.
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
  repoReviewSettingsService,
} from '@/ee/security/services/repo-review-settings.service'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'
import { updateRepoReviewSettingsSchema } from '@/ee/security/validation/security-scan-settings'
import {
  effectiveReviewConfig,
  parseRepoConfig,
  reviewSettingsWithFile,
} from '@/ee/security/security-scan/repo-config'
import { repoConfigJsonSchema } from '@/ee/security/validation/repo-config'
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
    repositories: ['acme/app'],
  })
  m(repoReviewSettingRepository.findForWorkspace).mockResolvedValue([])
  m(repoReviewSettingRepository.upsert).mockResolvedValue({})
})

describe('repository setting', () => {
  it('defaults to on', () => {
    expect(DEFAULT_REPO_REVIEW_SETTING.sequenceDiagrams).toBe(true)
  })

  it('an update changes it and only it', () => {
    const to = applyRepoReviewUpdate(DEFAULT_REPO_REVIEW_SETTING, {
      repo: 'acme/app',
      sequenceDiagrams: false,
    })
    expect(changedRepoReviewValues(DEFAULT_REPO_REVIEW_SETTING, to)).toEqual({
      sequenceDiagrams: false,
    })
  })

  it('the API accepts a boolean and nothing else', () => {
    expect(
      updateRepoReviewSettingsSchema.safeParse({
        repo: 'acme/app',
        sequenceDiagrams: false,
      }).success
    ).toBe(true)
    expect(
      updateRepoReviewSettingsSchema.safeParse({
        repo: 'acme/app',
        sequenceDiagrams: 'off',
      }).success
    ).toBe(false)
  })

  it('only an OWNER may change it', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    await expect(
      repoReviewSettingsService.update(
        CALLER,
        { repo: 'acme/app', sequenceDiagrams: false },
        AUDIT
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(repoReviewSettingRepository.upsert).not.toHaveBeenCalled()
  })

  it("an OWNER's change is stored and audited", async () => {
    await repoReviewSettingsService.update(
      CALLER,
      { repo: 'acme/app', sequenceDiagrams: false },
      AUDIT
    )
    expect(m(repoReviewSettingRepository.upsert).mock.calls[0]![3]).toEqual({
      sequenceDiagrams: false,
    })
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'repository.review_settings_updated',
        metadata: expect.objectContaining({
          from: expect.objectContaining({ sequenceDiagrams: true }),
          to: expect.objectContaining({ sequenceDiagrams: false }),
        }),
      })
    )
  })
})

describe('.lumo.yaml reviews.sequence_diagrams', () => {
  const stored = {
    values: { ...DEFAULT_REPO_REVIEW_SETTING, sequenceDiagrams: false },
    stored: true,
  }
  function fileWith(v: string) {
    const parsed = parseRepoConfig(`reviews:\n  sequence_diagrams: ${v}\n`)
    if (!parsed.ok) throw new Error(parsed.problems.join('; '))
    expect(parsed.unknownKeys).toEqual([])
    return parsed.config
  }

  it('the file wins over the stored setting', () => {
    expect(
      effectiveReviewConfig(stored, fileWith('true')).sequenceDiagrams
    ).toEqual({
      value: true,
      source: 'file',
      key: 'reviews.sequence_diagrams',
    })
    expect(
      reviewSettingsWithFile(DEFAULT_REPO_REVIEW_SETTING, fileWith('false'))
        .sequenceDiagrams
    ).toBe(false)
  })

  it('absent from the file: the stored setting, else the default', () => {
    expect(effectiveReviewConfig(stored, {}).sequenceDiagrams).toMatchObject({
      value: false,
      source: 'repository',
    })
    expect(
      effectiveReviewConfig(
        { values: DEFAULT_REPO_REVIEW_SETTING, stored: false },
        null
      ).sequenceDiagrams
    ).toMatchObject({ value: true, source: 'default' })
  })

  it('a non-boolean value makes the file invalid', () => {
    expect(
      parseRepoConfig('reviews:\n  sequence_diagrams: sometimes\n').ok
    ).toBe(false)
  })

  it('the JSON schema editors read has the key', () => {
    expect(JSON.stringify(repoConfigJsonSchema())).toContain(
      'sequence_diagrams'
    )
  })
})
