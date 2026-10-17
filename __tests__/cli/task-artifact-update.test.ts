/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))

import { taskArtifactUpdate } from '@/cli/src/commands/task-artifact-update'

const okUpdated = {
  ok: true,
  status: 200,
  json: async () => ({
    artifact: { id: 'a1', kind: 'plan', title: 'Spec', source: 'spec-kit' },
  }),
} as unknown as Response

const notFound = {
  ok: false,
  status: 404,
  json: async () => ({ error: 'Artifact not found' }),
} as unknown as Response

describe('taskArtifactUpdate', () => {
  beforeEach(() => jest.restoreAllMocks())

  it('errors when <task> is missing', async () => {
    const code = await taskArtifactUpdate(undefined, 'a1', { kind: 'plan' })
    expect(code).toBe(1)
  })

  it('errors when <artifact> is missing', async () => {
    const code = await taskArtifactUpdate('LUM-9', undefined, { kind: 'plan' })
    expect(code).toBe(1)
  })

  it('errors when no editable flag is provided', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okUpdated)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const code = await taskArtifactUpdate('LUM-9', 'a1', {})
    expect(code).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'at least one of --kind, --title, --source, or --agent'
      )
    )
  })

  it('errors on an empty-string flag value', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okUpdated)
    const code = await taskArtifactUpdate('LUM-9', 'a1', { source: '' })
    expect(code).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('PATCHes only the provided fields on success', async () => {
    const writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okUpdated)
    const code = await taskArtifactUpdate('LUM-9', 'a1', {
      kind: 'plan',
      source: 'spec-kit',
    })
    expect(code).toBeUndefined()
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toBe('https://api.test/api/tasks/LUM-9/artifacts/a1')
    expect((init as RequestInit).method).toBe('PATCH')
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent).toEqual({ kind: 'plan', source: 'spec-kit' })
    const output = writeSpy.mock.calls.map(c => c[0]).join('')
    expect(output).toContain('Updated [plan] "Spec" (spec-kit) on LUM-9')
  })

  it('returns 1 and prints the server message on 404', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(notFound)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const code = await taskArtifactUpdate('LUM-9', 'a-x', { kind: 'plan' })
    expect(code).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Artifact not found')
    )
  })

  it('sends normalized agent in the PATCH body', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okUpdated)
    const code = await taskArtifactUpdate('LUM-9', 'cma_x', { agent: 'Codex' })
    expect(code).toBeUndefined()
    const [, init] = fetchSpy.mock.calls[0]!
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent).toEqual({ agent: 'CODEX' })
  })
  it('errors on invalid --agent without calling the API', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okUpdated)
    const code = await taskArtifactUpdate('LUM-9', 'cma_x', { agent: 'devin' })
    expect(code).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
