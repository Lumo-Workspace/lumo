/**
 * @jest-environment node
 *
 * LUM-1318 — the absence search reads the repository archive only on a
 * platform that offers one (`capabilities.repoArchive`); otherwise it reads
 * nothing and reports no search (absence stays unproven), never an error.
 */
jest.mock('@/lib/integrations/git-provider/resolve', () => ({
  gitProviderFor: jest.fn(),
}))

import { gitProviderFor } from '@/lib/integrations/git-provider/resolve'
import {
  allCapabilities,
  type GitProvider,
} from '@/lib/integrations/git-provider'
import { repoAbsenceSearchService } from '@/ee/security/services/repo-absence-search.service'

const input = {
  provider: 'codeup',
  workspaceId: 'w1',
  repo: 'o/r',
  headSha: 'a'.repeat(40),
  queries: [{ id: 'q1', terms: ['logout'] }] as never,
}

it('without a repository archive nothing is read and no search is reported', async () => {
  const withRepoReadToken = jest.fn()
  ;(gitProviderFor as jest.Mock).mockReturnValue({
    capabilities: { ...allCapabilities(), repoArchive: false },
    withRepoReadToken,
  } as unknown as GitProvider)
  await expect(repoAbsenceSearchService.search(input)).resolves.toBeUndefined()
  expect(gitProviderFor).toHaveBeenCalledWith(input)
  expect(withRepoReadToken).not.toHaveBeenCalled()
})
