/**
 * @jest-environment node
 *
 * LUM-1321 — an imported report is stored as a PRIVATE gzip blob, so the
 * ingest run reads it like a CI push.
 */
const put = jest.fn()
jest.mock('@/lib/blob/storage', () => ({
  getBlobStorage: jest.fn(async () => ({ put })),
}))

import { putPrivateSarifBlob } from '@/ee/security/services/security-sarif-blob'

it('puts the bytes privately and returns the stored reference', async () => {
  put.mockResolvedValue({
    url: 'u',
    pathname: 'security-sarif/a--b/h/codex-x.sarif.gz',
  })
  const gz = Buffer.from([1, 2, 3])
  await expect(
    putPrivateSarifBlob('security-sarif/a--b/h/codex-x.sarif.gz', gz)
  ).resolves.toEqual({
    url: 'u',
    pathname: 'security-sarif/a--b/h/codex-x.sarif.gz',
  })
  expect(put).toHaveBeenCalledWith(
    'security-sarif/a--b/h/codex-x.sarif.gz',
    gz,
    {
      access: 'private',
      contentType: 'application/gzip',
    }
  )
})
