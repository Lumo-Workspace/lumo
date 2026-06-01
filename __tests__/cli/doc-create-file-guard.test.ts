/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/path-guard', () => ({
  checkArtifactFilePath: jest.fn(() => ({
    ok: false,
    reason: 'sensitive',
    detail: 'matches .env',
  })),
}))

import { docCreate } from '@/cli/src/commands/doc-create'

describe('docCreate --file path guard', () => {
  afterEach(() => jest.restoreAllMocks())

  it('rejects a sensitive --file and never calls the API', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({}),
    } as unknown as Response)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const code = await docCreate('My Doc', { file: '../../secret.env' })
    expect(code).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing to read')
    )
  })
})
