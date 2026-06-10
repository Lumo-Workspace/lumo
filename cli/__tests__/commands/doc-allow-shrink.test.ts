/**
 * @jest-environment node
 *
 * LUM-410 — `--allow-shrink` on `lumo doc update` / `lumo doc patch`.
 *
 * The flag passes `allowShrink: true` through to the API; without it a
 * structure-guard rejection (422) is rendered with the server's per-category
 * shrink detail plus a hint to re-run with --allow-shrink when the deletion
 * is intentional.
 */
jest.mock('../../src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('../../src/lib/resolve-doc-id', () => ({
  lookupDocId: jest.fn(),
}))

import { readCredentials } from '../../src/lib/config'
import { lookupDocId } from '../../src/lib/resolve-doc-id'
import { docUpdate } from '../../src/commands/doc-update'
import { docPatch } from '../../src/commands/doc-section-edit'

const mockRead = readCredentials as jest.Mock
const mockLookup = lookupDocId as jest.Mock

const GUARD_MESSAGE =
  "Structure guard: this update shrinks the stored document's structure (table 1→0, tr 2→0)."

function mockFetchOk(document: Record<string, unknown>) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ document }),
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function mockFetch422(error: string) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: false,
    status: 422,
    statusText: 'Unprocessable Entity',
    text: async () => JSON.stringify({ error }),
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function sentBody(fetchMock: jest.Mock): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[0]![1].body as string)
}

let errorSpy: jest.SpyInstance
let logSpy: jest.SpyInstance

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
})

afterEach(() => {
  errorSpy.mockRestore()
  logSpy.mockRestore()
})

describe('doc update --allow-shrink', () => {
  it('passes allowShrink: true through to the API body', async () => {
    const fetchMock = mockFetchOk({ id: 'cmd_1', slug: 'd-1', title: 'D' })

    const exit = await docUpdate('cmd_1', {
      content: 'prose only',
      allowShrink: true,
    })

    expect(exit).toBeUndefined()
    expect(sentBody(fetchMock)).toMatchObject({
      contentMarkdown: 'prose only',
      allowShrink: true,
    })
  })

  it('omits allowShrink from the body when the flag is not passed', async () => {
    const fetchMock = mockFetchOk({ id: 'cmd_1', slug: 'd-1', title: 'D' })

    await docUpdate('cmd_1', { content: 'prose only' })

    expect(sentBody(fetchMock)).not.toHaveProperty('allowShrink')
  })

  it('renders a 422 guard rejection with the shrink detail and an --allow-shrink hint', async () => {
    mockFetch422(GUARD_MESSAGE)

    const exit = await docUpdate('cmd_1', { content: 'prose only' })

    expect(exit).toBe(1)
    const all = errorSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(all).toContain('table 1→0, tr 2→0')
    expect(all).toContain('--allow-shrink')
    expect(all).toContain('lumo doc show cmd_1 --raw')
  })

  it('--allow-shrink alone is not an update (no fields)', async () => {
    const fetchMock = mockFetchOk({ id: 'cmd_1', slug: 'd-1', title: 'D' })

    // Interactive shell: no --content/--file and no piped stdin.
    const origIsTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    })
    try {
      const exit = await docUpdate('cmd_1', { allowShrink: true })
      expect(exit).toBe(1)
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: origIsTTY,
        configurable: true,
      })
    }

    expect(fetchMock).not.toHaveBeenCalled()
    const all = errorSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(all).toContain('no fields to update')
  })
})

describe('doc patch --allow-shrink', () => {
  it('passes allowShrink: true through to the section API body', async () => {
    const fetchMock = mockFetchOk({
      id: 'cmd_1',
      title: 'D',
      contentRevision: 5,
      sectionHeading: 'A queue',
    })

    const exit = await docPatch('cmd_1', {
      section: 'A queue',
      content: '## A queue\n\nemptied',
      allowShrink: true,
    })

    expect(exit).toBeUndefined()
    expect(sentBody(fetchMock)).toMatchObject({
      mode: 'replace',
      section: 'A queue',
      allowShrink: true,
    })
  })

  it('omits allowShrink when the flag is not passed', async () => {
    const fetchMock = mockFetchOk({
      id: 'cmd_1',
      title: 'D',
      contentRevision: 5,
      sectionHeading: 'A queue',
    })

    await docPatch('cmd_1', { section: 'A queue', content: 'x' })

    expect(sentBody(fetchMock)).not.toHaveProperty('allowShrink')
  })

  it('renders a 422 guard rejection with the shrink detail and an --allow-shrink hint', async () => {
    mockFetch422(
      "Structure guard: this update shrinks the addressed section's structure (table 1→0, tr 2→0)."
    )

    const exit = await docPatch('cmd_1', { section: 'A queue', content: 'x' })

    expect(exit).toBe(1)
    const all = errorSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(all).toContain('table 1→0, tr 2→0')
    expect(all).toContain('--allow-shrink')
    expect(all).toContain('--section "A queue"')
  })
})
