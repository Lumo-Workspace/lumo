/**
 * @jest-environment node
 *
 * LUM-1148 — where the checks are configured: the repository's Lumo setting
 * (OWNER only, audited, partial updates, request schema limits) and
 * `.lumo.yaml` (`reviews.pre_merge_checks`, overriding the setting key by
 * key, a PR-branch copy ignored); the generated JSON schema carries the keys.
 * Plus which PR edits re-run the checks.
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoReviewSettingsService } from '@/ee/security/services/repo-review-settings.service'
import { updateRepoReviewSettingsSchema } from '@/ee/security/validation/security-scan-settings'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'
import {
  REPO_CONFIG_FIELDS,
  effectiveReviewConfig,
  parseRepoConfig,
  preMergeChecksOf,
  reviewSettingsWithFile,
} from '@/ee/security/security-scan/repo-config'
import { parsePreMergeChecksSetting } from '@/ee/security/security-scan/pre-merge-checks'
import {
  REPO_CONFIG_JSON_SCHEMA_PATH,
  repoConfigJsonSchema,
} from '@/ee/security/validation/repo-config'
import { isChecksEdit } from '@/ee/security/server'
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

describe('Lumo repository setting', () => {
  it('lists the defaults for a repository without a stored row', async () => {
    const view = await repoReviewSettingsService.list(CALLER)
    expect(view.repositories[0]!.preMergeChecks).toEqual(
      parsePreMergeChecksSetting(null)
    )
  })

  it('an OWNER changes one check; only it is written, and audited', async () => {
    await repoReviewSettingsService.update(
      CALLER,
      {
        repo: 'acme/app',
        preMergeChecks: {
          title: { mode: 'error' },
          customChecks: [
            { name: 'No TODO', mode: 'error', instructions: 'No TODO left.' },
          ],
        },
      },
      AUDIT
    )
    const [, , to, changed] = m(repoReviewSettingRepository.upsert).mock
      .calls[0]!
    expect(Object.keys(changed)).toEqual(['preMergeChecks'])
    expect(to.preMergeChecks.title).toEqual({
      mode: 'error',
      requirements: null,
    })
    expect(to.preMergeChecks.description.mode).toBe('warning')
    expect(m(recordAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'repository.review_settings_updated' })
    )
  })

  it('the same value again writes nothing', async () => {
    await repoReviewSettingsService.update(
      CALLER,
      { repo: 'acme/app', preMergeChecks: { title: { mode: 'warning' } } },
      AUDIT
    )
    expect(m(repoReviewSettingRepository.upsert)).not.toHaveBeenCalled()
  })

  it('a member is refused (403)', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    await expect(
      repoReviewSettingsService.update(
        CALLER,
        { repo: 'acme/app', preMergeChecks: { title: { mode: 'error' } } },
        AUDIT
      )
    ).rejects.toMatchObject({ status: 403 })
  })

  it('the request schema enforces the limits', () => {
    const parse = (preMergeChecks: unknown) =>
      updateRepoReviewSettingsSchema.safeParse({
        repo: 'acme/app',
        preMergeChecks,
      }).success
    expect(parse({ title: { mode: 'error' } })).toBe(true)
    expect(parse({ title: { mode: 'block' } })).toBe(false)
    expect(
      parse({ customChecks: [{ name: 'x'.repeat(51), instructions: 'r' }] })
    ).toBe(false)
    expect(
      parse({ customChecks: [{ name: 'A', instructions: 'r'.repeat(1001) }] })
    ).toBe(false)
    expect(
      parse({
        customChecks: [
          { name: 'A', instructions: 'r' },
          { name: 'a', instructions: 's' },
        ],
      })
    ).toBe(false)
    expect(
      parse({
        customChecks: Array.from({ length: 6 }, (_, i) => ({
          name: `C${i}`,
          instructions: 'r',
        })),
      })
    ).toBe(false)
  })
})

describe('.lumo.yaml', () => {
  const YAML = [
    'reviews:',
    '  pre_merge_checks:',
    '    title:',
    '      mode: error',
    '      requirements: "Start with feat:, fix: or chore:"',
    '    custom_checks:',
    '      - name: Changelog',
    '        mode: warning',
    '        instructions: Update CHANGELOG.md for user-facing changes.',
    '    override_requested_reviewers_only: true',
    '',
  ].join('\n')

  it('parses and overrides the Lumo setting key by key', () => {
    const parsed = parseRepoConfig(YAML)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.unknownKeys).toEqual([])
    const stored = {
      ...DEFAULT_REPO_REVIEW_SETTING,
      preMergeChecks: {
        ...parsePreMergeChecksSetting(null),
        description: { mode: 'error' as const },
      },
    }
    const e = effectiveReviewConfig(
      { values: stored, stored: true },
      parsed.config
    )
    expect(e.preMergeTitleMode).toMatchObject({
      value: 'error',
      source: 'file',
    })
    expect(e.preMergeDescriptionMode).toMatchObject({
      value: 'error',
      source: 'repository',
    })
    expect(preMergeChecksOf(e)).toEqual({
      title: {
        mode: 'error',
        requirements: 'Start with feat:, fix: or chore:',
      },
      description: { mode: 'error' },
      customChecks: [
        {
          name: 'Changelog',
          mode: 'warning',
          instructions: 'Update CHANGELOG.md for user-facing changes.',
        },
      ],
      overrideRequestedReviewersOnly: true,
    })
    expect(
      reviewSettingsWithFile(stored, parsed.config).preMergeChecks.title.mode
    ).toBe('error')
  })

  it('a bad mode or too many checks makes the file invalid (never half-applied)', () => {
    expect(
      parseRepoConfig(
        'reviews:\n  pre_merge_checks:\n    title:\n      mode: block\n'
      ).ok
    ).toBe(false)
    const six = Array.from(
      { length: 6 },
      (_, i) => `      - name: C${i}\n        instructions: r`
    ).join('\n')
    expect(
      parseRepoConfig(
        `reviews:\n  pre_merge_checks:\n    custom_checks:\n${six}\n`
      ).ok
    ).toBe(false)
  })

  it('every check key ignores a PR-branch copy', () => {
    for (const k of [
      'preMergeTitleMode',
      'preMergeTitleRequirements',
      'preMergeDescriptionMode',
      'preMergeCustomChecks',
      'preMergeOverrideReviewersOnly',
    ] as const)
      expect(REPO_CONFIG_FIELDS[k].prBranch).toBe('ignored')
  })

  it('the committed JSON schema is regenerated with the keys', () => {
    const committed = JSON.parse(
      readFileSync(
        join(__dirname, '../../..', REPO_CONFIG_JSON_SCHEMA_PATH),
        'utf8'
      )
    )
    expect(committed).toEqual(
      JSON.parse(JSON.stringify(repoConfigJsonSchema()))
    )
    expect(JSON.stringify(committed)).toContain('pre_merge_checks')
  })
})

describe('isChecksEdit', () => {
  const facts = (title: string, body: string | null = null) => ({
    title,
    body,
  })
  it('a title or description change on an open PR re-runs the checks', () => {
    expect(
      isChecksEdit({
        action: 'edited',
        state: 'open',
        reviewFacts: facts('fix: retry'),
        reviewFactsBefore: facts('update'),
      })
    ).toBe(true)
    expect(
      isChecksEdit({
        action: 'edited',
        state: 'open',
        reviewFacts: facts('t', 'new'),
        reviewFactsBefore: facts('t', 'old'),
      })
    ).toBe(true)
  })

  it('anything else does not', () => {
    expect(
      isChecksEdit({
        action: 'edited',
        state: 'merged',
        reviewFacts: facts('a'),
        reviewFactsBefore: facts('b'),
      })
    ).toBe(false)
    expect(
      isChecksEdit({
        action: 'labeled',
        state: 'open',
        reviewFacts: facts('a'),
        reviewFactsBefore: facts('b'),
      })
    ).toBe(false)
    expect(
      isChecksEdit({
        action: 'edited',
        state: 'open',
        reviewFacts: facts('a'),
        reviewFactsBefore: facts('a'),
      })
    ).toBe(false)
  })
})
