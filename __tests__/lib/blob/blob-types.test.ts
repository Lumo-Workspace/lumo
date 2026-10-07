/**
 * @jest-environment node
 */
// LUM-1021: the storage-neutral helpers every backend relies on.
import {
  assertSafePathname,
  assertSafePrefix,
  blobRef,
  clampTtl,
  deleteAllByPrefix,
  pathnameFromRef,
  withRandomSuffix,
  type ListBlobsPage,
} from '@/lib/blob/types'

describe('assertSafePathname', () => {
  it.each([
    'workspaces/ws/exports/e1/workspace-export.zip',
    'test-evidence/t/c/0b5c4a1e',
    'security-sarif/acme/repo/1/abc.sarif.gz',
  ])('accepts %s', p => expect(assertSafePathname(p)).toBe(p))

  it.each([
    '',
    '/etc/passwd',
    '../private/x',
    'a/../../b',
    'a/./b',
    'a//b',
    'a\\b',
    'a/b\u0000',
    'a/\nb',
  ])('rejects %j with status 400', p => {
    expect(() => assertSafePathname(p)).toThrow(/unsafe blob pathname/)
    try {
      assertSafePathname(p)
    } catch (e) {
      expect((e as { status?: number }).status).toBe(400)
    }
  })

  it('prefixes may end in a slash or be empty', () => {
    expect(assertSafePrefix('')).toBe('')
    expect(assertSafePrefix('workspaces/ws/')).toBe('workspaces/ws/')
    expect(() => assertSafePrefix('../')).toThrow()
  })
})

describe('withRandomSuffix', () => {
  it('inserts a suffix before the extension and is different each time', () => {
    const a = withRandomSuffix('w/e/workspace-export.zip')
    const b = withRandomSuffix('w/e/workspace-export.zip')
    expect(a).toMatch(/^w\/e\/workspace-export-[A-Za-z0-9_-]{21}\.zip$/)
    expect(a).not.toBe(b)
  })
  it('appends when there is no extension', () => {
    expect(withRandomSuffix('a.dir/file')).toMatch(
      /^a\.dir\/file-[A-Za-z0-9_-]{21}$/
    )
  })
})

describe('references keep public and private apart', () => {
  it('private refs are opaque, public refs are the app route', () => {
    expect(blobRef('private', 'a/b')).toBe('lumo-blob:private/a/b')
    expect(blobRef('public', 'a/b')).toBe('/api/blob/public/a/b')
  })

  it('resolves refs and bare pathnames inside their own namespace', () => {
    expect(pathnameFromRef('lumo-blob:private/a/b', 'private')).toBe('a/b')
    expect(pathnameFromRef('/api/blob/public/a/b', 'public')).toBe('a/b')
    expect(
      pathnameFromRef('https://lumo.example/api/blob/public/a/b', 'public')
    ).toBe('a/b')
    expect(pathnameFromRef('a/b', 'private')).toBe('a/b')
  })

  it('refuses a ref of the OTHER namespace', () => {
    expect(() => pathnameFromRef('/api/blob/public/a/b', 'private')).toThrow(
      /public blob reference used for private access/
    )
    expect(() => pathnameFromRef('lumo-blob:private/a/b', 'public')).toThrow(
      /private blob reference used for public access/
    )
  })

  it('refuses foreign URLs, unknown schemes and traversal inside a ref', () => {
    expect(() =>
      pathnameFromRef('https://x.blob.vercel-storage.com/a/b', 'private')
    ).toThrow(/not a blob reference/)
    expect(() => pathnameFromRef('lumo-blob:other/a', 'private')).toThrow()
    expect(() =>
      pathnameFromRef('/api/blob/public/%E0%A4%A', 'public')
    ).toThrow(/malformed/)
    expect(() =>
      pathnameFromRef('lumo-blob:private/../public/a', 'private')
    ).toThrow(/unsafe/)
  })
})

describe('clampTtl', () => {
  it('defaults, floors and caps at 7 days', () => {
    expect(clampTtl()).toBe(300)
    expect(clampTtl(0)).toBe(300)
    expect(clampTtl(60.9)).toBe(60)
    expect(clampTtl(10 ** 9)).toBe(7 * 24 * 3600)
  })
})

describe('deleteAllByPrefix', () => {
  it('re-lists from the start each round and sums the deletions', async () => {
    const pages: ListBlobsPage[] = [
      {
        blobs: [{ url: 'u1', pathname: 'p1', uploadedAt: new Date() }],
        hasMore: true,
      },
      {
        blobs: [{ url: 'u2', pathname: 'p2', uploadedAt: new Date() }],
        hasMore: false,
      },
    ]
    const list = jest.fn(async () => pages.shift() as ListBlobsPage)
    const del = jest.fn(async () => undefined)
    await expect(
      deleteAllByPrefix({ list, delete: del }, 'x/', 'private')
    ).resolves.toBe(2)
    for (const call of list.mock.calls as unknown[][])
      expect(call[0]).toEqual({ prefix: 'x/', access: 'private', limit: 1000 })
    expect(del).toHaveBeenNthCalledWith(1, ['u1'], 'private')
    expect(del).toHaveBeenNthCalledWith(2, ['u2'], 'private')
  })
})
