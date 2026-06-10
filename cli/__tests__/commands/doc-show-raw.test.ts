/**
 * @jest-environment node
 *
 * LUM-408 — `lumo doc show --raw`: the stored markdown source is the only
 * legal edit base. Byte-identical output, hard error (no lossy fallback)
 * when the source is absent.
 */
jest.mock('../../src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('../../src/lib/resolve-doc-id', () => ({
  lookupDocId: jest.fn(),
}))

import { readCredentials } from '../../src/lib/config'
import { lookupDocId } from '../../src/lib/resolve-doc-id'
import { docShow } from '../../src/commands/doc-show'

const mockRead = readCredentials as jest.Mock
const mockLookup = lookupDocId as jest.Mock

// Table + fenced code + trailing-space + no trailing newline: the shapes the
// lossy HTML→markdown reverse render destroys (LUM-349) and byte-fidelity
// must preserve.
const RAW_SOURCE = [
  '# Spec',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '```sql',
  'select 1;',
  '```',
  'trailing  ',
  'last line without newline',
].join('\n')

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

describe('doc show --raw', () => {
  it('prints the byte-identical stored markdown source with no header and no added newline', async () => {
    mockDocumentResponse({ id: 'cmd_1', title: 'Spec', sourceMarkdown: RAW_SOURCE })

    const exit = await docShow('cmd_1', { raw: true })

    expect(exit).toBeUndefined()
    expect(stdoutSpy).toHaveBeenCalledTimes(1)
    expect(stdoutSpy.mock.calls[0]![0]).toBe(RAW_SOURCE)
    // Raw mode is a bare edit base: no `ID:`/`Title:` header via console.log.
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('byte-identical: an empty markdown source is still a valid (empty) edit base', async () => {
    mockDocumentResponse({ id: 'cmd_1', title: 'Spec', sourceMarkdown: '' })

    const exit = await docShow('cmd_1', { raw: true })

    expect(exit).toBeUndefined()
    expect(stdoutSpy.mock.calls[0]![0]).toBe('')
  })

  it('legacy doc without a markdown source fails with a rebuild hint instead of falling back to the lossy render', async () => {
    mockDocumentResponse({
      id: 'cmd_1',
      title: 'Spec',
      sourceMarkdown: null,
      contentMarkdown: '# derived from HTML — must NOT be printed',
      content: '<h1>derived</h1>',
    })

    const exit = await docShow('cmd_1', { raw: true })

    expect(exit).toBe(1)
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    const message = errorSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(message).toContain('no stored markdown source')
    expect(message).toContain('lumo doc show cmd_1')
    expect(message).toContain('lumo doc update cmd_1 --file')
  })

  it('legacy doc with the field entirely absent (old server) also fails closed', async () => {
    mockDocumentResponse({ id: 'cmd_1', title: 'Spec', contentMarkdown: '# x' })

    const exit = await docShow('cmd_1', { raw: true })

    expect(exit).toBe(1)
    expect(stdoutSpy).not.toHaveBeenCalled()
  })

  it('without --raw the rendered view still works unchanged', async () => {
    mockDocumentResponse({
      id: 'cmd_1',
      title: 'Spec',
      visibility: 'PRIVATE',
      contentMarkdown: '# rendered',
      mentions: [],
    })

    const exit = await docShow('cmd_1')

    expect(exit).toBeUndefined()
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0]![0]).toContain('# rendered')
  })
})
