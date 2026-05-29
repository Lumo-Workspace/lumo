/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/doc-input', () => ({
  readFileUtf8: jest.fn(async () => '## Requirements\n- a'),
}))

import { taskArtifactAdd } from '@/cli/src/commands/task-artifact-add'

const okCreated = {
  ok: true,
  status: 201,
  json: async () => ({ artifact: { id: 'a1', kind: 'spec', title: 'Spec' } }),
} as unknown as Response

describe('taskArtifactAdd', () => {
  beforeEach(() => jest.restoreAllMocks())

  it('errors when --kind is missing', async () => {
    const code = await taskArtifactAdd('LUM-9', {
      title: 'Spec',
      file: 'f.md',
      source: 'superpowers',
    })
    expect(code).toBe(1)
  })

  it('errors when --source is missing', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okCreated)
    const code = await taskArtifactAdd('LUM-9', {
      kind: 'spec',
      title: 'Spec',
      file: 'f.md',
    })
    expect(code).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs to the artifacts route with kind/title/content/source', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okCreated)
    const code = await taskArtifactAdd('LUM-9', {
      kind: 'spec',
      title: 'Spec',
      file: 'f.md',
      source: 'superpowers',
    })
    expect(code).toBeUndefined()
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toBe('https://api.test/api/tasks/LUM-9/artifacts')
    expect((init as RequestInit).method).toBe('POST')
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent).toEqual({
      kind: 'spec',
      title: 'Spec',
      content: '## Requirements\n- a',
      source: 'superpowers',
    })
  })
})
