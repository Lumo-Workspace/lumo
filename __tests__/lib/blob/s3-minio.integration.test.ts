/**
 * @jest-environment node
 */
// LUM-1021: the S3 backend against a REAL MinIO. Skipped unless
// MINIO_TEST_ENDPOINT is set. Start a local MinIO container, then run this
// file with MINIO_TEST_ENDPOINT (e.g. http://127.0.0.1:9000) plus
// MINIO_TEST_ACCESS_KEY / MINIO_TEST_SECRET_KEY set to its root user and
// password.
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { randomUUID } from 'node:crypto'
import {
  createS3BlobStorage,
  type S3BlobConfig,
} from '@/lib/blob/s3-blob-storage'
import { deleteAllByPrefix } from '@/lib/blob/types'

const endpoint = process.env.MINIO_TEST_ENDPOINT
const describeMinio = endpoint ? describe : describe.skip

describeMinio('S3 backend on real MinIO', () => {
  const bucket = `lum1021-${randomUUID().slice(0, 8)}`
  const config: S3BlobConfig = {
    bucket,
    region: 'us-east-1',
    endpoint: endpoint ?? '',
    accessKeyId: process.env.MINIO_TEST_ACCESS_KEY ?? '',
    secretAccessKey: process.env.MINIO_TEST_SECRET_KEY ?? '',
    forcePathStyle: true,
  }
  const storage = createS3BlobStorage(config)
  const objectUrl = (key: string) => `${endpoint}/${bucket}/${key}`

  beforeAll(async () => {
    const admin = new S3Client({
      region: config.region,
      endpoint: config.endpoint ?? '',
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId!,
        secretAccessKey: config.secretAccessKey!,
      },
    })
    await admin.send(new CreateBucketCommand({ Bucket: bucket }))
  })

  it('upload → authorised read → unauthenticated read refused → delete', async () => {
    const stored = await storage.put(
      'test-evidence/t/c/f1',
      Buffer.from('private bytes'),
      { access: 'private', contentType: 'text/plain' }
    )
    const got = await storage.get(stored.url, 'private')
    expect(await new Response(got!.stream).text()).toBe('private bytes')

    const signed = await storage.signedReadUrl(stored.url, 60)
    const ok = await fetch(signed)
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('private bytes')

    const anon = await fetch(objectUrl('private/test-evidence/t/c/f1'))
    expect(anon.status).toBe(403)
    const tampered = new URL(signed)
    tampered.searchParams.set('X-Amz-Signature', '0'.repeat(64))
    expect((await fetch(tampered)).status).toBe(403)

    await expect(storage.get(stored.pathname, 'public')).resolves.toBeNull()

    await storage.delete(stored.url, 'private')
    await expect(storage.get(stored.url, 'private')).resolves.toBeNull()
  })

  it('refuses overwrite by default and batch-deletes by prefix', async () => {
    await storage.put('w/x/a', Buffer.from('1'), { access: 'private' })
    await expect(
      storage.put('w/x/a', Buffer.from('2'), { access: 'private' })
    ).rejects.toMatchObject({ status: 409 })
    for (let i = 0; i < 3; i++)
      await storage.put(`w/x/b${i}`, Buffer.from('x'), { access: 'private' })
    await storage.put('w/x/logo-1.png', Buffer.from('p'), { access: 'public' })
    await expect(deleteAllByPrefix(storage, 'w/x/', 'private')).resolves.toBe(4)
    await expect(deleteAllByPrefix(storage, 'w/x/', 'public')).resolves.toBe(1)
  })
})
