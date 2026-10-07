/**
 * LUM-1021 — which blob backend this deployment uses.
 *
 * Selection (first match wins):
 *   1. `BLOB_STORAGE=vercel|s3|disk` — explicit operator choice;
 *   2. a Vercel Blob token (`BLOB_READ_WRITE_TOKEN` / `BLOB_PRIVATE_READ_WRITE_TOKEN`)
 *      → vercel — so the SaaS deployment never changes backend by accident;
 *   3. `S3_BUCKET` → s3 (MinIO / AWS S3 / any S3-compatible store);
 *   4. `LOCAL_BLOB_DIR` → disk;
 *   5. nothing configured → vercel, which fails on first use with the token
 *      error it always had (blob features stay off until configured).
 *
 * Backends are loaded with a dynamic import: the SDKs pull in undici /
 * node-only modules that break jsdom tests merely importing a service, and a
 * deployment only ever loads the one SDK it uses.
 */
import type { BlobBackendKind, BlobStorage } from '@/lib/blob/types'

type Env = Record<string, string | undefined>

const has = (v: string | undefined) => Boolean(v && v.trim())

export function resolveBlobBackend(env: Env = process.env): BlobBackendKind {
  const explicit = env.BLOB_STORAGE?.trim().toLowerCase()
  if (explicit) {
    if (explicit === 'vercel' || explicit === 's3' || explicit === 'disk') {
      return explicit
    }
    throw new Error(
      `BLOB_STORAGE must be one of vercel, s3, disk (got ${JSON.stringify(env.BLOB_STORAGE)})`
    )
  }
  if (
    has(env.BLOB_READ_WRITE_TOKEN) ||
    has(env.BLOB_PRIVATE_READ_WRITE_TOKEN)
  ) {
    return 'vercel'
  }
  if (has(env.S3_BUCKET)) return 's3'
  if (has(env.LOCAL_BLOB_DIR)) return 'disk'
  return 'vercel'
}

/** Build a backend from env (no caching). */
export async function createBlobStorage(
  env: Env = process.env
): Promise<BlobStorage> {
  const kind = resolveBlobBackend(env)
  if (kind === 's3') {
    const { createS3BlobStorage, s3ConfigFromEnv } =
      await import('@/lib/blob/s3-blob-storage')
    const config = s3ConfigFromEnv(env)
    if (!config) throw new Error('BLOB_STORAGE=s3 needs S3_BUCKET')
    return createS3BlobStorage(config)
  }
  if (kind === 'disk') {
    const dir = env.LOCAL_BLOB_DIR?.trim()
    if (!dir) throw new Error('BLOB_STORAGE=disk needs LOCAL_BLOB_DIR')
    const { createDiskBlobStorage } =
      await import('@/lib/blob/disk-blob-storage')
    return createDiskBlobStorage(dir)
  }
  const { createVercelBlobStorage } =
    await import('@/lib/blob/vercel-blob-storage')
  return createVercelBlobStorage()
}

let cached: { key: string; storage: Promise<BlobStorage> } | null = null

/** Env fields that pick / configure the backend — a change rebuilds it. */
function cacheKey(env: Env): string {
  return [
    'BLOB_STORAGE',
    'BLOB_READ_WRITE_TOKEN',
    'BLOB_PRIVATE_READ_WRITE_TOKEN',
    'S3_BUCKET',
    'S3_ENDPOINT',
    'S3_REGION',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_FORCE_PATH_STYLE',
    'LOCAL_BLOB_DIR',
  ]
    .map(k => `${k}=${has(env[k]) ? env[k] : ''}`)
    .join('\n')
}

/** The deployment's blob backend (memoised per configuration). */
export function getBlobStorage(): Promise<BlobStorage> {
  const key = cacheKey(process.env)
  if (!cached || cached.key !== key) {
    const storage = createBlobStorage(process.env)
    // A failed build must not be cached forever.
    storage.catch(() => {
      if (cached?.storage === storage) cached = null
    })
    cached = { key, storage }
  }
  return cached.storage
}
