import {
  validateImageFile,
  uploadImageFile,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
} from '@/lib/editor/image-upload'
import { imagesClient } from '@/lib/api-client'
import { ApiClientError } from '@/lib/api-client/base'

jest.mock('@/lib/api-client', () => ({
  imagesClient: { upload: jest.fn() },
}))

const mockedUpload = imagesClient.upload as jest.MockedFunction<
  typeof imagesClient.upload
>

/** Build a File whose reported size matches `bytes` without allocating it. */
function fileOfSize(bytes: number, type: string): File {
  const file = new File(['x'], 'pic', { type })
  Object.defineProperty(file, 'size', { value: bytes })
  return file
}

describe('validateImageFile', () => {
  it('accepts every whitelisted type under the size limit', () => {
    for (const type of ALLOWED_IMAGE_TYPES) {
      const result = validateImageFile(fileOfSize(1024, type))
      expect(result).toEqual({ ok: true })
    }
  })

  it('rejects a type outside the whitelist with reason "type"', () => {
    // image/bmp passes a naive `startsWith('image/')` check but is not allowed
    expect(validateImageFile(fileOfSize(1024, 'image/bmp'))).toEqual({
      ok: false,
      reason: 'type',
    })
    expect(validateImageFile(fileOfSize(1024, 'application/pdf'))).toEqual({
      ok: false,
      reason: 'type',
    })
  })

  it('rejects an oversized but otherwise valid file with reason "size"', () => {
    expect(
      validateImageFile(fileOfSize(MAX_IMAGE_BYTES + 1, 'image/png'))
    ).toEqual({ ok: false, reason: 'size' })
  })

  it('accepts a file exactly at the size limit', () => {
    expect(validateImageFile(fileOfSize(MAX_IMAGE_BYTES, 'image/png'))).toEqual(
      { ok: true }
    )
  })

  it('reports "type" before "size" when both are wrong', () => {
    expect(
      validateImageFile(fileOfSize(MAX_IMAGE_BYTES + 1, 'image/bmp'))
    ).toEqual({ ok: false, reason: 'type' })
  })
})

describe('uploadImageFile', () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

  afterEach(() => {
    mockedUpload.mockReset()
    errorSpy.mockClear()
  })

  afterAll(() => {
    errorSpy.mockRestore()
  })

  it('returns the CDN url on success', async () => {
    mockedUpload.mockResolvedValue({ url: 'https://cdn/x.png' })
    await expect(
      uploadImageFile(fileOfSize(10, 'image/png'), 'doc1')
    ).resolves.toBe('https://cdn/x.png')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('returns null and logs the status/code for an ApiClientError (e.g. 413)', async () => {
    mockedUpload.mockRejectedValue(
      new ApiClientError(
        'File must be 10 MB or smaller',
        413,
        'PAYLOAD_TOO_LARGE'
      )
    )
    await expect(
      uploadImageFile(fileOfSize(10, 'image/png'), 'doc1')
    ).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = String(errorSpy.mock.calls[0]?.[0])
    expect(logged).toContain('413')
    expect(logged).toContain('PAYLOAD_TOO_LARGE')
  })

  it('returns null and logs a network/unexpected error', async () => {
    mockedUpload.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      uploadImageFile(fileOfSize(10, 'image/png'), undefined)
    ).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('returns null when the server responds without a url', async () => {
    mockedUpload.mockResolvedValue({ url: '' as unknown as string })
    await expect(
      uploadImageFile(fileOfSize(10, 'image/png'), 'doc1')
    ).resolves.toBeNull()
  })
})
