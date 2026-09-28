/** @jest-environment node */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('ghs_tok'),
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import { fetchDefaultBranchHead } from '@/lib/integrations/github/contents'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

const json = (body: unknown, status = 200) => ({
  ok: status < 300,
  status,
  json: async () => body,
})

describe('LUM-738 baseline lifecycle — fetchDefaultBranchHead', () => {
  it('reads default_branch from the repo, then the head sha of that ref, with the installation token', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ default_branch: 'main' }))
      .mockResolvedValueOnce(json({ object: { sha: 'c'.repeat(40) } }))
    await expect(
      fetchDefaultBranchHead({ workspaceId: 'w1', fullName: 'o/r' })
    ).resolves.toEqual({ branch: 'main', sha: 'c'.repeat(40) })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/o/r',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghs_tok' }),
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/o/r/git/ref/heads/main',
      expect.anything()
    )
  })

  it('throws with the status on a non-2xx and on a missing field', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404))
    await expect(
      fetchDefaultBranchHead({ workspaceId: 'w1', fullName: 'o/r' })
    ).rejects.toMatchObject({ status: 404 })
    fetchMock
      .mockResolvedValueOnce(json({ default_branch: 'main' }))
      .mockResolvedValueOnce(json({ object: {} }))
    await expect(
      fetchDefaultBranchHead({ workspaceId: 'w1', fullName: 'o/r' })
    ).rejects.toThrow(/missing object.sha/)
  })
})
