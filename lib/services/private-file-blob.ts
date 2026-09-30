/**
 * LUM-916 — the only place that touches @vercel/blob for private uploads
 * (test evidence, editor images). Kept tiny so the services and routes are
 * testable without the SDK; callers load it with a dynamic import where a
 * jsdom test might otherwise pull undici in.
 */
import { get, put } from '@vercel/blob'
import { privateBlobToken } from '@/lib/blob/private-store'

export async function putPrivateFile(
  pathname: string,
  body: Blob | Buffer,
  contentType: string
): Promise<void> {
  await put(pathname, body, {
    access: 'private',
    token: privateBlobToken(),
    contentType,
    // The pathname already ends in a CSPRNG id; a suffix would change it
    // and break the URL we hand back.
    addRandomSuffix: false,
  })
}

export interface OpenedFile {
  stream: ReadableStream<Uint8Array>
  contentType: string
  size: number
}

/** A private blob's bytes, or null when it does not exist. */
export async function openPrivateFile(
  pathname: string
): Promise<OpenedFile | null> {
  const res = await get(pathname, {
    access: 'private',
    token: privateBlobToken(),
  })
  if (!res || res.statusCode !== 200 || !res.stream) return null
  return {
    stream: res.stream,
    contentType: res.blob.contentType ?? 'application/octet-stream',
    size: res.blob.size,
  }
}
