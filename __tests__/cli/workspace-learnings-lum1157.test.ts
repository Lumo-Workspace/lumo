/**
 * @jest-environment node
 *
 * LUM-1157: `lumo workspace learnings [--repo <owner/name>] [--json]` lists
 * the workspace's PR-review learnings — including those of repositories
 * linked to no Lumo project, which appear in no project's memory — with the
 * memory id `lumo memory rm` deletes.
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
  formatReviewLearnings,
  workspaceLearnings,
  type ReviewLearningsView,
} from '@/cli/src/commands/workspace-learnings'

const VIEW: ReviewLearningsView = {
  learnings: [
    {
      id: 'mem-1',
      repo: 'acme/unlinked',
      pathGlob: 'test/**',
      learning: 'Fixture tokens in test/ are fake by design.',
      ruleId: 'judge:x',
      authorLogin: 'alice',
      repositoryWide: false,
      inProject: false,
      createdAt: '2026-10-16T12:00:00.000Z',
    },
    {
      id: 'mem-2',
      repo: 'acme/app',
      pathGlob: null,
      learning: 'Raw SQL in scripts/admin is intentional.',
      ruleId: 'judge:y',
      authorLogin: 'bob',
      repositoryWide: true,
      inProject: true,
      createdAt: '2026-10-15T12:00:00.000Z',
    },
  ],
}
const PATH = 'https://api.lumo.test/api/workspaces/me/security-scan/learnings'

let out: string
let err: string
let urls: string[]

function serve(body: unknown, status = 200): void {
  global.fetch = jest.fn(async (url: string) => {
    urls.push(String(url))
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  out = ''
  err = ''
  urls = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((s: unknown) => {
    err += String(s)
  })
})
afterEach(() => jest.restoreAllMocks())

describe('formatReviewLearnings', () => {
  it('shows each id, repository, glob, author, scope and text — and marks a learning with no project', () => {
    const text = formatReviewLearnings(VIEW, undefined)
    expect(text).toContain(
      'mem-1  acme/unlinked  test/**  @alice  2026-10-16  source PR until it merges  (no project)'
    )
    expect(text).toContain('  Fixture tokens in test/ are fake by design.')
    expect(text).toContain('mem-2  acme/app  @bob  2026-10-15  repository\n')
    expect(text).toContain('lumo memory delete <ref>')
  })
  it('says so when there are none', () => {
    expect(formatReviewLearnings({ learnings: [] }, 'acme/x')).toBe(
      'No learnings for acme/x.'
    )
    expect(formatReviewLearnings({ learnings: [] }, undefined)).toBe(
      'No learnings in this workspace.'
    )
  })
})

describe('workspaceLearnings', () => {
  it('lists the whole workspace without --repo', async () => {
    serve(VIEW)
    await expect(workspaceLearnings({})).resolves.toBeUndefined()
    expect(urls).toEqual([PATH])
    expect(out).toContain('mem-1')
  })
  it('--repo narrows the request to one repository', async () => {
    serve({ learnings: [VIEW.learnings[0]] })
    await workspaceLearnings({ repo: 'acme/unlinked' })
    expect(urls).toEqual([`${PATH}?repo=acme%2Funlinked`])
  })
  it('--json prints the view as is', async () => {
    serve(VIEW)
    await workspaceLearnings({ json: true })
    expect(JSON.parse(out)).toEqual({ version: 1, ...VIEW })
  })
  it('a malformed --repo is an error before any request', async () => {
    serve(VIEW)
    await expect(workspaceLearnings({ repo: 'nope' })).resolves.toBe(2)
    expect(urls).toEqual([])
    expect(err).toMatch(/owner\/name/)
  })
  it('a server without the security plugin says so', async () => {
    serve({ error: 'Not Found' }, 404)
    await expect(workspaceLearnings({})).resolves.toBe(1)
  })
})
