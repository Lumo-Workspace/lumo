/**
 * @jest-environment node
 *
 * LUM-1147: the review style flags of `lumo workspace security-scan --repo
 * <owner/name>` (--profile, --tone, --path-instruction) and how a
 * repository's style is shown.
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
  parsePathInstructions,
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

describe('review style flags', () => {
  it('maps --profile, --tone and --path-instruction onto the PATCH body', () => {
    expect(
      buildRepoReviewUpdate({
        repo: 'acme/app',
        profile: 'Quiet',
        tone: ' Be terse ',
        pathInstruction: [
          'scripts/**=Flag any console.log',
          ' *.sql = Needs a LIMIT, a=b ',
        ],
      })
    ).toEqual({
      repo: 'acme/app',
      reviewProfile: 'quiet',
      toneInstructions: 'Be terse',
      pathInstructions: [
        { path: 'scripts/**', instructions: 'Flag any console.log' },
        { path: '*.sql', instructions: 'Needs a LIMIT, a=b' },
      ],
    })
  })

  it('"" clears the tone and the instructions', () => {
    expect(
      buildRepoReviewUpdate({
        repo: 'acme/app',
        tone: '',
        pathInstruction: [''],
      })
    ).toEqual({
      repo: 'acme/app',
      toneInstructions: null,
      pathInstructions: [],
    })
  })

  it('rejects an unknown profile, a malformed instruction, or a missing --repo', () => {
    expect(() =>
      buildRepoReviewUpdate({ repo: 'acme/app', profile: 'loud' })
    ).toThrow(/--profile takes quiet, chill, assertive/)
    expect(() => parsePathInstructions(['no-separator'])).toThrow(
      /glob=instructions/
    )
    expect(() => parsePathInstructions(['=only text'])).toThrow()
    expect(() => buildRepoReviewUpdate({ profile: 'quiet' })).toThrow(/--repo/)
  })

  it('PATCHes the style without a confirmation envelope and shows it', async () => {
    const after: RepoReviewSettingsView = {
      canEdit: true,
      repositories: [
        {
          ...VIEW.repositories[0]!,
          reviewProfile: 'quiet',
          toneInstructions: 'Be terse',
          pathInstructions: [
            { path: 'scripts/**', instructions: 'Flag any console.log' },
          ],
        },
      ],
    }
    serve([{ body: VIEW }, { body: after }])
    const code = await workspaceSecurityScan({
      repo: 'acme/app',
      profile: 'quiet',
    })
    expect(code).toBeUndefined()
    expect(calls[1]!.init!.method).toBe('PATCH')
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({
      repo: 'acme/app',
      reviewProfile: 'quiet',
    })
    expect(out).toContain('review profile: quiet')
    expect(out).toContain('tone: Be terse')
    expect(out).toContain('path instruction: scripts/** = Flag any console.log')
  })
})

describe('formatRepoReviewFilters — review style', () => {
  it('an older server (no style fields) prints no style lines', () => {
    const lines = formatRepoReviewFilters(VIEW.repositories[0]!)
    expect(lines.join('\n')).not.toMatch(/review profile|tone|path instruction/)
  })
})
