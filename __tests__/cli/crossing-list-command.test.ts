/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))

import { crossingList } from '@/cli/src/commands/crossing-list'
import { readCredentials } from '@/cli/src/lib/config'

const mockCreds = readCredentials as jest.Mock

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const ROWS = [
  {
    id: 'a',
    ref: 'LUM-X1',
    category: 'TEST_TAMPERING',
    severity: 'HIGH',
    detail: 'open one',
    disposition: null,
  },
  {
    id: 'b',
    ref: 'LUM-X2',
    category: 'DESTRUCTIVE_COMMAND',
    severity: 'LOW',
    detail: 'ruled one',
    disposition: 'CONFIRMED',
    dispositionNote: 'real, acknowledged',
    dispositionedAt: '2026-10-02T00:00:00.000Z',
    dispositionedById: 'actor-1',
    dispositionChannel: 'WEB',
  },
]

let writeSpy: jest.SpyInstance
let errSpy: jest.SpyInstance
const OLD_SESSION = process.env.CLAUDE_CODE_SESSION_ID

beforeEach(() => {
  jest.clearAllMocks()
  mockCreds.mockReturnValue({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })
  delete process.env.CLAUDE_CODE_SESSION_ID
  writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
  if (OLD_SESSION === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = OLD_SESSION
})

const stdout = () => writeSpy.mock.calls.map(c => c[0]).join('')
const stderr = () => errSpy.mock.calls.map(c => c.join(' ')).join('\n')

function routeFetch() {
  return jest.spyOn(global, 'fetch').mockImplementation(async url => {
    const u = String(url)
    if (u.includes('/api/workspaces/members'))
      return jsonResponse(200, {
        members: [{ id: 'm', actorId: 'actor-1', name: 'Bob' }],
        agentActors: [],
      })
    if (u.includes('/boundary-crossings'))
      return jsonResponse(200, { crossings: ROWS, gateEnabled: true })
    return jsonResponse(404, {})
  })
}

describe('crossingList command (LUM-1187)', () => {
  it('errors when not logged in', async () => {
    mockCreds.mockReturnValue(null)
    expect(await crossingList('LUM-9')).toBe(1)
    expect(stderr()).toContain('not logged in')
  })

  it('errors with guidance when no task is given and no session is bound', async () => {
    expect(await crossingList(undefined)).toBe(1)
    expect(stderr()).toContain('lumo crossing list <LUM-N>')
  })

  it('lists open rows by default and the ruling history with --all', async () => {
    routeFetch()
    expect(await crossingList('LUM-9')).toBeUndefined()
    expect(stdout()).toContain('LUM-X1')
    expect(stdout()).not.toContain('LUM-X2')

    writeSpy.mockClear()
    expect(await crossingList('LUM-9', { all: true })).toBeUndefined()
    expect(stdout()).toContain('LUM-X2')
    expect(stdout()).toMatch(/Ruled by:\s+Bob \(actor-1\)/)
    expect(stdout()).toMatch(/Note:\s+real, acknowledged/)
    expect(stdout()).toMatch(/Channel:\s+WEB/)
  })

  it('--json emits the raw rows, filtered by --all', async () => {
    routeFetch()
    await crossingList('LUM-9', { json: true })
    const open = JSON.parse(stdout()) as { crossings: Array<{ id: string }> }
    expect(open.crossings.map(c => c.id)).toEqual(['a'])

    writeSpy.mockClear()
    await crossingList('LUM-9', { json: true, all: true })
    const all = JSON.parse(stdout()) as {
      task: string
      gateEnabled: boolean
      crossings: Array<{ id: string }>
    }
    expect(all.task).toBe('LUM-9')
    expect(all.gateEnabled).toBe(true)
    expect(all.crossings.map(c => c.id)).toEqual(['a', 'b'])
  })

  it('reports a missing task and a failed read with exit 1', async () => {
    const spy = jest.spyOn(global, 'fetch')
    spy.mockResolvedValueOnce(jsonResponse(404, {}))
    expect(await crossingList('LUM-404')).toBe(1)
    expect(stderr()).toContain('task LUM-404 not found')
    spy.mockResolvedValueOnce(jsonResponse(500, {}))
    expect(await crossingList('LUM-9')).toBe(1)
    expect(stderr()).toContain('could not read boundary crossings (HTTP 500)')
  })
})
