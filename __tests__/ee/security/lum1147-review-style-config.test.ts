/**
 * @jest-environment node
 *
 * LUM-1147 — the review style as settings: the API schema's caps, the
 * `.lumo.yaml` keys (reviews.profile, reviews.path_instructions,
 * tone_instructions) and their precedence over the stored settings, and
 * how an update is normalised before it is stored.
 */
import { updateRepoReviewSettingsSchema } from '@/ee/security/validation/security-scan-settings'
import {
  effectiveReviewConfig,
  parseRepoConfig,
  reviewSettingsWithFile,
  REPO_CONFIG_FIELDS,
} from '@/ee/security/security-scan/repo-config'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'
import {
  applyRepoReviewUpdate,
  changedRepoReviewValues,
} from '@/ee/security/services/repo-review-settings.service'

const ok = (body: Record<string, unknown>) =>
  updateRepoReviewSettingsSchema.safeParse({ repo: 'acme/app', ...body })
    .success

describe('LUM-1147 API schema — size caps', () => {
  it('accepts a profile, a tone and instructions within the caps', () => {
    expect(
      ok({
        reviewProfile: 'assertive',
        toneInstructions: 'Be terse',
        pathInstructions: [{ path: 'scripts/**', instructions: 'Flag logs' }],
      })
    ).toBe(true)
    expect(ok({ toneInstructions: null })).toBe(true)
    expect(ok({ pathInstructions: [] })).toBe(true)
  })

  it('refuses over-cap or malformed values', () => {
    expect(ok({ reviewProfile: 'loud' })).toBe(false)
    expect(ok({ toneInstructions: 't'.repeat(251) })).toBe(false)
    expect(
      ok({
        pathInstructions: Array.from({ length: 21 }, (_, i) => ({
          path: `d${i}/**`,
          instructions: 'x',
        })),
      })
    ).toBe(false)
    expect(
      ok({
        pathInstructions: [{ path: 'a/**', instructions: 'x'.repeat(1001) }],
      })
    ).toBe(false)
    expect(
      ok({ pathInstructions: [{ path: 'p'.repeat(201), instructions: 'x' }] })
    ).toBe(false)
    expect(
      ok({ pathInstructions: [{ path: '!a/**', instructions: 'x' }] })
    ).toBe(false)
    expect(
      ok({ pathInstructions: [{ path: 'a\nb', instructions: 'x' }] })
    ).toBe(false)
    expect(
      ok({ pathInstructions: [{ path: 'a/**', instructions: 'x', extra: 1 }] })
    ).toBe(false)
  })
})

describe('LUM-1147 .lumo.yaml keys', () => {
  const FILE = [
    'reviews:',
    '  profile: quiet',
    '  path_instructions:',
    '    - path: "scripts/**"',
    '      instructions: Flag any console.log.',
    'tone_instructions: Be friendly.',
    '',
  ].join('\n')

  it('parses and resolves over the stored settings, with sources', () => {
    const parsed = parseRepoConfig(FILE)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.unknownKeys).toEqual([])
    const stored = {
      ...DEFAULT_REPO_REVIEW_SETTING,
      reviewProfile: 'assertive' as const,
      toneInstructions: 'Be terse.',
    }
    const e = effectiveReviewConfig(
      { values: stored, stored: true },
      parsed.config
    )
    expect(e.reviewProfile).toEqual({
      value: 'quiet',
      source: 'file',
      key: 'reviews.profile',
    })
    expect(e.pathInstructions.value).toEqual([
      { path: 'scripts/**', instructions: 'Flag any console.log.' },
    ])
    expect(e.toneInstructions).toEqual({
      value: 'Be friendly.',
      source: 'file',
      key: 'tone_instructions',
    })
    const merged = reviewSettingsWithFile(stored, parsed.config)
    expect(merged.reviewProfile).toBe('quiet')
    expect(merged.toneInstructions).toBe('Be friendly.')
  })

  it('a file without the keys leaves the stored style; defaults otherwise', () => {
    const parsed = parseRepoConfig('reviews:\n  path_filters: []\n')
    if (!parsed.ok) throw new Error('parse')
    const e = effectiveReviewConfig(
      { values: DEFAULT_REPO_REVIEW_SETTING, stored: false },
      parsed.config
    )
    expect(e.reviewProfile).toEqual({
      value: 'chill',
      source: 'default',
      key: 'reviews.profile',
    })
    expect(e.toneInstructions.value).toBeNull()
    expect(e.pathInstructions.value).toEqual([])
  })

  it('an over-cap or wrong-typed value invalidates the file (never half-applied)', () => {
    for (const bad of [
      'reviews:\n  profile: loud\n',
      `tone_instructions: "${'t'.repeat(251)}"\n`,
      'reviews:\n  path_instructions: "scripts/**"\n',
      'reviews:\n  path_instructions:\n    - path: "!x/**"\n      instructions: y\n',
    ])
      expect(parseRepoConfig(bad).ok).toBe(false)
  })

  it('every new key is ignored on a PR-branch copy', () => {
    for (const k of [
      'reviewProfile',
      'pathInstructions',
      'toneInstructions',
    ] as const)
      expect(REPO_CONFIG_FIELDS[k].prBranch).toBe('ignored')
  })
})

describe('LUM-1147 settings update', () => {
  it('normalises instructions and tone and reports only changed keys', () => {
    const from = { ...DEFAULT_REPO_REVIEW_SETTING }
    const to = applyRepoReviewUpdate(from, {
      repo: 'acme/app',
      reviewProfile: 'quiet',
      toneInstructions: '  Be\nterse ',
      pathInstructions: [
        { path: ' scripts/** ', instructions: ' Flag logs ' },
        { path: 'scripts/**', instructions: 'dup' },
      ],
    })
    expect(to.reviewProfile).toBe('quiet')
    expect(to.toneInstructions).toBe('Be terse')
    expect(to.pathInstructions).toEqual([
      { path: 'scripts/**', instructions: 'Flag logs' },
    ])
    expect(Object.keys(changedRepoReviewValues(from, to)).sort()).toEqual([
      'pathInstructions',
      'reviewProfile',
      'toneInstructions',
    ])
    // The same instructions again is not a change.
    expect(
      changedRepoReviewValues(
        to,
        applyRepoReviewUpdate(to, {
          repo: 'acme/app',
          pathInstructions: [{ path: 'scripts/**', instructions: 'Flag logs' }],
        })
      )
    ).toEqual({})
    expect(
      applyRepoReviewUpdate(to, { repo: 'acme/app', toneInstructions: '' })
        .toneInstructions
    ).toBeNull()
  })
})
