/**
 * @jest-environment node
 */
// LUM-1021: the S3 backend with a real S3Client whose `send` is stubbed (no
// network). Presigning is pure local signing, so it runs for real.
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import {
  createS3BlobStorage,
  s3ConfigFromEnv,
  type S3BlobConfig,
} from '@/lib/blob/s3-blob-storage'

const config: S3BlobConfig = {
  bucket: 'lumo',
  region: 'us-east-1',
  endpoint: 'http://minio.test:9000',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'not-a-real-secret',
  forcePathStyle: true,
}

function setup() {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint!,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId!,
      secretAccessKey: config.secretAccessKey!,
    },
  })
  const send = jest.spyOn(client, 'send') as unknown as jest.Mock
  return { storage: createS3BlobStorage(config, client), send }
}

describe('s3ConfigFromEnv', () => {
  it('null without a bucket; path-style defaults on with a custom endpoint', () => {
    expect(s3ConfigFromEnv({})).toBeNull()
    expect(
      s3ConfigFromEnv({ S3_BUCKET: 'b', S3_ENDPOINT: 'http://m:9000' })
    ).toEqual({
      bucket: 'b',
      region: 'us-east-1',
      endpoint: 'http://m:9000',
      forcePathStyle: true,
    })
    expect(s3ConfigFromEnv({ S3_BUCKET: 'b', S3_REGION: 'eu-west-1' })).toEqual(
      {
        bucket: 'b',
        region: 'eu-west-1',
        forcePathStyle: false,
      }
    )
    expect(
      s3ConfigFromEnv({
        S3_BUCKET: 'b',
        S3_ENDPOINT: 'http://m',
        S3_FORCE_PATH_STYLE: 'false',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
      })
    ).toMatchObject({
      forcePathStyle: false,
      accessKeyId: 'k',
      secretAccessKey: 's',
    })
  })
})

