/**
 * @jest-environment node
 *
 * LUM-408 — `lumo doc diff <doc> --file <local.md>`: remote markdown source
 * vs local file. Clean exit 0, divergent unified diff exit 1, explicit error
 * when the doc has no stored markdown source.
 */
jest.mock('../../src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('../../src/lib/resolve-doc-id', () => ({
  lookupDocId: jest.fn(),
}))
jest.mock('../../src/lib/path-guard', () => ({
  ...jest.requireActual('../../src/lib/path-guard'),
  checkArtifactFilePath: jest.fn(),
}))
jest.mock('../../src/lib/doc-input', () => ({
  ...jest.requireActual('../../src/lib/doc-input'),
  readFileUtf8: jest.fn(),
}))

import { readCredentials } from '../../src/lib/config'
import { lookupDocId } from '../../src/lib/resolve-doc-id'
import { checkArtifactFilePath } from '../../src/lib/path-guard'
import { readFileUtf8 } from '../../src/lib/doc-input'
import { docDiff } from '../../src/commands/doc-diff'
import { formatUnifiedDiff } from '../../src/lib/unified-diff'

const mockRead = readCredentials as jest.Mock
const mockLookup = lookupDocId as jest.Mock
const mockCheckPath = checkArtifactFilePath as jest.Mock
const mockReadFile = readFileUtf8 as jest.Mock

const REMOTE = ['# Doc', '', 'line one', 'line two', 'line three'].join('\n')

function mockDocumentResponse(document: Record<string, unknown>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ document }),
  }) as unknown as typeof fetch
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
  mockCheckPath.mockReturnValue({ ok: true, resolved: '/proj/local.md' })
  mockReadFile.mockResolvedValue(REMOTE)
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
  logSpy.mockRestore()
})

describe('doc diff', () => {
  it('reports clean and exits 0 when remote source and local file are byte-identical', async () => {
    mockDocumentResponse({ id: 'cmd_1', sourceMarkdown: REMOTE })

    const exit = await docDiff('cmd_1', { file: 'local.md' })

    expect(exit).toBeUndefined()
    expect(logSpy.mock.calls[0]![0]).toContain('Clean:')
    expect(logSpy.mock.calls[0]![0]).toContain('local.md')
  })

  it('prints a unified diff and exits 1 when sources diverge', async () => {
    mockDocumentResponse({ id: 'cmd_1', sourceMarkdown: REMOTE })
    mockReadFile.mockResolvedValue(
      ['# Doc', '', 'line one', 'line two EDITED', 'line three'].join('\n')
    )

    const exit = await docDiff('cmd_1', { file: 'local.md' })

    expect(exit).toBe(1)
    const out = logSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(out).toContain('--- remote/cmd_1 (sourceMarkdown)')
    expect(out).toContain('+++ local/local.md')
    expect(out).toContain('@@')
    expect(out).toContain('-line two')
    expect(out).toContain('+line two EDITED')
  })

  it('a byte-level-only divergence (trailing newline) still exits 1', async () => {
    mockDocumentResponse({ id: 'cmd_1', sourceMarkdown: REMOTE })
    mockReadFile.mockResolvedValue(`${REMOTE}\n`)

    const exit = await docDiff('cmd_1', { file: 'local.md' })

    expect(exit).toBe(1)
  })

  it('errors explicitly when the doc has no stored markdown source', async () => {
    mockDocumentResponse({ id: 'cmd_1', sourceMarkdown: null })

    const exit = await docDiff('cmd_1', { file: 'local.md' })

    expect(exit).toBe(1)
    const message = errorSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(message).toContain('no stored markdown source')
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('requires --file', async () => {
    const exit = await docDiff('cmd_1', {})
    expect(exit).toBe(2)
    expect(errorSpy.mock.calls[0]![0]).toContain('--file')
  })

  it('refuses a path outside the project sandbox', async () => {
    mockCheckPath.mockReturnValue({
      ok: false,
      reason: 'outside-project',
      detail: 'resolves outside project directory',
    })

    const exit = await docDiff('cmd_1', { file: '../../etc/passwd' })

    expect(exit).toBe(1)
    expect(errorSpy.mock.calls[0]![0]).toContain('refusing to read')
  })
})

describe('formatUnifiedDiff', () => {
  it('returns empty string for identical line sequences', () => {
    expect(formatUnifiedDiff('a\nb', 'a\nb', 'old', 'new')).toBe('')
  })

  it('renders hunk headers with context around the change', () => {
    const oldText = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n')
    const newText = ['1', '2', '3', '4', 'FIVE', '6', '7', '8', '9'].join('\n')
    const diff = formatUnifiedDiff(oldText, newText, 'old', 'new')
    expect(diff).toContain('@@ -2,7 +2,7 @@')
    expect(diff).toContain('-5')
    expect(diff).toContain('+FIVE')
    // context lines limited to 3 around the change
    expect(diff).not.toContain('\n 1')
  })

  it('merges nearby changes into one hunk and separates distant ones', () => {
    const oldLines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
    const newLines = [...oldLines]
    newLines[0] = 'line 1 CHANGED'
    newLines[29] = 'line 30 CHANGED'
    const diff = formatUnifiedDiff(
      oldLines.join('\n'),
      newLines.join('\n'),
      'old',
      'new'
    )
    const hunkCount = (diff.match(/^@@ /gm) ?? []).length
    expect(hunkCount).toBe(2)
  })

  it('handles pure insertion and pure deletion', () => {
    expect(formatUnifiedDiff('a\nb', 'a\nX\nb', 'o', 'n')).toContain('+X')
    expect(formatUnifiedDiff('a\nX\nb', 'a\nb', 'o', 'n')).toContain('-X')
  })
})
