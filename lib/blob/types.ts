/**
 * LUM-1021 — the storage-neutral blob interface. Every blob read/write in the
 * app goes through a `BlobStorage` (see `@/lib/blob/storage`); the SDKs
 * (`@vercel/blob`, `@aws-sdk/*`) are only imported by the backends in this
 * folder (guarded by __tests__/lib/blob/blob-sdk-import-guard.test.ts).
 *
 * Access is part of every call, never inferred from the object: a backend
 * keeps public and private objects in separate namespaces (two Vercel stores,
 * two key prefixes in one S3 bucket, two directories on disk), so a private
 * object can never be reached by a public read — and vice versa.
 */
import { randomBytes } from 'node:crypto'

export type BlobAccess = 'public' | 'private'
export type BlobBackendKind = 'vercel' | 's3' | 'disk'

export type BlobBody = Blob | Buffer | Uint8Array | ReadableStream<Uint8Array>

export interface PutBlobOptions {
  access: BlobAccess
  contentType?: string
  /** Append a random suffix to the file name (before the extension). */
  addRandomSuffix?: boolean
  /** Replace an existing object at the same pathname (default: refuse). */
  allowOverwrite?: boolean
  /** Hint for large bodies (Vercel multipart upload). */
  multipart?: boolean
}

export interface StoredBlob {
  /** The reference to persist and pass back to get/delete. Public objects:
   *  a URL a browser can load. Private objects: an opaque, non-fetchable
   *  reference on S3/disk; the Vercel private-store URL on Vercel (which
   *  needs the store token to read). */
  url: string
  pathname: string
}

export interface OpenedBlob {
  stream: ReadableStream<Uint8Array>
  contentType: string
  size: number
}

export interface GetBlobOptions {
  /** Bypass any CDN cache (Vercel `useCache: false`). */
  noCache?: boolean
}

export interface ListedBlob {
  url: string
  pathname: string
  uploadedAt: Date
}

export interface ListBlobsOptions {
  access: BlobAccess
  prefix: string
  limit?: number
  cursor?: string
}

export interface ListBlobsPage {
  blobs: ListedBlob[]
  cursor?: string
  hasMore: boolean
}

export interface BlobStorage {
  readonly kind: BlobBackendKind
  put(
    pathname: string,
    body: BlobBody,
    opts: PutBlobOptions
  ): Promise<StoredBlob>
  /** The object's bytes, or null when it does not exist (in that access
   *  namespace). */
  get(
    urlOrPathname: string,
    access: BlobAccess,
    opts?: GetBlobOptions
  ): Promise<OpenedBlob | null>
  /** Delete one or many objects; missing objects are not an error. */
  delete(urlsOrPathnames: string | string[], access: BlobAccess): Promise<void>
  list(opts: ListBlobsOptions): Promise<ListBlobsPage>
  /**
   * A short-lived URL that lets whoever holds it read one PRIVATE object
   * without further auth. Only S3 supports it (presigned GET); Vercel and
   * disk throw 501 — their private objects are read server-side and streamed
   * by an authorising route instead.
   */
  signedReadUrl(
    urlOrPathname: string,
    expiresInSeconds?: number
  ): Promise<string>
}

export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300
export const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60

/** Opaque reference scheme for objects on S3 / disk. */
export const BLOB_REF_SCHEME = 'lumo-blob:'
/** App route that serves PUBLIC objects on S3 / disk (workspace logos). */
export const PUBLIC_BLOB_ROUTE = '/api/blob/public/'

export function blobError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

/**
 * Reject anything that could escape a namespace: absolute paths, `..`/`.`
 * segments, empty segments, backslashes, NUL / control characters.
 */
export function assertSafePathname(pathname: string): string {
  if (
    typeof pathname !== 'string' ||
    pathname.length === 0 ||
    pathname.length > 1024 ||
    pathname.startsWith('/') ||
    pathname.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(pathname)
  ) {
    throw blobError(`unsafe blob pathname: ${JSON.stringify(pathname)}`, 400)
  }
  for (const seg of pathname.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw blobError(`unsafe blob pathname: ${JSON.stringify(pathname)}`, 400)
    }
  }
  return pathname
}

