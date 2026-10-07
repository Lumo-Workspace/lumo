/**
 * LUM-907 PR3 — workspace logos, the one PUBLIC blob kind (the logo is shown
 * on public surfaces). Since LUM-1021 they go through `BlobStorage`: on
 * Vercel the URL is the public store's CDN URL; on S3 / disk it is
 * `/api/blob/public/<pathname>`, served by `openWorkspaceLogo` below.
 */
import { getBlobStorage } from '@/lib/blob/storage'
import type { OpenedBlob } from '@/lib/blob/types'

/** Upload a logo; returns its public URL. */
export async function uploadWorkspaceLogo(
  pathname: string,
  file: File
): Promise<string> {
  const storage = await getBlobStorage()
  const blob = await storage.put(pathname, file, {
    access: 'public',
    contentType: file.type,
  })
  return blob.url
}

/** Delete a previous logo; a blob that is already gone is not an error. */
export async function deleteWorkspaceLogo(url: string): Promise<void> {
  try {
    const storage = await getBlobStorage()
    await storage.delete(url, 'public')
  } catch {
    // Ignore — the blob may already be gone.
  }
}

/** The only pathnames the public route serves: `uploadWorkspaceLogo`'s. */
const LOGO_PATHNAME_RE =
  /^workspaces\/[A-Za-z0-9_-]+\/logo-\d+\.(?:png|jpg|webp)$/

export function isWorkspaceLogoPathname(pathname: string): boolean {
  return LOGO_PATHNAME_RE.test(pathname)
}

/**
 * LUM-1021 — the bytes behind `/api/blob/public/<pathname>` on S3 / disk.
 * Null unless the pathname is logo-shaped AND the backend serves public
 * objects through the app (Vercel logos live on the CDN). Reads only the
 * PUBLIC namespace, so a private object is unreachable here by construction.
 */
export async function openWorkspaceLogo(
  pathname: string
): Promise<OpenedBlob | null> {
  if (!isWorkspaceLogoPathname(pathname)) return null
  const storage = await getBlobStorage()
  if (storage.kind === 'vercel') return null
  return storage.get(pathname, 'public')
}
