/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))

import { taskArtifactRm } from '@/cli/src/commands/task-artifact-rm'

const noContent = {
  ok: true,
  status: 204,
  json: async () => ({}),
} as unknown as Response

const notFound = {
  ok: false,
  status: 404,
  json: async () => ({ error: 'Artifact not found' }),
} as unknown as Response

describe('taskArtifactRm', () => {
  beforeEach(() => jest.restoreAllMocks())

  it('errors when <task> is missing', async () => {
    const code = await taskArtifactRm(undefined, 'a1', { yes: true })
    expect(code).toBe(1)
  })

  it('errors when <artifact-id> is missing', async () => {
    const code = await taskArtifactRm('LUM-9', undefined, { yes: true })
    expect(code).toBe(1)
  })

  // Without --confirm the command walks the confirmation protocol (exit 4 +
  // envelope) — covered in confirmation-protocol.test.ts.

  it('DELETEs the single-artifact route on success', async () => {
    const writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(noContent)
    const code = await taskArtifactRm('LUM-9', 'a1', { confirm: true })
    expect(code).toBeUndefined()
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toBe('https://api.test/api/tasks/LUM-9/artifacts/a1')
    expect((init as RequestInit).method).toBe('DELETE')
    const output = writeSpy.mock.calls.map(c => c[0]).join('')
    expect(output).toContain('Removed a1 from LUM-9')
  })

  it('returns 1 and prints the server message on 404', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(notFound)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const code = await taskArtifactRm('LUM-9', 'a-x', { confirm: true })
    expect(code).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Artifact not found')
    )
  })
})
