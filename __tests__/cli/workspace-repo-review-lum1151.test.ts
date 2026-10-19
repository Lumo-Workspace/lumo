/**
 * @jest-environment node
 *
 * LUM-1151: `lumo workspace security-scan --repo <owner/name> --summary
 * description|comment|off` and how the setting is shown.
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
  type RepoReviewSettingsView,
} from '@/cli/src/commands/workspace-repo-review'
import { workspaceSecurityScan } from '@/cli/src/commands/workspace-security-scan'

const VIEW: RepoReviewSettingsView = {
  canEdit: true,
  repositories: [{ repo: 'acme/app', autoReview: true, reviewDrafts: false }],
}

let out: string
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
  calls = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

it('maps --summary onto the PATCH body', () => {
  expect(
    buildRepoReviewUpdate({ repo: 'acme/app', summary: ' Comment ' })
  ).toEqual({
    repo: 'acme/app',
    highLevelSummary: 'comment',
  })
})

it('rejects an unknown mode or a missing --repo', () => {
  expect(() =>
    buildRepoReviewUpdate({ repo: 'acme/app', summary: 'walk' })
  ).toThrow(/--summary takes description, comment, off/)
  expect(() => buildRepoReviewUpdate({ summary: 'off' })).toThrow(/--repo/)
})

it('PATCHes without a confirmation envelope and shows the setting', async () => {
  serve([
    { body: VIEW },
    {
      body: {
        canEdit: true,
        repositories: [{ ...VIEW.repositories[0]!, highLevelSummary: 'off' }],
      },
    },
  ])
  const code = await workspaceSecurityScan({ repo: 'acme/app', summary: 'off' })
  expect(code).toBeUndefined()
  expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({
    repo: 'acme/app',
    highLevelSummary: 'off',
  })
  expect(out).toContain('high-level summary: off')
})

it('an older server (no field) prints no summary line', () => {
  expect(
    formatRepoReviewFilters(VIEW.repositories[0]!).join('\n')
  ).not.toContain('high-level summary')
})
