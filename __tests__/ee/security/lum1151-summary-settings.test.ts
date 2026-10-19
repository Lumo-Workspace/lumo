/**
 * @jest-environment node
 *
 * LUM-1151 — where the high-level summary goes, as a setting: the
 * repository setting (OWNER-only update, validated), the `.lumo.yaml` key
 * (`true` / `false` shorthands, base commit over the stored setting), and
 * the changed-files walkthrough (pure).
 */
import {
  applyRepoReviewUpdate,
  changedRepoReviewValues,
} from '@/ee/security/services/repo-review-settings.service'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'
import { updateRepoReviewSettingsSchema } from '@/ee/security/validation/security-scan-settings'
import {
  effectiveReviewConfig,
  parseRepoConfig,
  reviewSettingsWithFile,
} from '@/ee/security/security-scan/repo-config'
import { repoConfigJsonSchema } from '@/ee/security/validation/repo-config'
import {
  WALKTHROUGH_MAX_FILES,
  buildWalkthrough,
  changedFilesSection,
  changedFilesTable,
} from '@/ee/security/security-scan/pr-walkthrough'

describe('repository setting', () => {
  it('defaults to the PR description', () => {
    expect(DEFAULT_REPO_REVIEW_SETTING.highLevelSummary).toBe('description')
  })

  it('an update changes it and only it', () => {
    const to = applyRepoReviewUpdate(DEFAULT_REPO_REVIEW_SETTING, {
      repo: 'acme/app',
      highLevelSummary: 'off',
    })
    expect(changedRepoReviewValues(DEFAULT_REPO_REVIEW_SETTING, to)).toEqual({
      highLevelSummary: 'off',
    })
  })

  it('the API accepts the three modes and nothing else', () => {
    for (const m of ['description', 'comment', 'off'])
      expect(
        updateRepoReviewSettingsSchema.safeParse({
          repo: 'acme/app',
          highLevelSummary: m,
        }).success
      ).toBe(true)
    expect(
      updateRepoReviewSettingsSchema.safeParse({
        repo: 'acme/app',
        highLevelSummary: 'walkthrough',
      }).success
    ).toBe(false)
  })
})

describe('.lumo.yaml reviews.high_level_summary', () => {
  const stored = {
    values: {
      ...DEFAULT_REPO_REVIEW_SETTING,
      highLevelSummary: 'comment' as const,
    },
    stored: true,
  }
  function fileWith(v: string) {
    const parsed = parseRepoConfig(`reviews:\n  high_level_summary: ${v}\n`)
    if (!parsed.ok) throw new Error(parsed.problems.join('; '))
    expect(parsed.unknownKeys).toEqual([])
    return parsed.config
  }

  it('the file wins over the stored setting; true / false are shorthands', () => {
    expect(
      effectiveReviewConfig(stored, fileWith('off')).highLevelSummary
    ).toEqual({
      value: 'off',
      source: 'file',
      key: 'reviews.high_level_summary',
    })
    expect(
      effectiveReviewConfig(stored, fileWith('false')).highLevelSummary.value
    ).toBe('off')
    expect(
      effectiveReviewConfig(stored, fileWith('true')).highLevelSummary.value
    ).toBe('description')
    expect(
      reviewSettingsWithFile(stored.values, fileWith('description'))
        .highLevelSummary
    ).toBe('description')
  })

  it('absent from the file: the stored setting, else the default', () => {
    expect(effectiveReviewConfig(stored, {}).highLevelSummary).toMatchObject({
      value: 'comment',
      source: 'repository',
    })
    expect(
      effectiveReviewConfig(
        { values: DEFAULT_REPO_REVIEW_SETTING, stored: false },
        null
      ).highLevelSummary
    ).toMatchObject({ value: 'description', source: 'default' })
  })

  it('an unknown value makes the file invalid (never half-applied)', () => {
    const parsed = parseRepoConfig('reviews:\n  high_level_summary: loud\n')
    expect(parsed.ok).toBe(false)
  })

  it('the JSON schema editors read has the key', () => {
    expect(JSON.stringify(repoConfigJsonSchema())).toContain(
      'high_level_summary'
    )
  })
})

describe('walkthrough (pure)', () => {
  it('lists files with their change and lines, neutralising names', () => {
    const table = changedFilesTable([
      { filename: 'a|b`<x>.ts', status: 'added', additions: 3, deletions: 0 },
      { filename: 'gone.ts', status: 'removed', additions: 0, deletions: 9 },
    ])!
    expect(table).toContain('| `abx.ts` | added | +3 / −0 |')
    expect(table).toContain('| `gone.ts` | deleted | +0 / −9 |')
    expect(table).toContain('2 files changed, +3 / −9 lines.')
  })

  it('names the first files and counts the rest', () => {
    const files = Array.from({ length: WALKTHROUGH_MAX_FILES + 3 }, (_, i) => ({
      filename: `f${i}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 1,
    }))
    const table = changedFilesTable(files)!
    expect(table).toContain('3 more not listed')
    expect(table).not.toContain(`f${WALKTHROUGH_MAX_FILES}.ts`)
  })

  it('folds its sections and says nothing without one', () => {
    expect(buildWalkthrough([changedFilesSection([])])).toBeNull()
    expect(buildWalkthrough([null, changedFilesSection(null)])).toBeNull()
    const block = buildWalkthrough([
      changedFilesSection([
        { filename: 'x.ts', status: 'modified', additions: 1, deletions: 2 },
      ]),
      { title: 'Extra', body: 'More.' },
    ])!
    expect(block.startsWith('<details>\n<summary>Walkthrough</summary>')).toBe(
      true
    )
    expect(block).toContain('**Changed files**')
    expect(block).toContain('**Extra**\n\nMore.')
  })
})
