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
  unreadableFileMessage: jest.requireActual('@/cli/src/lib/doc-input')
    .unreadableFileMessage,
}))
jest.mock('@/cli/src/lib/path-guard', () => ({
  checkArtifactFilePath: jest.fn(() => ({ ok: true, resolved: '/proj/f.md' })),
}))

import { taskArtifactAdd } from '@/cli/src/commands/task-artifact-add'
import { checkArtifactFilePath } from '@/cli/src/lib/path-guard'

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
    expect(code).toBe(2)
  })

  it('errors when --source is missing', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okCreated)
    const code = await taskArtifactAdd('LUM-9', {
      kind: 'spec',
      title: 'Spec',
      file: 'f.md',
    })
    expect(code).toBe(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs to the artifacts route with kind/title/content/source', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okCreated)
    const code = await taskArtifactAdd('LUM-9', {
      kind: 'spec',
      title: 'Spec',
      file: 'f.md',
      source: 'superpowers',
      agent: 'claude-code',
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
      agent: 'CLAUDE_CODE',
    })
  })

  it('errors when --agent is missing', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okCreated)
    const code = await taskArtifactAdd('LUM-9', {
      kind: 'spec',
      title: 'Spec',
      file: 'f.md',
      source: 'superpowers',
    })
    expect(code).toBe(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('errors on an invalid --agent without calling the API', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okCreated)
    const code = await taskArtifactAdd('LUM-9', {
      kind: 'spec',
      title: 'Spec',
      file: 'f.md',
      source: 'superpowers',
      agent: 'devin',
    })
    expect(code).toBe(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses a sensitive --file and never calls the API', async () => {
    ;(checkArtifactFilePath as jest.Mock).mockReturnValueOnce({
      ok: false,
      reason: 'sensitive',
      detail: 'matches .env',
    })
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okCreated)
    const code = await taskArtifactAdd('LUM-9', {
      kind: 'spec',
      title: 'Spec',
      file: '../../secret.env',
      source: 'superpowers',
      agent: 'claude-code',
    })
    expect(code).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects an outside-project --file with the security message and no API call', async () => {
    ;(checkArtifactFilePath as jest.Mock).mockReturnValueOnce({
      ok: false,
      reason: 'outside-project',
      detail: 'resolves outside project directory',
    })
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okCreated)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const code = await taskArtifactAdd('LUM-9', {
      kind: 'spec',
      title: 'Spec',
      file: '/etc/passwd',
      source: 'superpowers',
      agent: 'claude-code',
    })
    expect(code).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing to read')
    )
  })

  it('maps an unreadable verdict to the plain "could not read file" message', async () => {
    ;(checkArtifactFilePath as jest.Mock).mockReturnValueOnce({
      ok: false,
      reason: 'unreadable',
      detail: 'path does not resolve',
    })
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okCreated)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const code = await taskArtifactAdd('LUM-9', {
      kind: 'spec',
      title: 'Spec',
      file: 'missing.md',
      source: 'superpowers',
      agent: 'claude-code',
    })
    expect(code).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('could not read file')
    )
  })
})
