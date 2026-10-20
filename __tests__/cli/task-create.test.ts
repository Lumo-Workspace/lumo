/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))

jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => process.env.CLAUDE_CODE_SESSION_ID,
  AmbiguousSessionError: class extends Error {},
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

describe('task create — rework/new-scope flags', () => {
  it('sends reworkOfRef in the body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { task: created }))
    await taskCreate('fix color', { reworkOf: 'LUM-7' })
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init!.body as string)).toMatchObject({
      reworkOfRef: 'LUM-7',
    })
  })

  it('sends newScope:true in the body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { task: created }))
    await taskCreate('new thing', { newScope: true })
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init!.body as string)).toMatchObject({ newScope: true })
  })

  it('does not send reworkOfRef/newScope when neither flag is passed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { task: created }))
    await taskCreate('plain', {})
    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse(init!.body as string)
    expect(body.reworkOfRef).toBeUndefined()
    expect(body.newScope).toBeUndefined()
  })

  it('prints the server 409 message on stderr and returns nonzero', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: 'This belongs on LUM-7. Either fix it in place...',
      })
    )
    const code = await taskCreate('fix color', { reworkOf: 'LUM-7' })
    expect(code).toBe(1)
    expect(stderr.join('\n')).toMatch(/This belongs on LUM-7/)
  })
})

describe('task create — duplicate gate (LUM-1286)', () => {
  const dupBody = {
    error: 'Possible duplicates',
    code: 'POSSIBLE_DUPLICATES',
    duplicates: [
      {
        identifier: 'LUM-12',
        title: 'Add Google OAuth login',
        status: 'IN_PROGRESS',
        score: 0.9,
        url: 'https://app/LUM-12',
      },
    ],
  }

  it('emits a confirmation envelope listing candidates and exits 4', async () => {
    const argv = process.argv
    process.argv = ['node', 'lumo', 'task', 'create', 'Google OAuth sign-in']
    try {
      fetchMock.mockResolvedValueOnce(jsonResponse(409, dupBody))
      const code = await taskCreate('Google OAuth sign-in', {})
      expect(code).toBe(4)
    } finally {
      process.argv = argv
    }
    const envelope = JSON.parse(stdout.join(''))
    expect(envelope).toMatchObject({
      status: 'confirmation_required',
      command: 'task create',
      confirmCommand: "lumo task create 'Google OAuth sign-in' --confirm",
    })
    const changes = envelope.changes.join('\n')
    expect(changes).toMatch(/LUM-12/)
    expect(changes).toMatch(/Add Google OAuth login/)
    expect(changes).toMatch(/https:\/\/app\/LUM-12/)
    expect(changes).toMatch(/not created/i)
    expect(stderr).toEqual([])
  })

  it('sends confirmDuplicates only with --confirm', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { task: created }))

    await taskCreate('New task', {})
    expect(
      JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).confirmDuplicates
    ).toBeUndefined()

    await taskCreate('New task', { confirm: true })
    expect(
      JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).confirmDuplicates
    ).toBe(true)
  })
})
