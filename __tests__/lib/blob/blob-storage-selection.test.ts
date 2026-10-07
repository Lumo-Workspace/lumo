/**
 * @jest-environment node
 */
// LUM-1021: which backend a deployment gets.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createBlobStorage,
  getBlobStorage,
  resolveBlobBackend,
} from '@/lib/blob/storage'

describe('resolveBlobBackend', () => {
  it('a Vercel token wins over S3 and disk config (SaaS never switches by accident)', () => {
    expect(
      resolveBlobBackend({
        BLOB_READ_WRITE_TOKEN: 'v',
        S3_BUCKET: 'b',
        LOCAL_BLOB_DIR: '/x',
      })
    ).toBe('vercel')
    expect(
      resolveBlobBackend({ BLOB_PRIVATE_READ_WRITE_TOKEN: 'v', S3_BUCKET: 'b' })
    ).toBe('vercel')
  })

  it('S3 before disk, disk alone, nothing → vercel', () => {
    expect(resolveBlobBackend({ S3_BUCKET: 'b', LOCAL_BLOB_DIR: '/x' })).toBe(
      's3'
    )
    expect(resolveBlobBackend({ LOCAL_BLOB_DIR: '/x' })).toBe('disk')
    expect(resolveBlobBackend({})).toBe('vercel')
    expect(
      resolveBlobBackend({ S3_BUCKET: '  ', BLOB_READ_WRITE_TOKEN: '' })
    ).toBe('vercel')
  })

  it('BLOB_STORAGE overrides, and an unknown value fails loudly', () => {
    expect(
      resolveBlobBackend({ BLOB_STORAGE: 'disk', BLOB_READ_WRITE_TOKEN: 'v' })
    ).toBe('disk')
    expect(resolveBlobBackend({ BLOB_STORAGE: 'S3' })).toBe('s3')
    expect(() => resolveBlobBackend({ BLOB_STORAGE: 'ftp' })).toThrow(
      /BLOB_STORAGE must be one of/
    )
  })
})

describe('createBlobStorage', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lum1021-sel-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('builds each backend kind', async () => {
    expect((await createBlobStorage({ BLOB_READ_WRITE_TOKEN: 'v' })).kind).toBe(
      'vercel'
    )
    expect(
      (
        await createBlobStorage({
          S3_BUCKET: 'b',
          S3_ENDPOINT: 'http://127.0.0.1:1',
          S3_ACCESS_KEY_ID: 'k',
          S3_SECRET_ACCESS_KEY: 's',
        })
      ).kind
    ).toBe('s3')
    expect((await createBlobStorage({ LOCAL_BLOB_DIR: dir })).kind).toBe('disk')
  })

  it('explicit backends without their config fail loudly', async () => {
    await expect(createBlobStorage({ BLOB_STORAGE: 's3' })).rejects.toThrow(
      /S3_BUCKET/
    )
    await expect(createBlobStorage({ BLOB_STORAGE: 'disk' })).rejects.toThrow(
      /LOCAL_BLOB_DIR/
    )
  })

  it('getBlobStorage memoises per configuration and rebuilds when it changes', async () => {
    const saved = { ...process.env }
    try {
      delete process.env.BLOB_READ_WRITE_TOKEN
      delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN
      delete process.env.S3_BUCKET
      delete process.env.BLOB_STORAGE
      process.env.LOCAL_BLOB_DIR = dir
      const a = await getBlobStorage()
      expect(a.kind).toBe('disk')
      expect(await getBlobStorage()).toBe(a)
      process.env.BLOB_STORAGE = 'vercel'
      expect((await getBlobStorage()).kind).toBe('vercel')
    } finally {
      process.env = saved
    }
  })
})