/** Prefixes may end in `/` (or be empty = everything). */
export function assertSafePrefix(prefix: string): string {
  if (prefix === '') return prefix
  assertSafePathname(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix)
  return prefix
}

/** `a/b/name.zip` → `a/b/name-<random>.zip` (Vercel's suffix shape). */
export function withRandomSuffix(pathname: string): string {
  const suffix = randomBytes(16).toString('base64url').slice(0, 21)
  const slash = pathname.lastIndexOf('/')
  const dot = pathname.lastIndexOf('.')
  if (dot > slash + 1) {
    return `${pathname.slice(0, dot)}-${suffix}${pathname.slice(dot)}`
  }
  return `${pathname}-${suffix}`
}

/** The reference S3 / disk hand back for an object. */
export function blobRef(access: BlobAccess, pathname: string): string {
  return access === 'public'
    ? `${PUBLIC_BLOB_ROUTE}${pathname}`
    : `${BLOB_REF_SCHEME}private/${pathname}`
}

/**
 * Resolve a reference (or bare pathname) to the pathname inside `access`'s
 * namespace. A reference that names the OTHER namespace is refused — a
 * private read never resolves to a public object or vice versa.
 */
export function pathnameFromRef(ref: string, access: BlobAccess): string {
  let pathname = ref
  let refAccess: BlobAccess | null = null
  if (ref.startsWith(BLOB_REF_SCHEME)) {
    const rest = ref.slice(BLOB_REF_SCHEME.length)
    const slash = rest.indexOf('/')
    const ns = slash > 0 ? rest.slice(0, slash) : ''
    if (ns !== 'public' && ns !== 'private') {
      throw blobError(`unknown blob reference: ${ref}`, 400)
    }
    refAccess = ns
    pathname = rest.slice(slash + 1)
  } else if (/^https?:\/\//i.test(ref) || ref.startsWith(PUBLIC_BLOB_ROUTE)) {
    const path = /^https?:\/\//i.test(ref) ? new URL(ref).pathname : ref
    if (!path.startsWith(PUBLIC_BLOB_ROUTE)) {
      throw blobError(`not a blob reference of this backend: ${ref}`, 400)
    }
    refAccess = 'public'
    try {
      pathname = decodeURI(path.slice(PUBLIC_BLOB_ROUTE.length))
    } catch {
      throw blobError(`malformed blob reference: ${ref}`, 400)
    }
  }
  if (refAccess && refAccess !== access) {
    throw blobError(
      `a ${refAccess} blob reference used for ${access} access`,
      400
    )
  }
  return assertSafePathname(pathname)
}

export function clampTtl(expiresInSeconds?: number): number {
  const ttl = Math.floor(expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS)
  if (!Number.isFinite(ttl) || ttl < 1) return DEFAULT_SIGNED_URL_TTL_SECONDS
  return Math.min(ttl, MAX_SIGNED_URL_TTL_SECONDS)
}

/** Read any accepted body into one Buffer. */
export async function bodyToBuffer(body: BlobBody): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer())
  }
  return Buffer.from(
    await new Response(body as ReadableStream<Uint8Array>).arrayBuffer()
  )
}

/** Content type of a body when the caller gave none. */
export function inferContentType(body: BlobBody, given?: string): string {
  if (given) return given
  if (typeof Blob !== 'undefined' && body instanceof Blob && body.type) {
    return body.type
  }
  return 'application/octet-stream'
}

/**
 * Delete everything under `prefix` in one namespace; returns the count. Each
 * round re-lists from the start instead of following a cursor, because the
 * previous round's deletions shift the listing (LUM-861 semantics).
 */
export async function deleteAllByPrefix(
  storage: Pick<BlobStorage, 'list' | 'delete'>,
  prefix: string,
  access: BlobAccess
): Promise<number> {
  let deleted = 0
  for (;;) {
    const page = await storage.list({ prefix, access, limit: 1000 })
    const urls = page.blobs.map(b => b.url)
    if (urls.length === 0) return deleted
    await storage.delete(urls, access)
    deleted += urls.length
    if (!page.hasMore) return deleted
  }
}
