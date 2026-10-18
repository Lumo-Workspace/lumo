/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/line-prompt', () => ({
  promptLine: jest.fn(),
}))

import {
  priorityCreate,
  priorityList,
  formatPriorityHistory,
} from '@/cli/src/commands/priority'
import { promptLine } from '@/cli/src/lib/line-prompt'

const mockPrompt = promptLine as jest.Mock

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

afterEach(() => {
  jest.restoreAllMocks()
})

const view = (id: string, statement: string, effectiveFrom: string) => ({
  id,
  statement,
  effectiveFrom,
  declaredByMemberId: 'm1',
  createdAt: effectiveFrom,
})

describe('lumo priority create <text>', () => {
  it('POSTs the given text and confirms', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        priority: view('p1', 'ship the MVP', '2026-01-01T12:00:00.000Z'),
      })
    )

    await priorityCreate('ship the MVP')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.test/api/priorities')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      statement: 'ship the MVP',
    })
    expect(init.headers.Authorization).toBe('Bearer lum_x')
    expect(stdout.join('')).toMatch(/Recorded priority: ship the MVP/)
    // No interactive prompt when text is supplied.
    expect(mockPrompt).not.toHaveBeenCalled()
  })

  it('LUM-1233 3f: blank text exits 2 with no prompt and records nothing', async () => {
    for (const blank of ['', '   ']) {
      const code = await priorityCreate(blank)
      expect(code).toBe(2)
    }
    expect(mockPrompt).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stderr.join('\n')).toMatch(/priority text is empty/i)
  })

  it('surfaces a server error message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: 'No default team found for this workspace' })
    )
    const code = await priorityCreate('x')
    expect(code).toBe(1)
    expect(stderr.join('\n')).toMatch(/No default team found/)
  })
})

describe('lumo priority list', () => {
  it('GETs and prints the append history newest-first, marking current', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        current: view('p2', 'second', '2026-02-01T12:00:00.000Z'),
        history: [
          view('p2', 'second', '2026-02-01T12:00:00.000Z'),
          view('p1', 'first', '2026-01-01T12:00:00.000Z'),
        ],
      })
    )

    await priorityList()

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.test/api/priorities')
    expect(init?.method).toBeUndefined() // GET
    const out = stdout.join('')
    expect(out.indexOf('second')).toBeLessThan(out.indexOf('first'))
    expect(out).toMatch(/\* 2026-02-01 {2}second/)
  })

  it('prints an empty-state message when nothing is declared', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { current: null, history: [] })
    )
    await priorityList()
    expect(stdout.join('')).toMatch(/No priorities declared yet/)
  })
})

describe('formatPriorityHistory', () => {
  it('marks the current row with * and others with a space', () => {
    const out = formatPriorityHistory(
      [
        view('p2', 'newer', '2026-02-01T12:00:00.000Z'),
        view('p1', 'older', '2026-01-01T12:00:00.000Z'),
      ],
      'p2'
    )
    expect(out).toBe('* 2026-02-01  newer\n  2026-01-01  older\n')
  })
})
