/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))

import { taskArtifactRm } from '@/cli/src/commands/task-artifact-rm'
import { formatHookStdoutLines } from '@/cli/src/lib/hook-runner'

describe('server-error string sanitization', () => {
  const origFetch = global.fetch
  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = origFetch
  })

  it('strips ESC from a server-returned error body before printing', async () => {
    let err = ''
    jest.spyOn(console, 'error').mockImplementation((s?: unknown) => {
      err += String(s) + '\n'
    })
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'boom\x1b[31m' }),
    })) as unknown as typeof fetch

    const code = await taskArtifactRm('LUM-9', 'a-x', { confirm: true })
    expect(code).toBe(1)
    expect(err).not.toMatch(/\x1b/)
    expect(err).toContain('boom[31m')
  })
})

describe('formatHookStdoutLines sanitization', () => {
  it('strips ESC from a server task title in the session-start line', () => {
    const lines = formatHookStdoutLines('session-start', {
      sessionId: 's1',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-42',
        taskTitle: 'Evil\x1b[2Jtitle',
      },
    })
    expect(lines.join('\n')).not.toMatch(/\x1b/)
    expect(lines[0]).toContain('LUM-42')
    expect(lines[0]).toContain('Evil[2Jtitle')
  })
})
