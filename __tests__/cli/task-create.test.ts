/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))

import { taskCreate } from '@/cli/src/commands/task-create'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CLAUDE_CODE_SESSION_ID
  stdout = []
  stderr = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    stdout.push(String(s))
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((...a) => {
    stderr.push(a.join(' '))
  })
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

const created = {
  id: 't-1',
  identifier: 'LUM-9',
  title: 'New task',
  url: 'https://app/LUM-9',
  teamId: 'team-1',
  taskTags: [],
}

describe('task create — session header', () => {
  it('sends X-Lumo-Session-Id when CLAUDE_CODE_SESSION_ID is set', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-123'
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { task: created }))

    await taskCreate('New task', {})

    const [, init] = fetchMock.mock.calls[0]!
    expect((init!.headers as Record<string, string>)['X-Lumo-Session-Id']).toBe(
      'sess-123'
    )
  })

  it('omits X-Lumo-Session-Id when the env var is absent', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { task: created }))

    await taskCreate('New task', {})

    const [, init] = fetchMock.mock.calls[0]!
    expect(
      (init!.headers as Record<string, string>)['X-Lumo-Session-Id']
    ).toBeUndefined()
  })
})
