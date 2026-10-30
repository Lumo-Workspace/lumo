/**
 * @jest-environment node
 *
 * LUM-1343 — storeImportedImage writes under the workspace image prefix the
 * editor uses, skips (without loading) an image already copied, and
 * tolerates a concurrent write of the same id.
 */
const putPrivateFile = jest.fn()
const openPrivateFile = jest.fn()
jest.mock('@/lib/services/private-file-blob', () => ({
  putPrivateFile: (...a: unknown[]) => putPrivateFile(...a),
  openPrivateFile: (...a: unknown[]) => openPrivateFile(...a),
}))
jest.mock('@/lib/repositories/private-file.repository', () => ({
  privateFileRepository: {},
}))

import { privateFileService } from '@/lib/services/private-file.service'

const URL_ = 'https://app.example/api/files/workspaces/ws1/images/feishu-abc'
const opened = () => ({
  stream: new ReadableStream(),
  contentType: 'image/png',
  size: 1,
})

beforeEach(() => jest.clearAllMocks())

it('stores a new image and returns its file-route URL', async () => {
  openPrivateFile.mockResolvedValue(null)
  const load = jest.fn(async () => ({
    body: Buffer.from([1]),
    contentType: 'image/png',
  }))
  await expect(
    privateFileService.storeImportedImage(
      'ws1',
      'feishu-abc',
      load,
      'https://app.example/'
    )
  ).resolves.toBe(URL_)
  expect(putPrivateFile).toHaveBeenCalledWith(
    'workspaces/ws1/images/feishu-abc',
    Buffer.from([1]),
    'image/png'
  )
})

it('an image already copied is reused without downloading again', async () => {
  openPrivateFile.mockResolvedValue(opened())
  const load = jest.fn()
  await expect(
    privateFileService.storeImportedImage(
      'ws1',
      'feishu-abc',
      load,
      'https://app.example'
    )
  ).resolves.toBe(URL_)
  expect(load).not.toHaveBeenCalled()
  expect(putPrivateFile).not.toHaveBeenCalled()
})

it('a write lost to a concurrent copy still resolves; a real failure throws', async () => {
  const load = async () => ({
    body: Buffer.from([1]),
    contentType: 'image/png',
  })
  openPrivateFile.mockResolvedValueOnce(null).mockResolvedValueOnce(opened())
  putPrivateFile.mockRejectedValueOnce(new Error('exists'))
  await expect(
    privateFileService.storeImportedImage(
      'ws1',
      'feishu-abc',
      load,
      'https://app.example'
    )
  ).resolves.toBe(URL_)

  openPrivateFile.mockResolvedValue(null)
  putPrivateFile.mockRejectedValueOnce(new Error('store down'))
  await expect(
    privateFileService.storeImportedImage(
      'ws1',
      'feishu-abc',
      load,
      'https://app.example'
    )
  ).rejects.toThrow('store down')
})
