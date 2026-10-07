/**
 * LUM-1021 — S3-compatible backend (AWS S3, MinIO, R2, …) for self-hosting.
 *
 * One bucket, two key namespaces: `public/<pathname>` and
 * `private/<pathname>`. The bucket itself must stay PRIVATE (no public-read
 * policy): every read goes through the SDK with the server's credentials —
 * private objects are streamed by an authorising route or handed out as a
 * short-lived presigned URL; public objects (workspace logos) are served by
 * `GET /api/blob/public/...`, which can only reach the `public/` namespace.
 */
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  assertSafePathname,
  assertSafePrefix,
  blobError,
  blobRef,
  bodyToBuffer,
  clampTtl,
  inferContentType,
  pathnameFromRef,
  withRandomSuffix,
  type BlobAccess,
  type BlobStorage,
  type ListBlobsPage,
} from '@/lib/blob/types'

export interface S3BlobConfig {
  bucket: string
  region: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  forcePathStyle: boolean
}

/** Read the S3_* env vars; null when S3_BUCKET is not set. */
export function s3ConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): S3BlobConfig | null {
  const bucket = env.S3_BUCKET?.trim()
  if (!bucket) return null
  const endpoint = env.S3_ENDPOINT?.trim() || undefined
  const pathStyle = env.S3_FORCE_PATH_STYLE?.trim().toLowerCase()
  return {
    bucket,
    region: env.S3_REGION?.trim() || 'us-east-1',
    ...(endpoint ? { endpoint } : {}),
    ...(env.S3_ACCESS_KEY_ID?.trim()
      ? { accessKeyId: env.S3_ACCESS_KEY_ID.trim() }
      : {}),
    ...(env.S3_SECRET_ACCESS_KEY?.trim()
      ? { secretAccessKey: env.S3_SECRET_ACCESS_KEY.trim() }
      : {}),
    // MinIO and most self-hosted S3s need path-style addressing.
    forcePathStyle:
      pathStyle === undefined || pathStyle === ''
        ? Boolean(endpoint)
        : pathStyle === 'true' || pathStyle === '1',
  }
}

export function s3ClientFor(config: S3BlobConfig): S3Client {
  const opts: S3ClientConfig = {
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    // Only checksum when the operation requires it: many S3-compatible
    // servers do not implement the newer default checksum headers.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.accessKeyId && config.secretAccessKey
      ? {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }
      : {}),
  }
  return new S3Client(opts)
}

function keyOf(access: BlobAccess, pathname: string): string {
  return `${access}/${pathname}`
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return (
    e?.name === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.$metadata?.httpStatusCode === 404
  )
}

function isAlreadyExists(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return (
    e?.name === 'PreconditionFailed' || e?.$metadata?.httpStatusCode === 412
  )
}

export function createS3BlobStorage(
  config: S3BlobConfig,
  client: S3Client = s3ClientFor(config)
): BlobStorage {
  const Bucket = config.bucket

  return {
    kind: 's3',

    async put(pathname, body, opts) {
      assertSafePathname(pathname)
      const finalPath = opts.addRandomSuffix
        ? withRandomSuffix(pathname)
        : pathname
      const bytes = await bodyToBuffer(body)
      try {
        await client.send(
          new PutObjectCommand({
            Bucket,
            Key: keyOf(opts.access, finalPath),
            Body: bytes,
            ContentLength: bytes.length,
            ContentType: inferContentType(body, opts.contentType),
            // Same default as Vercel Blob: never silently replace an object.
            ...(opts.allowOverwrite ? {} : { IfNoneMatch: '*' }),
          })
        )
      } catch (error) {
        if (isAlreadyExists(error)) {
          throw blobError(`blob already exists: ${finalPath}`, 409)
        }
        throw error
      }
      return { url: blobRef(opts.access, finalPath), pathname: finalPath }
    },

    async get(urlOrPathname, access) {
      const pathname = pathnameFromRef(urlOrPathname, access)
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket, Key: keyOf(access, pathname) })
        )
        const body = res.Body as
          | { transformToWebStream?: () => ReadableStream<Uint8Array> }
          | undefined
        if (!body?.transformToWebStream) return null
        return {
          stream: body.transformToWebStream(),
          contentType: res.ContentType ?? 'application/octet-stream',
          size: Number(res.ContentLength ?? 0),
        }
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },

    async delete(urlsOrPathnames, access) {
      const refs = Array.isArray(urlsOrPathnames)
        ? urlsOrPathnames
        : [urlsOrPathnames]
      const keys = refs.map(r => keyOf(access, pathnameFromRef(r, access)))
      // DeleteObjects takes at most 1000 keys per request.
      for (let i = 0; i < keys.length; i += 1000) {
        const res = await client.send(
          new DeleteObjectsCommand({
            Bucket,
            Delete: {
              Objects: keys.slice(i, i + 1000).map(Key => ({ Key })),
              Quiet: true,
            },
          })
        )
        const failed = (res.Errors ?? []).filter(e => e.Code !== 'NoSuchKey')
        if (failed.length > 0) {
          throw new Error(
            `S3 delete failed for ${failed.length} object(s): ${failed[0]?.Code ?? 'unknown'}`
          )
        }
      }
    },

    async list({ access, prefix, limit, cursor }): Promise<ListBlobsPage> {
      assertSafePrefix(prefix)
      const ns = `${access}/`
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: `${ns}${prefix}`,
          MaxKeys: Math.min(limit ?? 1000, 1000),
          ...(cursor ? { ContinuationToken: cursor } : {}),
        })
      )
      const blobs = (res.Contents ?? [])
        .filter(o => o.Key?.startsWith(ns))
        .map(o => {
          const pathname = (o.Key as string).slice(ns.length)
          return {
            url: blobRef(access, pathname),
            pathname,
            uploadedAt: o.LastModified ?? new Date(0),
          }
        })
      const next = res.IsTruncated ? res.NextContinuationToken : undefined
      return {
        blobs,
        hasMore: Boolean(next),
        ...(next ? { cursor: next } : {}),
      }
    },

    async signedReadUrl(urlOrPathname, expiresInSeconds) {
      const pathname = pathnameFromRef(urlOrPathname, 'private')
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket, Key: keyOf('private', pathname) }),
        { expiresIn: clampTtl(expiresInSeconds) }
      )
    },
  }
}
