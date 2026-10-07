/**
 * @jest-environment node
 */
// LUM-1021: which backend a deployment gets.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logger } from '@/lib/logger'
import {
  ambiguousBlobBackendWarning,
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

describe('ambiguousBlobBackendWarning', () => {
  it('names the chosen backend and the override when several are configured implicitly', () => {
    const w = ambiguousBlobBackendWarning({
      BLOB_READ_WRITE_TOKEN: 'v',
      S3_BUCKET: 'b',
    })
    expect(w).toContain('(vercel, s3)')
    expect(w).toContain('using "vercel"')
    expect(w).toContain('BLOB_STORAGE=s3')
    expect(
      ambiguousBlobBackendWarning({ S3_BUCKET: 'b', LOCAL_BLOB_DIR: '/x' })
    ).toContain('using "s3"')
  })

  it('silent for a single backend (SaaS: Vercel token only), nothing, or an explicit BLOB_STORAGE', () => {
    expect(
      ambiguousBlobBackendWarning({
        BLOB_READ_WRITE_TOKEN: 'v',
        BLOB_PRIVATE_READ_WRITE_TOKEN: 'p',
      })
    ).toBeNull()
    expect(ambiguousBlobBackendWarning({ S3_BUCKET: 'b' })).toBeNull()
    expect(ambiguousBlobBackendWarning({})).toBeNull()
    expect(
      ambiguousBlobBackendWarning({
        BLOB_STORAGE: 's3',
        BLOB_READ_WRITE_TOKEN: 'v',
        S3_BUCKET: 'b',
      })
    ).toBeNull()
  })

  it('createBlobStorage logs the warning once per build and keeps the precedence', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    try {
      const s = await createBlobStorage({
        BLOB_READ_WRITE_TOKEN: 'v',
        S3_BUCKET: 'b',
      })
      expect(s.kind).toBe('vercel')
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]![0])).toMatch(
        /using "vercel".*BLOB_STORAGE=s3/
      )
      warn.mockClear()
      await createBlobStorage({ BLOB_READ_WRITE_TOKEN: 'v' })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
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
