/**
 * @jest-environment node
 *
 * LUM-1146 — the repository config file, PURE parts: parsing and
 * validation (invalid ⇒ refused with line numbers, unknown keys ⇒
 * warnings), the precedence (file > repository setting > default) with the
 * source of every value, the summary notice, and the JSON schema parity.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  REPO_CONFIG_FIELDS,
  diffTouchesRepoConfig,
  effectiveReviewConfig,
  fileStateOf,
  loadFromText,
  parseRepoConfig,
  parseRepoConfigNotice,
  reviewSettingsWithFile,
  unknownConfigKeys,
  type RepoConfigNotice,
} from '@/ee/security/security-scan/repo-config'
import { formatRepoConfigNotice } from '@/ee/security/security-scan/repo-config-notice'
import {
  REPO_CONFIG_JSON_SCHEMA_PATH,
  REPO_CONFIG_MAX_BYTES,
  repoConfigJsonSchema,
  repoConfigSchema,
} from '@/ee/security/validation/repo-config'
import {
  DEFAULT_REPO_REVIEW_SETTING,
  evaluateReviewFilters,
  type RepoReviewSettingValues,
} from '@/ee/security/security-scan/auto-review-policy'

const FULL = `
# yaml-language-server: $schema=https://example.test/schemas/lumo-yaml.schema.json
version: 1
reviews:
  auto_review:
    enabled: false
    drafts: true
    base_branches: ["release/.*", "  ", "release/.*"]
    labels: [review-me, "!wip"]
    ignore_title_keywords: [WIP]
    ignore_usernames: ["renovate[bot]"]
    description_keyword: "@review"
  path_filters: ["!docs/**"]
`

describe('parseRepoConfig', () => {
  it('accepts every documented key', () => {
    const r = parseRepoConfig(FULL)
    expect(r).toEqual({
      ok: true,
      unknownKeys: [],
      config: {
        version: 1,
        reviews: {
          auto_review: {
            enabled: false,
            drafts: true,
            base_branches: ['release/.*', '  ', 'release/.*'],
            labels: ['review-me', '!wip'],
            ignore_title_keywords: ['WIP'],
            ignore_usernames: ['renovate[bot]'],
            description_keyword: '@review',
          },
          path_filters: ['!docs/**'],
        },
      },
    })
  })

  it('an empty or comment-only file configures nothing', () => {
    expect(parseRepoConfig('')).toEqual({
      ok: true,
      config: {},
      unknownKeys: [],
    })
    expect(parseRepoConfig('# nothing yet\n')).toEqual({
      ok: true,
      config: {},
      unknownKeys: [],
    })
  })

  it('unknown keys are warnings, not errors (and are dropped)', () => {
    const r = parseRepoConfig(
      'reviews:\n  profile: assertive\n  auto_review:\n    enabled: true\n    labelz: [x]\ntone: calm\n'
    )
    expect(r).toEqual({
      ok: true,
      config: { reviews: { auto_review: { enabled: true } } },
      unknownKeys: ['reviews.profile', 'reviews.auto_review.labelz', 'tone'],
    })
  })

  it('a YAML syntax error is refused with its line, without echoing the file', () => {
    const r = parseRepoConfig('reviews:\n  path_filters: [a\n  secret: `x`\n')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.problems[0]).toMatch(/^line \d+: /)
    expect(r.problems.join(' ')).not.toContain('secret')
  })

  it('a schema error names the key and line', () => {
    const r = parseRepoConfig(
      'reviews:\n  auto_review:\n    ignore_title_keywords: WIP\n'
    )
    expect(r).toEqual({
      ok: false,
      problems: [
        expect.stringMatching(
          /^line 3, reviews\.auto_review\.ignore_title_keywords: .*array/i
        ),
      ],
    })
  })

  it('refuses an invalid base-branch regex, a bad glob and a wrong version', () => {
    const r = parseRepoConfig(
      'version: 2\nreviews:\n  path_filters: ["!"]\n  auto_review:\n    base_branches: ["("]\n'
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.problems).toHaveLength(3)
    expect(r.problems.join('\n')).toMatch(/version/)
    expect(r.problems.join('\n')).toMatch(/path_filters\[0\]/)
    expect(r.problems.join('\n')).toMatch(
      /base_branches\[0\].*regular expression/
    )
  })

  it('refuses a non-mapping root, duplicate keys and an oversized file', () => {
    expect(parseRepoConfig('- a\n- b\n').ok).toBe(false)
    expect(parseRepoConfig('reviews: {}\nreviews: {}\n').ok).toBe(false)
    expect(parseRepoConfig(`# ${'x'.repeat(REPO_CONFIG_MAX_BYTES)}\n`)).toEqual(
      { ok: false, problems: [expect.stringMatching(/larger than/)] }
    )
  })

  it('refuses an alias bomb instead of expanding it', () => {
    const bomb = [
      'a: &a ["x","x","x","x","x","x","x","x","x"]',
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'd: [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
    ].join('\n')
    expect(parseRepoConfig(bomb).ok).toBe(false)
  })

  it('strips control characters and backticks from problems', () => {
    const r = parseRepoConfig('reviews:\n  "a`<b>\\u0007": 1\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.unknownKeys).toEqual(['reviews.ab'])
  })
})

describe('unknownConfigKeys', () => {
  it('walks nested optional objects only', () => {
    expect(
      unknownConfigKeys(repoConfigSchema, {
        version: 1,
        reviews: { path_filters: ['x'], extra: { deep: 1 } },
        other: 1,
      })
    ).toEqual(['reviews.extra', 'other'])
    expect(unknownConfigKeys(repoConfigSchema, 'not an object')).toEqual([])
  })
})

const stored = (over: Partial<RepoReviewSettingValues> = {}) => ({
  values: { ...DEFAULT_REPO_REVIEW_SETTING, ...over },
  stored: true,
})

describe('effectiveReviewConfig — precedence and sources', () => {
  it('file > repository setting > default, per key', () => {
    const file = parseRepoConfig(
      'reviews:\n  auto_review:\n    ignore_title_keywords: [" WIP ", WIP, ""]\n'
    )
    if (!file.ok) throw new Error('fixture')
    const e = effectiveReviewConfig(
      stored({ autoReview: false, ignoreTitleKeywords: ['draft'] }),
      file.config
    )
    expect(e.ignoreTitleKeywords).toEqual({
      value: ['WIP'],
      source: 'file',
      key: 'reviews.auto_review.ignore_title_keywords',
    })
    expect(e.autoReview).toEqual({
      value: false,
      source: 'repository',
      key: 'reviews.auto_review.enabled',
    })
    const d = effectiveReviewConfig(
      { values: { ...DEFAULT_REPO_REVIEW_SETTING }, stored: false },
      null
    )
    expect(d.autoReview).toEqual(
      expect.objectContaining({ value: true, source: 'default' })
    )
    expect(Object.keys(d)).toEqual(Object.keys(REPO_CONFIG_FIELDS))
  })

  it('an explicit empty list or null in the file overrides the setting', () => {
    const e = effectiveReviewConfig(
      stored({ labels: ['x'], descriptionKeyword: 'kw' }),
      {
        reviews: {
          auto_review: { labels: [], description_keyword: '  ' },
        },
      }
    )
    expect(e.labels).toEqual(
      expect.objectContaining({ value: [], source: 'file' })
    )
    expect(e.descriptionKeyword).toEqual(
      expect.objectContaining({ value: null, source: 'file' })
    )
  })

  it('v1: no key takes anything from a PR-branch copy', () => {
    for (const f of Object.values(REPO_CONFIG_FIELDS))
      expect(f.prBranch).toBe('ignored')
  })
})

describe('reviewSettingsWithFile', () => {
  const pr = {
    isDraft: false,
    baseBranch: 'main',
    defaultBranch: 'main',
    labels: [],
    title: 'WIP: probe',
    body: null,
    authorLogin: 'u',
  }

  it('applies the file over the setting the filters read', () => {
    const base = { ...DEFAULT_REPO_REVIEW_SETTING }
    expect(evaluateReviewFilters(base, pr)).toEqual({ review: true })
    const withFile = reviewSettingsWithFile(base, {
      reviews: { auto_review: { ignore_title_keywords: ['WIP'] } },
    })
    expect(evaluateReviewFilters(withFile, pr)).toEqual({
      review: false,
      reason: 'ignored_title',
    })
    // A key the file cannot set keeps the stored value.
    expect(
      reviewSettingsWithFile(
        { ...base, emptyBaseBranchesMeans: 'all_branches' },
        { reviews: { auto_review: { base_branches: [] } } }
      ).emptyBaseBranchesMeans
    ).toBe('all_branches')
  })

  it('no file = the settings unchanged', () => {
    const s = { ...DEFAULT_REPO_REVIEW_SETTING, labels: ['a'] }
    expect(reviewSettingsWithFile(s, null)).toBe(s)
  })
})

describe('load results and the stored notice', () => {
  it('loadFromText / fileStateOf', () => {
    expect(loadFromText(null)).toEqual({ status: 'absent' })
    expect(fileStateOf(loadFromText('x: 1\n'), 'abc')).toEqual({
      status: 'loaded',
      sha: 'abc',
      problems: [],
      unknownKeys: ['x'],
    })
    expect(fileStateOf(loadFromText('version: 9\n'), null)).toEqual(
      expect.objectContaining({ status: 'invalid', sha: null })
    )
    expect(fileStateOf({ status: 'unreadable' }, null).status).toBe(
      'unreadable'
    )
  })

  it('parseRepoConfigNotice round-trips and rejects junk', () => {
    const notice: RepoConfigNotice = {
      baseRef: 'main',
      base: {
        status: 'invalid',
        sha: 'a',
        problems: ['line 1: x'],
        unknownKeys: [],
      },
      prBranch: null,
    }
    expect(parseRepoConfigNotice(JSON.parse(JSON.stringify(notice)))).toEqual(
      notice
    )
    expect(parseRepoConfigNotice(null)).toBeNull()
    expect(parseRepoConfigNotice({ base: { status: 'weird' } })).toBeNull()
    expect(
      parseRepoConfigNotice({
        baseRef: 7,
        base: { status: 'loaded', problems: 'x', unknownKeys: [1, 'k`'] },
      })
    ).toEqual({
      baseRef: null,
      base: { status: 'loaded', sha: null, problems: [], unknownKeys: ['k'] },
      prBranch: null,
    })
  })

  it('diffTouchesRepoConfig sees added, edited, renamed and deleted files only at the root', () => {
    const d = (a: string, b: string) => `diff --git a/${a} b/${b}\n`
    expect(
      diffTouchesRepoConfig(d('.lumo.yaml', '.lumo.yaml'), '.lumo.yaml')
    ).toBe(true)
    expect(
      diffTouchesRepoConfig(d('old.yaml', '.lumo.yaml'), '.lumo.yaml')
    ).toBe(true)
    expect(diffTouchesRepoConfig(d('.lumo.yaml', 'x.yaml'), '.lumo.yaml')).toBe(
      true
    )
    expect(
      diffTouchesRepoConfig(d('pkg/.lumo.yaml', 'pkg/.lumo.yaml'), '.lumo.yaml')
    ).toBe(false)
    expect(diffTouchesRepoConfig('', '.lumo.yaml')).toBe(false)
  })
})

describe('formatRepoConfigNotice', () => {
  const code = (s: string) => `\`${s}\``
  const state = (over: object) => ({
    status: 'loaded' as const,
    sha: 'a',
    problems: [],
    unknownKeys: [],
    ...over,
  })

  it('says nothing for no file or a clean file', () => {
    expect(formatRepoConfigNotice(null, { code })).toEqual([])
    expect(
      formatRepoConfigNotice(
        { baseRef: 'main', base: state({ status: 'absent' }), prBranch: null },
        { code }
      )
    ).toEqual([])
    expect(
      formatRepoConfigNotice(
        { baseRef: 'main', base: state({}), prBranch: null },
        { code }
      )
    ).toEqual([])
  })

  it('an invalid base file is reported with the fallback, never silently', () => {
    const [line] = formatRepoConfigNotice(
      {
        baseRef: 'main',
        base: state({ status: 'invalid', problems: ['line 3: bad'] }),
        prBranch: null,
      },
      { code }
    )
    expect(line).toContain('`.lumo.yaml` on the base branch `main` is invalid')
    expect(line).toContain("reviewed with the repository's settings in Lumo")
    expect(line).toContain('`line 3: bad`')
  })

  it('unreadable, unknown keys, and a PR that changes / breaks / deletes the file', () => {
    const lines = (n: RepoConfigNotice) => formatRepoConfigNotice(n, { code })
    expect(
      lines({
        baseRef: null,
        base: state({ status: 'unreadable' }),
        prBranch: null,
      })[0]
    ).toMatch(/could not read `\.lumo\.yaml` on the base branch/)
    expect(
      lines({
        baseRef: 'main',
        base: state({ unknownKeys: ['tone'] }),
        prBranch: null,
      })[0]
    ).toMatch(/Unknown key ignored: `tone`/)
    expect(
      lines({
        baseRef: 'main',
        base: state({ status: 'absent' }),
        prBranch: state({}),
      })[0]
    ).toMatch(
      /This PR changes `\.lumo\.yaml`\. .*applies to reviews after this PR merges/
    )
    expect(
      lines({
        baseRef: 'main',
        base: state({ status: 'absent' }),
        prBranch: state({ status: 'invalid', problems: ['line 1: x'] }),
      })[0]
    ).toMatch(/new file is invalid: `line 1: x`.*Fix it before merging/)
    expect(
      lines({
        baseRef: 'main',
        base: state({}),
        prBranch: state({ status: 'absent' }),
      })[0]
    ).toMatch(/This PR deletes `\.lumo\.yaml`/)
    expect(
      lines({
        baseRef: 'main',
        base: state({}),
        prBranch: state({ status: 'unreadable' }),
      })[0]
    ).toMatch(/could not read the new file/)
  })
})

describe('JSON schema for editors', () => {
  it('the committed schema matches the Zod schema (regenerate with scripts/security/emit-repo-config-schema.ts)', () => {
    const committed = JSON.parse(
      readFileSync(join(process.cwd(), REPO_CONFIG_JSON_SCHEMA_PATH), 'utf8')
    )
    expect(committed).toEqual(repoConfigJsonSchema())
  })

  it('documents every key', () => {
    const schema = repoConfigJsonSchema() as {
      properties: {
        reviews: {
          properties: Record<
            string,
            {
              description?: string
              properties?: Record<string, { description?: string }>
            }
          >
        }
      }
    }
    const reviews = schema.properties.reviews.properties
    expect(reviews.path_filters?.description).toBeTruthy()
    for (const v of Object.values(reviews.auto_review?.properties ?? {}))
      expect(v.description).toBeTruthy()
  })
})
