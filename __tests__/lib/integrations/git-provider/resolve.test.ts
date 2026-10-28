/** LUM-1318 — provider resolution from a PR row. */
import { gitProviderFor } from '@/lib/integrations/git-provider/resolve'
import { githubGitProvider } from '@/lib/integrations/git-provider/github'
import { codeupGitProvider } from '@/lib/integrations/git-provider/codeup'

describe('gitProviderFor', () => {
  it('resolves a github row to the GitHub adapter', () => {
    expect(gitProviderFor({ provider: 'github' })).toBe(githubGitProvider)
  })
  it('treats a row without a provider as GitHub (the column default)', () => {
    expect(gitProviderFor({ provider: null })).toBe(githubGitProvider)
    expect(gitProviderFor({})).toBe(githubGitProvider)
    expect(gitProviderFor(null)).toBe(githubGitProvider)
    expect(gitProviderFor(undefined)).toBe(githubGitProvider)
  })
  it('LUM-1316: resolves a codeup row to the Codeup adapter', () => {
    expect(gitProviderFor({ provider: 'codeup' })).toBe(codeupGitProvider)
  })
  it('refuses a platform with no adapter (never falls back to GitHub)', () => {
    expect(() => gitProviderFor({ provider: 'gitlab' })).toThrow(
      expect.objectContaining({ status: 501, code: 'unsupported_git_provider' })
    )
    expect(() => gitProviderFor({ provider: 'toString' })).toThrow(
      /unsupported_git_provider/
    )
  })
})

describe('gitProviderRefOf', () => {
  it('keeps a named provider (null included) and drops an absent one', () => {
    const { gitProviderRefOf } = jest.requireActual<
      typeof import('@/lib/integrations/git-provider/resolve')
    >('@/lib/integrations/git-provider/resolve')
    expect(gitProviderRefOf({ provider: 'github' })).toEqual({
      provider: 'github',
    })
    expect(gitProviderRefOf({ provider: null })).toEqual({ provider: null })
    expect(gitProviderRefOf({})).toEqual({})
  })
})

describe('isGitApiError', () => {
  it('is true for a registered platform API error only', () => {
    const { isGitApiError } = jest.requireActual<
      typeof import('@/lib/integrations/git-provider/resolve')
    >('@/lib/integrations/git-provider/resolve')
    const { GithubApiError } = jest.requireActual<
      typeof import('@/lib/integrations/github/pr-comment-client')
    >('@/lib/integrations/github/pr-comment-client')
    expect(isGitApiError(new GithubApiError(422, null))).toBe(true)
    const { CodeupApiError } = jest.requireActual<
      typeof import('@/lib/integrations/codeup/client')
    >('@/lib/integrations/codeup/client')
    expect(isGitApiError(new CodeupApiError(404, 'gone'))).toBe(true)
    expect(isGitApiError(new Error('boom'))).toBe(false)
    expect(isGitApiError(null)).toBe(false)
  })
})
