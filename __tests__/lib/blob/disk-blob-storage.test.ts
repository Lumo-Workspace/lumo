/**
 * @jest-environment node
 */
// LUM-1021: the local-disk backend against a real temp directory.
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDiskBlobStorage,
  resolveDiskRoot,
} from '@/lib/blob/disk-blob-storage'
import { deleteAllByPrefix, type BlobStorage } from '@/lib/blob/types'

let dir: string
let storage: BlobStorage
const text = async (s: ReadableStream<Uint8Array>) => new Response(s).text()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lum1021-disk-'))
  storage = createDiskBlobStorage(dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('disk backend', () => {
  it('put → get round-trips bytes and content type; the private ref is opaque', async () => {
    const stored = await storage.put(
      'test-evidence/t/c/f1',
      Buffer.from('hello'),
      {
        access: 'private',
        contentType: 'text/plain',
      }
    )
    expect(stored).toEqual({
      url: 'lumo-blob:private/test-evidence/t/c/f1',
      pathname: 'test-evidence/t/c/f1',
    })
    for (const ref of [stored.url, stored.pathname]) {
      const got = await storage.get(ref, 'private')
      expect(got?.contentType).toBe('text/plain')
      expect(got?.size).toBe(5)
      expect(await text(got!.stream)).toBe('hello')
    }
  })

  it('a private object is NOT readable through the public namespace (and vice versa)', async () => {
    await storage.put('workspaces/ws/images/i1', Buffer.from('secret'), {
      access: 'private',
    })
    await expect(
      storage.get('workspaces/ws/images/i1', 'public')
    ).resolves.toBeNull()
    await expect(
      storage.get('lumo-blob:private/workspaces/ws/images/i1', 'public')
    ).rejects.toThrow(/private blob reference used for public access/)

    const logo = await storage.put(
      'workspaces/ws/logo-1.png',
      Buffer.from('png'),
      {
        access: 'public',
        contentType: 'image/png',
      }
    )
    expect(logo.url).toBe('/api/blob/public/workspaces/ws/logo-1.png')
    await expect(
      storage.get('workspaces/ws/logo-1.png', 'private')
    ).resolves.toBeNull()
  })

  it('stores files 0600 under private/ (never a static path)', async () => {
    await storage.put('a/b', Buffer.from('x'), { access: 'private' })
    const file = join(dir, 'private', 'a', 'b')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(existsSync(join(dir, 'public', 'a', 'b'))).toBe(false)
  })

  it('refuses traversal out of the namespace', async () => {
    await expect(
      storage.put('../public/workspaces/ws/logo-1.png', Buffer.from('x'), {
        access: 'private',
      })
    ).rejects.toThrow(/unsafe/)
    await expect(storage.get('../private/a', 'public')).rejects.toThrow(
      /unsafe/
    )
  })

  it('refuses to overwrite unless allowOverwrite, like Vercel Blob', async () => {
    await storage.put('a/b', Buffer.from('1'), { access: 'private' })
    await expect(
      storage.put('a/b', Buffer.from('2'), { access: 'private' })
    ).rejects.toMatchObject({ status: 409 })
    await storage.put('a/b', Buffer.from('3'), {
      access: 'private',
      allowOverwrite: true,
    })
    expect(await text((await storage.get('a/b', 'private'))!.stream)).toBe('3')
  })

  it('addRandomSuffix changes the stored pathname', async () => {
    const s = await storage.put('w/e/workspace-export.zip', Buffer.from('z'), {
      access: 'private',
      addRandomSuffix: true,
    })
    expect(s.pathname).toMatch(/^w\/e\/workspace-export-.{21}\.zip$/)
    expect(await storage.get(s.url, 'private')).not.toBeNull()
  })

  it('accepts Blob and ReadableStream bodies', async () => {
    await storage.put('a/blob', new Blob(['bb'], { type: 'image/png' }), {
      access: 'private',
    })
    expect((await storage.get('a/blob', 'private'))?.contentType).toBe(
      'image/png'
    )
    await storage.put('a/stream', new Blob(['ss']).stream(), {
      access: 'private',
    })
    expect(await text((await storage.get('a/stream', 'private'))!.stream)).toBe(
      'ss'
    )
  })

  it('missing objects: get → null, delete → no error', async () => {
    await expect(storage.get('nope/x', 'private')).resolves.toBeNull()
    await expect(storage.delete(['nope/x'], 'private')).resolves.toBeUndefined()
  })

  it('lists by prefix with pagination, and batch/prefix deletes empty the namespace', async () => {
    for (let i = 0; i < 5; i++)
      await storage.put(`workspaces/ws/exports/e/${i}`, Buffer.from('x'), {
        access: 'private',
      })
    await storage.put('workspaces/other/x', Buffer.from('x'), {
      access: 'private',
    })
    await storage.put('workspaces/ws/logo-1.png', Buffer.from('x'), {
      access: 'public',
    })

    const p1 = await storage.list({
      access: 'private',
      prefix: 'workspaces/ws/',
      limit: 2,
    })
    expect(p1.blobs.map(b => b.pathname)).toEqual([
      'workspaces/ws/exports/e/0',
      'workspaces/ws/exports/e/1',
    ])
    expect(p1.hasMore).toBe(true)
    expect(p1.blobs[0]!.uploadedAt).toBeInstanceOf(Date)
    const p2 = await storage.list({
      access: 'private',
      prefix: 'workspaces/ws/',
      limit: 10,
      cursor: p1.cursor!,
    })
    expect(p2.blobs).toHaveLength(3)
    expect(p2.hasMore).toBe(false)

    await expect(
      deleteAllByPrefix(storage, 'workspaces/ws/', 'private')
    ).resolves.toBe(5)
    await expect(
      deleteAllByPrefix(storage, 'workspaces/ws/', 'public')
    ).resolves.toBe(1)
    expect(
      (await storage.list({ access: 'private', prefix: '' })).blobs.map(
        b => b.pathname
      )
    ).toEqual(['workspaces/other/x'])
    // Emptied directories are pruned.
    expect(readdirSync(join(dir, 'private', 'workspaces'))).toEqual(['other'])
  })

  it('has no signed URLs — private reads go through an authorising route', async () => {
    await expect(storage.signedReadUrl('a/b')).rejects.toMatchObject({
      status: 501,
    })
  })
})

describe('resolveDiskRoot', () => {
  it("refuses a directory inside Next's public/ folder", () => {
    expect(() => resolveDiskRoot('public/uploads', '/app')).toThrow(/public\//)
    expect(() => resolveDiskRoot('/app/public', '/app')).toThrow(/public\//)
    expect(resolveDiskRoot('data/blobs', '/app')).toBe('/app/data/blobs')
    expect(resolveDiskRoot('/var/lumo', '/app')).toBe('/var/lumo')
    expect(resolveDiskRoot('/app/publicity', '/app')).toBe('/app/publicity')
  })
})
