/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({ readCredentials: jest.fn() }))

import {
  initiativeCreate,
  initiativeList,
  formatCreatedInitiativeLine,
  formatInitiativeList,
} from '@/cli/src/commands/initiative'
import { readCredentials } from '@/cli/src/lib/config'

const mockCreds = readCredentials as jest.Mock

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** Body of the last fetch() call, parsed. */
function lastBody(): Record<string, unknown> {
  const call = (global.fetch as jest.Mock).mock.calls[0]
  return JSON.parse((call[1] as RequestInit).body as string)
}

let writeSpy: jest.SpyInstance
let errSpy: jest.SpyInstance
const OLD_API_URL = process.env.LUMO_API_URL

beforeEach(() => {
  jest.clearAllMocks()
  mockCreds.mockReturnValue({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })
  delete process.env.LUMO_API_URL
  writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  global.fetch = jest.fn()
})

afterEach(() => {
  writeSpy.mockRestore()
  errSpy.mockRestore()
  if (OLD_API_URL) process.env.LUMO_API_URL = OLD_API_URL
})

describe('formatCreatedInitiativeLine', () => {
  it('echoes the LUM-INIT-<n> id', () => {
    expect(formatCreatedInitiativeLine({ identifier: 'LUM-INIT-3' })).toBe(
      '✓ Initiative LUM-INIT-3 created'
    )
  })
})

describe('formatInitiativeList', () => {
  it('renders aligned id / status / goal lines', () => {
    const out = formatInitiativeList([
      { identifier: 'LUM-INIT-2', status: 'ACTIVE', name: 'Ship it' },
      { identifier: 'LUM-INIT-1', status: 'COMPLETED', name: 'Idea pool' },
    ])
    expect(out).toContain('LUM-INIT-2')
    expect(out).toContain('ACTIVE')
    expect(out).toContain('Ship it')
  })

  it('prints a friendly line for an empty list', () => {
    expect(formatInitiativeList([])).toBe('No initiatives.\n')
  })
})

describe('lumo initiative create', () => {
  it('POSTs the goal (+ assumption) and prints the created id', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(201, { initiative: { identifier: 'LUM-INIT-3' } })
    )

    const code = await initiativeCreate('Ship the surface', {
      assumption: 'teams curate directly',
    })

    expect(code).toBeUndefined()
    const body = lastBody()
    expect(body.name).toBe('Ship the surface')
    expect(body.assumptionNote).toBe('teams curate directly')
    // POST to the initiatives collection endpoint.
    const call = (global.fetch as jest.Mock).mock.calls[0]
    expect(call[0]).toBe('https://api.test/api/initiatives')
    expect((call[1] as RequestInit).method).toBe('POST')
    expect(writeSpy).toHaveBeenCalledWith('✓ Initiative LUM-INIT-3 created\n')
  })

  it('omits assumptionNote when --assumption is absent', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(201, { initiative: { identifier: 'LUM-INIT-4' } })
    )
    await initiativeCreate('Lone goal', {})
    expect('assumptionNote' in lastBody()).toBe(false)
  })

  it('rejects a blank goal without hitting the network', async () => {
    const code = await initiativeCreate('   ', {})
    expect(code).toBe(1)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('reports a server error body', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(404, { error: 'No default team for workspace' })
    )
    const code = await initiativeCreate('x', {})
    expect(code).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('No default team for workspace')
    )
  })
})

describe('lumo initiative list', () => {
  it('GETs the initiatives endpoint and prints the rows', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(200, {
        initiatives: [
          {
            identifier: 'LUM-INIT-2',
            status: 'ACTIVE',
            name: 'Ship it',
          },
        ],
      })
    )

    const code = await initiativeList()

    expect(code).toBeUndefined()
    const call = (global.fetch as jest.Mock).mock.calls[0]
    expect(call[0]).toBe('https://api.test/api/initiatives')
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('LUM-INIT-2'))
  })
})
