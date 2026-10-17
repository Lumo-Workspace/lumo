/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))

import { taskArtifactShow } from '@/cli/src/commands/task-artifact-show'

const okShow = {
  ok: true,
  status: 200,
  json: async () => ({
    artifact: {
      id: 'a1',
      kind: 'spec',
      title: 'Spec',
      source: 'claude-code',
      order: 0,
      content: '## Requirements\n- a',
    },
  }),
} as unknown as Response

const notFound = {
  ok: false,
  status: 404,
  json: async () => ({ error: 'Artifact not found' }),
} as unknown as Response

describe('taskArtifactShow', () => {
  beforeEach(() => jest.restoreAllMocks())

  it('errors when <task> is missing', async () => {
    const code = await taskArtifactShow(undefined, 'a1')
    expect(code).toBe(1)
  })

  it('errors when <artifact> is missing', async () => {
    const code = await taskArtifactShow('LUM-9', undefined)
    expect(code).toBe(1)
  })

  it('GETs the single-artifact route and prints header + content', async () => {
    const writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okShow)
    const code = await taskArtifactShow('LUM-9', 'a1')
    expect(code).toBeUndefined()
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toBe('https://api.test/api/tasks/LUM-9/artifacts/a1')
    expect((init as RequestInit | undefined)?.method).toBeUndefined()
    const output = writeSpy.mock.calls.map(c => c[0]).join('')
    expect(output).toContain('ref:    a1')
    expect(output).toContain('kind:   spec')
    expect(output).toContain('title:  Spec')
    expect(output).toContain('## Requirements')
  })

  it('returns 1 and prints the server message on 404', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(notFound)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const code = await taskArtifactShow('LUM-9', 'a-x')
    expect(code).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Artifact not found')
    )
  })

  it('prints the agent label in the header', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockReturnValue(true)
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        artifact: {
          id: 'cma_x',
          kind: 'spec',
          title: 'Spec',
          source: 'superpowers',
          agent: 'CODEX',
          order: 0,
          content: 'body',
        },
      }),
    } as unknown as Response)
    await taskArtifactShow('LUM-9', 'cma_x')
    const out = writeSpy.mock.calls.map(c => String(c[0])).join('')
    expect(out).toContain('agent:  Codex')
  })
})
