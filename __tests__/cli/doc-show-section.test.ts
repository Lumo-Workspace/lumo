/**
 * @jest-environment node
 *
 * LUM-409 — `lumo doc show --section <heading>`: byte-faithful slice of one
 * section of the stored markdown source. Same no-fallback rule as --raw:
 * no stored source → hard error, never the lossy rendered output.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('@/cli/src/lib/resolve-doc-id', () => ({
  lookupDocId: jest.fn(),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { lookupDocId } from '@/cli/src/lib/resolve-doc-id'
import { docShow } from '@/cli/src/commands/doc-show'

const mockRead = readCredentials as jest.Mock
const mockLookup = lookupDocId as jest.Mock

const SOURCE = [
  '# Ledger',
  '',
  'intro',
  '',
  '## A queue',
  '',
  '| item | state |',
  '| ---- | ----- |',
  '| x    | open  |',
  '',
  '### A sub',
  '',
  'sub body',
  '',
  '## B notes',
  '',
  'note body',
  '',
].join('\n')

// The full "A queue" section: heading line through (not including) "## B notes",
// subsections included.
const A_SECTION = SOURCE.slice(
  SOURCE.indexOf('## A queue'),
  SOURCE.indexOf('## B notes')
)

function mockDocumentResponse(document: Record<string, unknown>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ document }),
  }) as unknown as typeof fetch
}

let stdoutSpy: jest.SpyInstance
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
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  stdoutSpy.mockRestore()
  errorSpy.mockRestore()
  logSpy.mockRestore()
})

function stderrText(): string {
  return errorSpy.mock.calls.map(c => c.join(' ')).join('\n')
}

describe('doc show --section', () => {
  it('prints exactly the addressed section (byte-faithful, subsections included), revision on stderr', async () => {
    mockDocumentResponse({
      id: 'cmd_1',
      title: 'Ledger',
      sourceMarkdown: SOURCE,
      contentRevision: 9,
    })

    const exit = await docShow('cmd_1', { section: 'A queue' })

    expect(exit).toBeUndefined()
    expect(stdoutSpy).toHaveBeenCalledTimes(1)
    expect(stdoutSpy.mock.calls[0]![0]).toBe(A_SECTION)
    expect(stdoutSpy.mock.calls[0]![0]).toContain('### A sub')
    // No header on stdout — the slice is a legal patch base.
    expect(logSpy).not.toHaveBeenCalled()
    expect(stderrText()).toContain('Revision: 9')
  })

  it('a #-prefixed query pins the heading depth', async () => {
    mockDocumentResponse({
      id: 'cmd_1',
      title: 'Ledger',
      sourceMarkdown: SOURCE,
      contentRevision: 9,
    })

    const exit = await docShow('cmd_1', { section: '### A sub' })

    expect(exit).toBeUndefined()
    expect(stdoutSpy.mock.calls[0]![0]).toBe('### A sub\n\nsub body\n\n')
  })

  it('missing section fails with exit 1 listing the available headings', async () => {
    mockDocumentResponse({
      id: 'cmd_1',
      title: 'Ledger',
      sourceMarkdown: SOURCE,
      contentRevision: 9,
    })

    const exit = await docShow('cmd_1', { section: 'Nope' })

    expect(exit).toBe(1)
    expect(stdoutSpy).not.toHaveBeenCalled()
    const msg = stderrText()
    expect(msg).toContain('section not found')
    expect(msg).toContain('## A queue')
    expect(msg).toContain('## B notes')
  })

  it('ambiguous heading fails with exit 1 and a depth-disambiguation hint', async () => {
    mockDocumentResponse({
      id: 'cmd_1',
      title: 'Dup',
      sourceMarkdown: '# Dup\n\na\n\n## Dup\n\nb\n',
      contentRevision: 2,
    })

    const exit = await docShow('cmd_1', { section: 'Dup' })

    expect(exit).toBe(1)
    expect(stdoutSpy).not.toHaveBeenCalled()
    const msg = stderrText()
    expect(msg).toContain('ambiguous')
    expect(msg).toContain('Disambiguate by depth')
  })

  it('no stored markdown source fails closed with the rebuild hint — never the lossy render', async () => {
    mockDocumentResponse({
      id: 'cmd_1',
      title: 'Ledger',
      sourceMarkdown: null,
      contentMarkdown: '# derived from HTML — must NOT be sliced',
      contentRevision: 9,
    })

    const exit = await docShow('cmd_1', { section: 'A queue' })

    expect(exit).toBe(1)
    expect(stdoutSpy).not.toHaveBeenCalled()
    const msg = stderrText()
    expect(msg).toContain('no stored markdown source')
    expect(msg).toContain('lumo doc update cmd_1 --file')
  })

  it('--raw and --section are mutually exclusive', async () => {
    const exit = await docShow('cmd_1', { raw: true, section: 'A queue' })
    expect(exit).toBe(2)
    expect(stderrText()).toContain('mutually exclusive')
  })
})

describe('doc show header revision (LUM-409)', () => {
  it('default mode prints the body revision in the header', async () => {
    mockDocumentResponse({
      id: 'cmd_1',
      title: 'Ledger',
      visibility: 'PRIVATE',
      contentMarkdown: '# rendered',
      contentRevision: 12,
      mentions: [],
    })

    const exit = await docShow('cmd_1')

    expect(exit).toBeUndefined()
    expect(logSpy.mock.calls[0]![0]).toContain('Revision: 12')
  })

  it('an old server without contentRevision renders a dash', async () => {
    mockDocumentResponse({
      id: 'cmd_1',
      title: 'Ledger',
      visibility: 'PRIVATE',
      contentMarkdown: '# rendered',
      mentions: [],
    })

    const exit = await docShow('cmd_1')

    expect(exit).toBeUndefined()
    expect(logSpy.mock.calls[0]![0]).toContain('Revision: -')
  })
})
