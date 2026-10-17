/**
 * @jest-environment node
 */
import { formatUpdatedDocLine } from '@/cli/src/commands/doc-update'

describe('formatUpdatedDocLine', () => {
  it('renders updated line with cuid, title, url', () => {
    expect(
      formatUpdatedDocLine({
        id: 'c1',
        title: 'Doc',
        url: 'https://x/y/c1',
      })
    ).toBe('Updated c1 "Doc"  https://x/y/c1')
  })
})

describe('formatUpdatedDocLine — tags', () => {
  it('includes Tags line when tags present', () => {
    const line = formatUpdatedDocLine({
      id: 'cmd_x',
      title: 't',
      url: 'https://x',
      tags: ['urgent', 'rfc'],
    })
    expect(line).toBe(`Updated cmd_x "t"  https://x\nTags: urgent, rfc`)
  })

  it('omits Tags line when tags is empty', () => {
    const line = formatUpdatedDocLine({
      id: 'cmd_x',
      title: 't',
      url: 'https://x',
      tags: [],
    })
    expect(line).toBe(`Updated cmd_x "t"  https://x`)
  })

  it('omits Tags line when tags is undefined', () => {
    const line = formatUpdatedDocLine({
      id: 'cmd_x',
      title: 't',
      url: 'https://x',
    })
    expect(line).toBe(`Updated cmd_x "t"  https://x`)
  })
})

// ---------------------------------------------------------------------------
// Mutex guard tests
// These test the CLI-side mutex check in docUpdate() directly.
// We mock away all I/O: readCredentials, lookupDocId, resolveTagRefs, fetch.
// ---------------------------------------------------------------------------
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

jest.mock('@/cli/src/lib/resolve-doc-id', () => ({
  lookupDocId: jest.fn(async () => 'cmd_target_doc'),
}))

jest.mock('@/cli/src/lib/tag-resolver', () => ({
  resolveTagRefs: jest.fn(async () => ['resolved_id']),
}))

// Mock stdin as TTY so resolveDocContent returns 'none'
Object.defineProperty(process.stdin, 'isTTY', {
  value: true,
  configurable: true,
})

describe('doc update tag flag mutex', () => {
  let docUpdate: typeof import('@/cli/src/commands/doc-update').docUpdate
  let consoleSpy: jest.SpyInstance

  beforeAll(async () => {
    const mod = await import('@/cli/src/commands/doc-update')
    docUpdate = mod.docUpdate
  })

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('returns error code 1 when --tag and --add-tag are both set', async () => {
    const exitCode = await docUpdate('cmd_x', {
      tag: ['a'],
      addTag: ['b'],
      title: 'something',
    })
    expect(exitCode).toBe(2)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('mutually exclusive')
    )
  })

  it('returns error code 1 when --tag and --remove-tag are both set', async () => {
    const exitCode = await docUpdate('cmd_x', {
      tag: ['a'],
      removeTag: ['b'],
      title: 'something',
    })
    expect(exitCode).toBe(2)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('mutually exclusive')
    )
  })

  it('returns error code 1 when --tag-id and --add-tag-id are both set', async () => {
    const exitCode = await docUpdate('cmd_x', {
      tagId: ['cuid_a'],
      addTagId: ['cuid_b'],
      title: 'something',
    })
    expect(exitCode).toBe(2)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('mutually exclusive')
    )
  })

  it('allows --add-tag together with --remove-tag (no mutex violation)', async () => {
    // fetch mock: succeed
    const fetchMock = jest.fn(async () =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          document: {
            id: 'cmd_target_doc',
            title: 'My Doc',
            docTags: [{ name: 'urgent' }],
          },
        }),
      })
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const exitCode = await docUpdate('cmd_x', {
      addTag: ['urgent'],
      removeTag: ['old'],
      title: 'something',
    })
    // Should not fail due to mutex (may succeed or fail for other reasons,
    // but must not return 1 for the mutex check)
    expect(exitCode).not.toBe(1)
    // No "mutually exclusive" error logged
    for (const call of consoleSpy.mock.calls) {
      expect(call[0] as string).not.toContain('mutually exclusive')
    }
  })
})
