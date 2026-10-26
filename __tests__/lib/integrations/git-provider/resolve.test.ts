/** LUM-1318 — provider resolution from a PR row. */
import { gitProviderFor } from '@/lib/integrations/git-provider/resolve'
import { githubGitProvider } from '@/lib/integrations/git-provider/github'

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
  it('refuses a platform with no adapter (never falls back to GitHub)', () => {
    expect(() => gitProviderFor({ provider: 'codeup' })).toThrow(
      expect.objectContaining({ status: 501, code: 'unsupported_git_provider' })
    )
    expect(() => gitProviderFor({ provider: 'toString' })).toThrow(
      /unsupported_git_provider/
    )
  })
})
