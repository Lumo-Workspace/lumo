/**
 * @jest-environment node
 *
 * LUM-1143: the auto-review filter flags of `lumo workspace security-scan
 * --repo <owner/name>` — repeatable, each replaces its list, "" clears — and
 * how a repository's filters are shown.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))

import {
  buildRepoReviewUpdate,
  formatRepoReviewFilters,
  parseFilterList,
  type RepoReviewSettingsView,
} from '@/cli/src/commands/workspace-repo-review'
import { workspaceSecurityScan } from '@/cli/src/commands/workspace-security-scan'

const VIEW: RepoReviewSettingsView = {
  canEdit: true,
  repositories: [
    { repo: 'acme/app', autoReview: true, reviewDrafts: false },
    { repo: 'acme/web', autoReview: false, reviewDrafts: false },
  ],
}
const PATH =
  'https://api.lumo.test/api/workspaces/me/security-scan/repositories'

let out: string
let err: string
let calls: Array<{ url: string; init: RequestInit | undefined }>

function serve(responses: Array<{ body: unknown; status?: number }>): void {
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  out = ''
  err = ''
  calls = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((s: unknown) => {
    err += String(s)
  })
})
afterEach(() => jest.restoreAllMocks())

describe('filter flags', () => {
  it('maps every filter flag onto the PATCH body', () => {
    expect(
      buildRepoReviewUpdate({
        repo: 'acme/app',
        baseBranches: ['release/.*', ' hotfix/.* '],
        labels: ['review-me', '!wip'],
        ignoreTitle: ['WIP'],
        ignoreUsers: ['dependabot[bot]'],
        descriptionKeyword: '/review',
        pathFilter: ['!docs/**'],
      })
    ).toEqual({
      repo: 'acme/app',
      baseBranches: ['release/.*', 'hotfix/.*'],
      labels: ['review-me', '!wip'],
      ignoreTitleKeywords: ['WIP'],
      ignoreUsernames: ['dependabot[bot]'],
      descriptionKeyword: '/review',
      pathFilters: ['!docs/**'],
    })
  })

  it('"" clears a list or the keyword', () => {
    expect(
      buildRepoReviewUpdate({
        repo: 'acme/app',
        labels: [''],
        descriptionKeyword: '',
      })
    ).toEqual({ repo: 'acme/app', labels: [], descriptionKeyword: null })
    expect(parseFilterList(['', '  '])).toEqual([])
  })

  it('a filter flag needs --repo', () => {
    expect(() => buildRepoReviewUpdate({ labels: ['x'] })).toThrow(/--repo/)
  })

  it('PATCHes the filters without a confirmation envelope', async () => {
    const after: RepoReviewSettingsView = {
      canEdit: true,
      repositories: [
        {
          ...VIEW.repositories[0]!,
          ignoreTitleKeywords: ['WIP'],
          emptyBaseBranchesMeans: 'all_branches',
        },
      ],
    }
    serve([{ body: VIEW }, { body: after }])
    const code = await workspaceSecurityScan({
      repo: 'acme/app',
      ignoreTitle: ['WIP'],
    })
    expect(code).toBeUndefined()
    expect(calls[1]!.url).toBe(PATH)
    expect(calls[1]!.init!.method).toBe('PATCH')
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({
      repo: 'acme/app',
      ignoreTitleKeywords: ['WIP'],
    })
    expect(out).toContain('ignore title: WIP')
  })
})

describe('formatRepoReviewFilters', () => {
  it('shows the base-branch rule and every non-empty filter', () => {
    expect(
      formatRepoReviewFilters({
        repo: 'acme/app',
        autoReview: false,
        reviewDrafts: false,
        baseBranches: ['release/.*'],
        labels: ['review-me'],
        ignoreTitleKeywords: [],
        ignoreUsernames: ['bot'],
        descriptionKeyword: '/review',
        pathFilters: ['!docs/**'],
      })
    ).toEqual([
      '  base branches: default branch + release/.*',
      '  labels: review-me',
      '  ignore users: bot',
      '  description keyword: /review',
      '  path filters: !docs/**',
    ])
  })

  it('an empty base-branch list says what it reviews', () => {
    const r = { repo: 'a/b', autoReview: true, reviewDrafts: false }
    expect(
      formatRepoReviewFilters({ ...r, emptyBaseBranchesMeans: 'all_branches' })
    ).toEqual(['  base branches: all'])
    expect(
      formatRepoReviewFilters({
        ...r,
        emptyBaseBranchesMeans: 'default_branch_only',
      })
    ).toEqual(['  base branches: default branch only'])
  })
})
