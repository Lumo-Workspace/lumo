/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({ readCredentials: jest.fn() }))
jest.mock('@/cli/src/lib/resolve-bound-task', () => ({
  resolveBoundTaskIdentifier: jest.fn(),
}))

jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => process.env.CLAUDE_CODE_SESSION_ID,
  AmbiguousSessionError: class extends Error {},
}))

import {
  ideaCapture,
  ideaUpdate,
  formatCapturedIdeaLine,
} from '@/cli/src/commands/idea'
import { readCredentials } from '@/cli/src/lib/config'
import { resolveBoundTaskIdentifier } from '@/cli/src/lib/resolve-bound-task'

const mockCreds = readCredentials as jest.Mock
const mockResolveTask = resolveBoundTaskIdentifier as jest.Mock

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** Body of the last fetch() POST, parsed. */
function lastPostBody(): Record<string, unknown> {
  const call = (global.fetch as jest.Mock).mock.calls[0]
  return JSON.parse((call[1] as RequestInit).body as string)
}

let writeSpy: jest.SpyInstance
let errSpy: jest.SpyInstance
const OLD_SESSION = process.env.CLAUDE_CODE_SESSION_ID
const OLD_API_URL = process.env.LUMO_API_URL

beforeEach(() => {
  jest.clearAllMocks()
  mockCreds.mockReturnValue({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })
  delete process.env.CLAUDE_CODE_SESSION_ID
  delete process.env.LUMO_API_URL
  writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  global.fetch = jest.fn()
})

afterEach(() => {
  writeSpy.mockRestore()
  errSpy.mockRestore()
  if (OLD_SESSION) process.env.CLAUDE_CODE_SESSION_ID = OLD_SESSION
  if (OLD_API_URL) process.env.LUMO_API_URL = OLD_API_URL
})

describe('formatCapturedIdeaLine', () => {
  it('echoes the I-prefixed human-referenceable id', () => {
    expect(formatCapturedIdeaLine({ identifier: 'LUM-I42' })).toBe(
      '✓ 想法 LUM-I42 已入池'
    )
  })
})

describe('lumo idea', () => {
  it('posts carrying the session id and the resolved bound task', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
    mockResolveTask.mockResolvedValue('LUM-9')
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(201, { idea: { identifier: 'LUM-I3' } })
    )

    const code = await ideaCapture('automate the pool', {})

    expect(code).toBeUndefined()
    const body = lastPostBody()
    expect(body.statement).toBe('automate the pool')
    expect(body.sourceSessionId).toBe('sess-1')
    expect(body.sourceTaskId).toBe('LUM-9')
    expect(writeSpy).toHaveBeenCalledWith('✓ 想法 LUM-I3 已入池\n')
  })

  it('captures with sourceTaskId null when no task is bound', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-2'
    mockResolveTask.mockResolvedValue(null)
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(201, { idea: { identifier: 'LUM-I4' } })
    )

    const code = await ideaCapture('lone idea', {})

    expect(code).toBeUndefined()
    const body = lastPostBody()
    expect(body.sourceSessionId).toBe('sess-2')
    expect('sourceTaskId' in body).toBe(false)
    expect(writeSpy).toHaveBeenCalledWith('✓ 想法 LUM-I4 已入池\n')
  })

  it('passes --context through as sourceContext', async () => {
    mockResolveTask.mockResolvedValue(null)
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(201, { idea: { identifier: 'LUM-I5' } })
    )

    await ideaCapture('idea with origin', { context: 'from standup' })

    expect(lastPostBody().sourceContext).toBe('from standup')
  })

  it('rejects a blank statement without hitting the network', async () => {
    const code = await ideaCapture('   ', {})
    expect(code).toBe(1)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('reports a server error body', async () => {
    mockResolveTask.mockResolvedValue(null)
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(404, { error: 'No default team for workspace' })
    )

    const code = await ideaCapture('x', {})

    expect(code).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('No default team for workspace')
    )
  })
})

describe('lumo idea update', () => {
  it('PATCHes the idea with the upper-cased status and echoes the new state', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(200, {
        idea: { identifier: 'LUM-I8', status: 'DEVELOPING' },
      })
    )

    const code = await ideaUpdate('LUM-I8', { status: 'developing' })

    expect(code).toBeUndefined()
    const call = (global.fetch as jest.Mock).mock.calls[0]
    expect(call[0]).toBe('https://api.test/api/ideas/LUM-I8')
    expect((call[1] as RequestInit).method).toBe('PATCH')
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      status: 'DEVELOPING',
    })
    expect(writeSpy).toHaveBeenCalledWith('✓ 想法 LUM-I8 → DEVELOPING\n')
  })

  it('rejects a missing --status without hitting the network', async () => {
    const code = await ideaUpdate('LUM-I8', {})
    expect(code).toBe(1)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects an invalid status value without hitting the network', async () => {
    const code = await ideaUpdate('LUM-I8', { status: 'archived' })
    expect(code).toBe(1)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a missing <id> without hitting the network', async () => {
    const code = await ideaUpdate('  ', { status: 'dropped' })
    expect(code).toBe(1)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('surfaces a server error body (illegal transition)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(400, {
        error: 'Cannot move LUM-I8 from DROPPED to CAPTURED',
      })
    )

    const code = await ideaUpdate('LUM-I8', { status: 'captured' })

    expect(code).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Cannot move LUM-I8 from DROPPED to CAPTURED')
    )
  })
})
