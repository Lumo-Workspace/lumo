/**
 * @jest-environment node
 *
 * LUM-500 — `lumo memory show <id>`: progressive disclosure. Fetch one
 * memory's full card by id (the agent pulls the body of a memory it saw as a
 * one-line index entry at session start).
 */
jest.mock('../src/lib/config', () => ({
  readCredentials: jest.fn(),
}))

import { readCredentials } from '../src/lib/config'
import { memoryShow } from '../src/commands/memory-show'

const mockRead = readCredentials as jest.Mock

let errorSpy: jest.SpyInstance
let logSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  mockRead.mockReturnValue({
    token: 't',
    apiUrl: 'https://x',
    workspaceSlug: 'lumo',
  })
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
  logSpy.mockRestore()
})

describe('memoryShow', () => {
  it('errors (returns 1) without an id', async () => {
    expect(await memoryShow(undefined)).toBe(2)
  })

  it('prints the category tag and content on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        memory: {
          id: 'mem_1',
          category: 'TRAP',
          content: { lesson: 'do not reach into nested props' },
        },
      }),
    }) as unknown as typeof fetch

    const exit = await memoryShow('mem_1')

    expect(exit).toBeUndefined()
    const printed = logSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(printed).toContain('[TRAP]')
    expect(printed).toContain('do not reach into nested props')
  })

  it('prints a not-found error and returns 1 on 404', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as unknown as typeof fetch

    const exit = await memoryShow('mem_missing')

    expect(exit).toBe(1)
    const message = errorSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(message).toContain('mem_missing')
    expect(message).toContain('not found')
    expect(message).toContain('lumo')
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('returns 1 with an invalid-key error on 401', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as unknown as typeof fetch

    expect(await memoryShow('mem_1')).toBe(1)
  })
})
