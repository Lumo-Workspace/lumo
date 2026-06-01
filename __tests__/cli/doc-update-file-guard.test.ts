/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/resolve-doc-id', () => ({
  lookupDocId: jest.fn(async () => 'cmd_x'),
}))
jest.mock('@/cli/src/lib/path-guard', () => ({
  checkArtifactFilePath: jest.fn(() => ({
    ok: false,
    reason: 'outside-project',
    detail: 'resolves outside project directory',
  })),
}))

import { docUpdate } from '@/cli/src/commands/doc-update'

describe('docUpdate --file path guard', () => {
  afterEach(() => jest.restoreAllMocks())

  it('rejects an outside-project --file and never calls the API', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const code = await docUpdate('My Doc', { file: '/etc/passwd' })
    expect(code).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing to read')
    )
  })
})
