/**
 * @jest-environment node
 *
 * LUM-1133: `lumo workspace security-scan --repos | --repo <owner/name>
 * [--review on|off] [--drafts on|off]` — per-repository automatic review of
 * PRs without a task. Turning anything off is gated by the confirmation
 * envelope (exit 4, no PATCH); turning on is not; a non-OWNER is refused
 * before any envelope; the plain switch read is unchanged.
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
  describeRepoReviewTurnOffs,
  formatRepoReviewSettings,
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

describe('buildRepoReviewUpdate', () => {
  it('maps --review / --drafts for one repository', () => {
    expect(
      buildRepoReviewUpdate({ repo: 'acme/app', review: 'off', drafts: 'on' })
    ).toEqual({ repo: 'acme/app', autoReview: false, reviewDrafts: true })
    expect(buildRepoReviewUpdate({ repo: 'acme/app' })).toBeNull()
  })

  it('rejects bad combinations', () => {
    expect(() => buildRepoReviewUpdate({ review: 'off' })).toThrow(/--repo/)
    expect(() =>
      buildRepoReviewUpdate({ repo: 'acme/app', review: 'x' })
    ).toThrow(/--review takes on or off/)
    expect(() =>
      buildRepoReviewUpdate({ repo: 'acme/app', review: 'on', hunt: 'on' })
    ).toThrow(/cannot be combined/)
  })
})

describe('describeRepoReviewTurnOffs', () => {
  it('lists a repository turned off, and drafts turned off', () => {
    expect(
      describeRepoReviewTurnOffs(VIEW, { repo: 'ACME/app', autoReview: false })
    ).toEqual([
      'Will turn OFF automatic review for acme/app: pull requests without a Lumo task are no longer reviewed (task-linked pull requests are still scanned)',
    ])
    const drafts: RepoReviewSettingsView = {
      canEdit: true,
      repositories: [
        { repo: 'acme/app', autoReview: true, reviewDrafts: true },
      ],
    }
    expect(
      describeRepoReviewTurnOffs(drafts, {
        repo: 'acme/app',
        reviewDrafts: false,
      })
    ).toEqual([
      'Will turn OFF draft review for acme/app: drafts wait until they are marked ready',
    ])
  })

  it('is empty when nothing is turned off', () => {
    expect(
      describeRepoReviewTurnOffs(VIEW, { repo: 'acme/web', autoReview: true })
    ).toEqual([])
    expect(
      describeRepoReviewTurnOffs(VIEW, { repo: 'acme/web', autoReview: false })
    ).toEqual([])
  })
})

it('formatRepoReviewSettings renders one row per repository', () => {
  const text = formatRepoReviewSettings(VIEW)
  expect(text).toMatch(/acme\/app\s+on\s+off/)
  expect(text).toMatch(/acme\/web\s+off\s+off/)
  expect(formatRepoReviewSettings({ canEdit: true, repositories: [] })).toMatch(
    /No repositories/
  )
})

describe('workspaceSecurityScan --repos / --repo', () => {
  it('--repos reads the repository list', async () => {
    serve([{ body: VIEW }])
    expect(await workspaceSecurityScan({ repos: true })).toBeUndefined()
    expect(calls.map(c => c.url)).toEqual([PATH])
    expect(out).toMatch(/acme\/app/)
  })

  it('--repo X --review off without --confirm exits 4 and sends no PATCH', async () => {
    serve([{ body: VIEW }])
    expect(
      await workspaceSecurityScan({ repo: 'acme/app', review: 'off' })
    ).toBe(4)
    expect(calls).toHaveLength(1)
    expect(out).toMatch(/confirmation_required/)
    expect(out).toMatch(/--confirm/)
  })

  it('--repo X --review off --confirm sends the PATCH', async () => {
    serve([{ body: VIEW }, { body: VIEW }])
    expect(
      await workspaceSecurityScan({
        repo: 'acme/app',
        review: 'off',
        confirm: true,
      })
    ).toBeUndefined()
    expect(calls[1]!.url).toBe(PATH)
    expect(calls[1]!.init?.method).toBe('PATCH')
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      repo: 'acme/app',
      autoReview: false,
    })
    expect(out).toMatch(/saved/)
  })

  it('turning drafts on needs no confirmation', async () => {
    serve([{ body: VIEW }, { body: VIEW }])
    expect(
      await workspaceSecurityScan({ repo: 'acme/app', drafts: 'on' })
    ).toBeUndefined()
    expect(calls[1]!.init?.method).toBe('PATCH')
  })

  it('a non-OWNER is refused before any envelope or PATCH', async () => {
    serve([{ body: { ...VIEW, canEdit: false } }])
    expect(
      await workspaceSecurityScan({ repo: 'acme/app', review: 'off' })
    ).toBe(1)
    expect(calls).toHaveLength(1)
    expect(err).toMatch(/only workspace owners/)
  })

  it('a repository the workspace has not connected is refused', async () => {
    serve([{ body: VIEW }])
    expect(
      await workspaceSecurityScan({ repo: 'other/repo', review: 'on' })
    ).toBe(1)
    expect(calls).toHaveLength(1)
    expect(err).toMatch(/not connected/)
  })

  it('--repos --json prints the payload', async () => {
    serve([{ body: VIEW }])
    await workspaceSecurityScan({ repos: true, json: true })
    expect(JSON.parse(out)).toEqual(VIEW)
  })
})
