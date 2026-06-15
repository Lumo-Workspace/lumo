/**
 * @jest-environment node
 *
 * LUM-505 — a title-only `lumo doc update <id> --title "X"` (no content
 * channel) must PATCH only the title. In a non-TTY shell with nothing piped,
 * the stdin read returns empty; the old behaviour shipped that empty string
 * as `contentMarkdown`, blanking the body and tripping the structure guard
 * (422 table N→0). The body must omit `contentMarkdown` entirely so the
 * stored body is untouched.
 *
 * The real `resolveDocContent` runs here; only the stdin reader is stubbed to
 * an empty read (the agent/CI no-pipe case) so the test doesn't hang.
 */
jest.mock('../../src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('../../src/lib/resolve-doc-id', () => ({
  lookupDocId: jest.fn(),
}))
jest.mock('../../src/lib/doc-input', () => {
  const actual = jest.requireActual('../../src/lib/doc-input')
  return { ...actual, readStdinToString: jest.fn(async () => '') }
})

import { readCredentials } from '../../src/lib/config'
import { lookupDocId } from '../../src/lib/resolve-doc-id'
import { docUpdate } from '../../src/commands/doc-update'

const mockRead = readCredentials as jest.Mock
const mockLookup = lookupDocId as jest.Mock

function mockFetchOk(document: Record<string, unknown>) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ document }),
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function sentBody(fetchMock: jest.Mock): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[0]![1].body as string)
}

let errorSpy: jest.SpyInstance
let logSpy: jest.SpyInstance
let origIsTTY: unknown

beforeEach(() => {
  jest.clearAllMocks()
  mockRead.mockReturnValue({
    token: 't',
    apiUrl: 'https://x',
    workspaceSlug: 'lumo',
  })
  mockLookup.mockResolvedValue('cmd_1')
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  // Simulate a non-TTY shell (agent/CI) — the regression only reproduces here.
  origIsTTY = process.stdin.isTTY
  Object.defineProperty(process.stdin, 'isTTY', {
    value: false,
    configurable: true,
  })
})

afterEach(() => {
  errorSpy.mockRestore()
  logSpy.mockRestore()
  Object.defineProperty(process.stdin, 'isTTY', {
    value: origIsTTY,
    configurable: true,
  })
})

describe('doc update --title only (LUM-505)', () => {
  it('LUM-505 title-only doc update omits contentMarkdown from the PATCH body', async () => {
    const fetchMock = mockFetchOk({ id: 'cmd_1', slug: 'd-1', title: 'New' })

    const exit = await docUpdate('cmd_1', { title: 'New' })

    expect(exit).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = sentBody(fetchMock)
    expect(body).not.toHaveProperty('contentMarkdown')
    expect(body).toEqual({ title: 'New' })
  })
})
