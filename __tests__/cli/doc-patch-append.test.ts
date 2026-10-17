/**
 * @jest-environment node
 *
 * LUM-409 — the CLI side of the section-edit + optimistic-concurrency loop:
 * `doc patch` / `doc append` post section edits, `doc update` carries
 * --if-revision, and a 409 conflict prints a re-read-and-retry hint and
 * exits 1.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('@/cli/src/lib/resolve-doc-id', () => ({
  lookupDocId: jest.fn(),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { lookupDocId } from '@/cli/src/lib/resolve-doc-id'
import {
  docPatch,
  docAppend,
  formatSectionEditLine,
} from '@/cli/src/commands/doc-section-edit'
import { docUpdate } from '@/cli/src/commands/doc-update'

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

function mockFetchError(status: number, errorMessage: string) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: status === 409 ? 'Conflict' : 'Error',
    text: async () => JSON.stringify({ error: errorMessage }),
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
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

function stderrText(): string {
  return errorSpy.mock.calls.map(c => c.join(' ')).join('\n')
}

describe('doc patch', () => {
  it('posts a replace section edit and prints the new revision', async () => {
    const fetchMock = mockFetchOk({
      id: 'cmd_1',
      title: 'Ledger',
      contentRevision: 5,
      sectionHeading: 'A queue',
    })

    const exit = await docPatch('cmd_1', {
      section: 'A queue',
      content: '## A queue\n\nnew body\n',
      ifRevision: '4',
    })

    expect(exit).toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://x/api/documents/cmd_1/section')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      mode: 'replace',
      section: 'A queue',
      contentMarkdown: '## A queue\n\nnew body\n',
      ifRevision: 4,
    })
    expect(logSpy.mock.calls[0]![0]).toContain('Patched cmd_1')
    expect(logSpy.mock.calls[0]![0]).toContain('revision 5')
  })

  it('requires --section', async () => {
    const fetchMock = mockFetchOk({})
    const exit = await docPatch('cmd_1', { content: 'x' })
    expect(exit).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stderrText()).toContain('--section')
  })

  it('requires content from --content/--file/stdin', async () => {
    const fetchMock = mockFetchOk({})
    const realIsTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    })
    try {
      const exit = await docPatch('cmd_1', { section: 'A queue' })
      expect(exit).toBe(1)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(stderrText()).toContain('needs content')
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: realIsTTY,
        configurable: true,
      })
    }
  })

  it('rejects a non-integer --if-revision before any network call', async () => {
    const fetchMock = mockFetchOk({})
    const exit = await docPatch('cmd_1', {
      section: 'A',
      content: 'x',
      ifRevision: 'abc',
    })
    expect(exit).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stderrText()).toContain('--if-revision')
  })

  it('409 conflict prints the server reason plus a re-read-and-retry hint and exits 1', async () => {
    mockFetchError(
      409,
      'Revision conflict: the document body changed since your copy was read (current revision: 6, your base: 4).'
    )

    const exit = await docPatch('cmd_1', {
      section: 'A queue',
      content: 'x',
      ifRevision: '4',
    })

    expect(exit).toBe(1)
    const msg = stderrText()
    expect(msg).toContain('revision conflict')
    expect(msg).toContain('current revision: 6')
    expect(msg).toContain('--if-revision')
    expect(msg).toContain('lumo doc show')
  })
})

describe('doc append', () => {
  it('posts an append section edit (section optional → document end)', async () => {
    const fetchMock = mockFetchOk({
      id: 'cmd_1',
      title: 'Ledger',
      contentRevision: 6,
      sectionHeading: null,
    })

    const exit = await docAppend('cmd_1', { content: '## New entry\n\nrow' })

    expect(exit).toBeUndefined()
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body).toEqual({
      mode: 'append',
      contentMarkdown: '## New entry\n\nrow',
    })
    expect(logSpy.mock.calls[0]![0]).toContain('Appended to cmd_1')
    expect(logSpy.mock.calls[0]![0]).toContain('document end')
    expect(logSpy.mock.calls[0]![0]).toContain('revision 6')
  })

  it('targets a section when --section is given', async () => {
    const fetchMock = mockFetchOk({
      id: 'cmd_1',
      title: 'Ledger',
      contentRevision: 6,
      sectionHeading: 'A queue',
    })

    const exit = await docAppend('cmd_1', {
      section: 'A queue',
      content: '| y | open |',
      ifRevision: '5',
    })

    expect(exit).toBeUndefined()
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body).toEqual({
      mode: 'append',
      section: 'A queue',
      contentMarkdown: '| y | open |',
      ifRevision: 5,
    })
    expect(logSpy.mock.calls[0]![0]).toContain('§ "A queue"')
  })

  it('409 conflict prints the retry hint and exits 1', async () => {
    mockFetchError(409, 'Revision conflict (current revision: 8).')

    const exit = await docAppend('cmd_1', {
      section: 'A queue',
      content: 'x',
      ifRevision: '7',
    })

    expect(exit).toBe(1)
    expect(stderrText()).toContain('revision conflict')
    expect(stderrText()).toContain('--if-revision')
  })
})

describe('doc update --if-revision', () => {
  it('sends ifRevision with the PATCH body', async () => {
    const fetchMock = mockFetchOk({
      id: 'cmd_1',
      slug: 'ledger-7',
      title: 'Ledger',
    })

    const exit = await docUpdate('cmd_1', {
      content: '# full new body',
      ifRevision: '4',
    })

    expect(exit).toBeUndefined()
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.contentMarkdown).toBe('# full new body')
    expect(body.ifRevision).toBe(4)
  })

  it('--if-revision alone is not an update', async () => {
    const fetchMock = mockFetchOk({})
    const realIsTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    })
    try {
      const exit = await docUpdate('cmd_1', { ifRevision: '4' })
      expect(exit).toBe(1)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(stderrText()).toContain('no fields to update')
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: realIsTTY,
        configurable: true,
      })
    }
  })

  it('409 prints the conflict + retry hint and exits 1', async () => {
    mockFetchError(
      409,
      'Revision conflict: the document body changed (current revision: 9, your base: 4).'
    )

    const exit = await docUpdate('cmd_1', {
      content: '# stale body',
      ifRevision: '4',
    })

    expect(exit).toBe(1)
    const msg = stderrText()
    expect(msg).toContain('revision conflict')
    expect(msg).toContain('current revision: 9')
    expect(msg).toContain('--if-revision')
  })
})

describe('formatSectionEditLine', () => {
  it('escapes the title and renders the section target', () => {
    expect(
      formatSectionEditLine({
        verb: 'Patched',
        id: 'cmd_1',
        title: 'A "quoted" doc',
        sectionHeading: 'B notes',
        revision: 3,
      })
    ).toBe('Patched cmd_1 "A \\"quoted\\" doc" § "B notes"  revision 3')
  })

  it('renders document-end appends and a missing revision gracefully', () => {
    expect(
      formatSectionEditLine({
        verb: 'Appended to',
        id: 'cmd_1',
        title: 'Doc',
        sectionHeading: null,
        revision: null,
      })
    ).toBe('Appended to cmd_1 "Doc" (document end)')
  })
})