describe('S3 backend', () => {
  const notFound = () =>
    Object.assign(new Error('nf'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    })
  const commandsOf = (send: jest.Mock) =>
    send.mock.calls.map(c => (c[0] as object).constructor.name)

  it('put writes under the access namespace, refuses overwrite by default', async () => {
    const { storage, send } = setup()
    send.mockRejectedValueOnce(notFound()).mockResolvedValue({})
    const stored = await storage.put('test-evidence/t/c/f', Buffer.from('hi'), {
      access: 'private',
      contentType: 'text/plain',
    })
    expect(stored).toEqual({
      url: 'lumo-blob:private/test-evidence/t/c/f',
      pathname: 'test-evidence/t/c/f',
    })
    const head = send.mock.calls[0]![0] as HeadObjectCommand
    expect(head).toBeInstanceOf(HeadObjectCommand)
    expect(head.input).toEqual({
      Bucket: 'lumo',
      Key: 'private/test-evidence/t/c/f',
    })
    const cmd = send.mock.calls[1]![0] as PutObjectCommand
    expect(cmd).toBeInstanceOf(PutObjectCommand)
    expect(cmd.input).toMatchObject({
      Bucket: 'lumo',
      Key: 'private/test-evidence/t/c/f',
      ContentType: 'text/plain',
      ContentLength: 2,
      IfNoneMatch: '*',
    })

    // allowOverwrite: no existence check, no conditional header.
    await storage.put('workspaces/w/logo-1.png', Buffer.from('p'), {
      access: 'public',
      allowOverwrite: true,
    })
    expect(send).toHaveBeenCalledTimes(3)
    const cmd2 = send.mock.calls[2]![0] as PutObjectCommand
    expect(cmd2).toBeInstanceOf(PutObjectCommand)
    expect(cmd2.input.Key).toBe('public/workspaces/w/logo-1.png')
    expect(cmd2.input).not.toHaveProperty('IfNoneMatch')
  })

  it('server honours If-None-Match: a 412 (lost race after the check) → 409', async () => {
    const { storage, send } = setup()
    send.mockRejectedValueOnce(notFound()).mockRejectedValueOnce(
      Object.assign(new Error('pre'), {
        name: 'PreconditionFailed',
        $metadata: { httpStatusCode: 412 },
      })
    )
    await expect(
      storage.put('a/b', Buffer.from('x'), { access: 'private' })
    ).rejects.toMatchObject({ status: 409 })
    expect(commandsOf(send)).toEqual(['HeadObjectCommand', 'PutObjectCommand'])
  })

  it('server IGNORES If-None-Match: the prior HeadObject refuses the overwrite without writing', async () => {
    const { storage, send } = setup()
    // HeadObject finds the object; a put would have silently overwritten.
    send.mockResolvedValueOnce({ ContentLength: 1 }).mockResolvedValue({})
    await expect(
      storage.put('a/b', Buffer.from('x'), { access: 'private' })
    ).rejects.toMatchObject({ status: 409 })
    expect(commandsOf(send)).toEqual(['HeadObjectCommand'])
  })

  it('server REJECTS If-None-Match (501 NotImplemented): falls back to check-then-put, and remembers', async () => {
    const { storage, send } = setup()
    send
      .mockRejectedValueOnce(notFound())
      .mockRejectedValueOnce(
        Object.assign(new Error('ni'), {
          name: 'NotImplemented',
          $metadata: { httpStatusCode: 501 },
        })
      )
      .mockResolvedValueOnce({})
    await expect(
      storage.put('a/b', Buffer.from('x'), { access: 'private' })
    ).resolves.toMatchObject({ pathname: 'a/b' })
    expect(commandsOf(send)).toEqual([
      'HeadObjectCommand',
      'PutObjectCommand',
      'PutObjectCommand',
    ])
    expect(send.mock.calls[1]![0].input).toHaveProperty('IfNoneMatch', '*')
    expect(send.mock.calls[2]![0].input).not.toHaveProperty('IfNoneMatch')

    // Next put: no conditional header attempt, existence still enforced.
    send.mockReset()
    send.mockRejectedValueOnce(notFound()).mockResolvedValueOnce({})
    await storage.put('a/c', Buffer.from('y'), { access: 'private' })
    expect(commandsOf(send)).toEqual(['HeadObjectCommand', 'PutObjectCommand'])
    expect(send.mock.calls[1]![0].input).not.toHaveProperty('IfNoneMatch')
    send.mockReset()
    send.mockResolvedValueOnce({})
    await expect(
      storage.put('a/c', Buffer.from('z'), { access: 'private' })
    ).rejects.toMatchObject({ status: 409 })
    expect(commandsOf(send)).toEqual(['HeadObjectCommand'])
  })

  it('a 400 InvalidArgument to If-None-Match also falls back; other put errors propagate', async () => {
    const { storage, send } = setup()
    send
      .mockRejectedValueOnce(notFound())
      .mockRejectedValueOnce(
        Object.assign(new Error('bad'), {
          name: 'InvalidArgument',
          $metadata: { httpStatusCode: 400 },
        })
      )
      .mockResolvedValueOnce({})
    await storage.put('a/b', Buffer.from('x'), { access: 'private' })
    expect(send).toHaveBeenCalledTimes(3)

    const other = setup()
    other.send.mockRejectedValueOnce(notFound()).mockRejectedValueOnce(
      Object.assign(new Error('denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      })
    )
    await expect(
      other.storage.put('a/b', Buffer.from('x'), { access: 'private' })
    ).rejects.toThrow('denied')
    expect(other.send).toHaveBeenCalledTimes(2)
  })

  it('a HeadObject error other than 404 propagates (never writes blind)', async () => {
    const { storage, send } = setup()
    send.mockRejectedValueOnce(
      Object.assign(new Error('forbidden'), {
        name: 'Forbidden',
        $metadata: { httpStatusCode: 403 },
      })
    )
    await expect(
      storage.put('a/b', Buffer.from('x'), { access: 'private' })
    ).rejects.toThrow('forbidden')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('get streams the body; NoSuchKey → null; a public ref cannot read private', async () => {
    const { storage, send } = setup()
    send.mockResolvedValueOnce({
      Body: { transformToWebStream: () => new Blob(['bytes']).stream() },
      ContentType: 'application/zip',
      ContentLength: 5,
    })
    const got = await storage.get('lumo-blob:private/w/e/x.zip', 'private')
    expect(got?.size).toBe(5)
    expect(got?.contentType).toBe('application/zip')
    expect(await new Response(got!.stream).text()).toBe('bytes')
    const cmd = send.mock.calls[0]![0] as GetObjectCommand
    expect(cmd.input).toEqual({ Bucket: 'lumo', Key: 'private/w/e/x.zip' })

    send.mockRejectedValueOnce(
      Object.assign(new Error('nf'), { name: 'NoSuchKey' })
    )
    await expect(storage.get('w/missing', 'private')).resolves.toBeNull()

    await expect(
      storage.get('/api/blob/public/w/e/x.zip', 'private')
    ).rejects.toThrow(/public blob reference used for private access/)
  })

  it('other errors propagate', async () => {
    const { storage, send } = setup()
    send.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { name: 'AccessDenied' })
    )
    await expect(storage.get('w/x', 'private')).rejects.toThrow('denied')
  })

  it('batch delete chunks at 1000 keys and ignores NoSuchKey', async () => {
    const { storage, send } = setup()
    send.mockResolvedValue({ Errors: [{ Key: 'k', Code: 'NoSuchKey' }] })
    const refs = Array.from(
      { length: 1500 },
      (_, i) => `lumo-blob:private/p/${i}`
    )
    await storage.delete(refs, 'private')
    expect(send).toHaveBeenCalledTimes(2)
    const first = send.mock.calls[0]![0] as DeleteObjectsCommand
    expect(first).toBeInstanceOf(DeleteObjectsCommand)
    expect(first.input.Delete!.Objects).toHaveLength(1000)
    expect(first.input.Delete!.Objects![0]).toEqual({ Key: 'private/p/0' })
    expect(
      (send.mock.calls[1]![0] as DeleteObjectsCommand).input.Delete!.Objects
    ).toHaveLength(500)
  })

  it('a real delete error fails loudly', async () => {
    const { storage, send } = setup()
    send.mockResolvedValue({ Errors: [{ Key: 'k', Code: 'AccessDenied' }] })
    await expect(storage.delete('p/1', 'private')).rejects.toThrow(
      /AccessDenied/
    )
  })

  it('list maps keys back to pathnames/refs and carries the continuation token', async () => {
    const { storage, send } = setup()
    const at = new Date('2026-10-01T00:00:00Z')
    send.mockResolvedValueOnce({
      Contents: [{ Key: 'private/security-sarif/a', LastModified: at }],
      IsTruncated: true,
      NextContinuationToken: 'tok',
    })
    const page = await storage.list({
      access: 'private',
      prefix: 'security-sarif/',
      limit: 5,
    })
    expect(page).toEqual({
      blobs: [
        {
          url: 'lumo-blob:private/security-sarif/a',
          pathname: 'security-sarif/a',
          uploadedAt: at,
        },
      ],
      hasMore: true,
      cursor: 'tok',
    })
    const cmd = send.mock.calls[0]![0] as ListObjectsV2Command
    expect(cmd.input).toEqual({
      Bucket: 'lumo',
      Prefix: 'private/security-sarif/',
      MaxKeys: 5,
    })
  })

  it('presigns a short-lived GET for a PRIVATE object only', async () => {
    const { storage, send } = setup()
    const url = new URL(
      await storage.signedReadUrl('lumo-blob:private/w/e/x.zip', 60)
    )
    expect(url.origin).toBe('http://minio.test:9000')
    expect(url.pathname).toBe('/lumo/private/w/e/x.zip')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(send).not.toHaveBeenCalled()
    await expect(
      storage.signedReadUrl('/api/blob/public/workspaces/w/logo-1.png')
    ).rejects.toThrow(/public blob reference used for private access/)
  })
})
