/**
 * @jest-environment node
 */
// LUM-1021: the Vercel backend keeps the LUM-916 store split exactly — public
// calls use the default store (no token), private calls pass the private
// store's token explicitly.
jest.mock('@vercel/blob', () => ({
  put: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  list: jest.fn(),
}))
jest.mock('@vercel/blob/client', () => ({ handleUpload: jest.fn() }))

import { del, get, list, put } from '@vercel/blob'
import { handleUpload } from '@vercel/blob/client'
import { createVercelBlobStorage } from '@/lib/blob/vercel-blob-storage'
import { handlePrivateClientUpload } from '@/lib/blob/client-upload'
import { openWorkspaceLogo } from '@/lib/services/workspace-logo-blob'

const saved = { ...process.env }
beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...saved, BLOB_PRIVATE_READ_WRITE_TOKEN: 'priv-token' }
  delete process.env.BLOB_STORAGE
  delete process.env.S3_BUCKET
  delete process.env.LOCAL_BLOB_DIR
})
afterAll(() => {
  process.env = saved
})

const storage = createVercelBlobStorage()

describe('Vercel backend', () => {
  it('private put/get/delete/list carry the private-store token', async () => {
    ;(put as jest.Mock).mockResolvedValue({ url: 'https://p/x', pathname: 'x' })
    await expect(
      storage.put('x', Buffer.from('a'), {
        access: 'private',
        contentType: 'application/zip',
        addRandomSuffix: true,
        multipart: false,
      })
    ).resolves.toEqual({ url: 'https://p/x', pathname: 'x' })
    expect(put).toHaveBeenCalledWith('x', expect.any(Buffer), {
      access: 'private',
      token: 'priv-token',
      contentType: 'application/zip',
      addRandomSuffix: true,
      multipart: false,
    })
    ;(get as jest.Mock).mockResolvedValue({
      statusCode: 200,
      stream: new Blob(['b']).stream(),
      blob: { contentType: 'text/plain', size: 1 },
    })
    const got = await storage.get('https://p/x', 'private', { noCache: true })
    expect(got?.size).toBe(1)
    expect(get).toHaveBeenCalledWith('https://p/x', {
      access: 'private',
      token: 'priv-token',
      useCache: false,
    })

    await storage.delete(['https://p/x'], 'private')
    expect(del).toHaveBeenCalledWith(['https://p/x'], { token: 'priv-token' })
    ;(list as jest.Mock).mockResolvedValue({
      blobs: [{ url: 'u', pathname: 'p', uploadedAt: new Date(0) }],
      hasMore: true,
      cursor: 'c',
    })
    await expect(
      storage.list({ access: 'private', prefix: 'security-sarif/' })
    ).resolves.toMatchObject({ hasMore: true, cursor: 'c' })
    expect(list).toHaveBeenCalledWith({
      prefix: 'security-sarif/',
      limit: 1000,
      token: 'priv-token',
    })
  })

  it('public calls use the default store — no token passed', async () => {
    ;(put as jest.Mock).mockResolvedValue({
      url: 'https://pub/l.png',
      pathname: 'l.png',
    })
    await storage.put('l.png', Buffer.from('a'), {
      access: 'public',
      contentType: 'image/png',
    })
    expect(put).toHaveBeenCalledWith('l.png', expect.any(Buffer), {
      access: 'public',
      contentType: 'image/png',
    })
    await storage.delete('https://pub/l.png', 'public')
    expect(del).toHaveBeenCalledWith('https://pub/l.png')
    ;(get as jest.Mock).mockResolvedValue(null)
    await expect(storage.get('https://pub/l.png', 'public')).resolves.toBeNull()
    expect(get).toHaveBeenCalledWith('https://pub/l.png', { access: 'public' })
  })

  it('a private call never falls back to the public store', async () => {
    delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN
    await expect(storage.get('x', 'private')).rejects.toThrow(
      'BLOB_PRIVATE_READ_WRITE_TOKEN'
    )
    expect(get).not.toHaveBeenCalled()
  })

  it('a non-200 response or missing stream reads as null', async () => {
    ;(get as jest.Mock).mockResolvedValue({
      statusCode: 304,
      stream: null,
      blob: {},
    })
    await expect(storage.get('x', 'private')).resolves.toBeNull()
  })

  it('has no signed read URLs (501)', async () => {
    await expect(storage.signedReadUrl('x')).rejects.toMatchObject({
      status: 501,
    })
  })
})

describe('handlePrivateClientUpload', () => {
  const opts = {
    body: { type: 'blob.generate-client-token' } as never,
    request: {} as never,
    onBeforeGenerateToken: jest.fn(),
    onUploadCompleted: jest.fn(),
  }

  it('pins the private-store token on Vercel', async () => {
    ;(handleUpload as jest.Mock).mockResolvedValue({ ok: true })
    await expect(handlePrivateClientUpload(opts)).resolves.toEqual({ ok: true })
    expect(handleUpload).toHaveBeenCalledWith({ ...opts, token: 'priv-token' })
  })

  it('refuses with 501 on S3 / disk instead of writing anywhere', async () => {
    delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN
    delete process.env.BLOB_READ_WRITE_TOKEN
    process.env.LOCAL_BLOB_DIR = '/tmp/x'
    await expect(handlePrivateClientUpload(opts)).rejects.toMatchObject({
      status: 501,
    })
    process.env.BLOB_STORAGE = 's3'
    await expect(handlePrivateClientUpload(opts)).rejects.toMatchObject({
      status: 501,
    })
    expect(handleUpload).not.toHaveBeenCalled()
  })
})

describe('public blob route on Vercel', () => {
  it('serves nothing — logos live on the public store CDN', async () => {
    await expect(
      openWorkspaceLogo('workspaces/ws/logo-1.png')
    ).resolves.toBeNull()
    expect(get).not.toHaveBeenCalled()
  })
})
