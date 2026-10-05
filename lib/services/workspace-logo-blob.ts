/**
 * LUM-907 PR3 — the only place that touches @vercel/blob for workspace logos
 * (public store: the logo is shown on public surfaces). Kept tiny so the logo
 * service is testable without the SDK.
 */
import { put, del } from '@vercel/blob'

/** Upload a logo; returns its public URL. */
export async function uploadWorkspaceLogo(
  pathname: string,
  file: File
): Promise<string> {
  const blob = await put(pathname, file, {
    access: 'public',
    contentType: file.type,
  })
  return blob.url
}

/** Delete a previous logo; a blob that is already gone is not an error. */
export async function deleteWorkspaceLogo(url: string): Promise<void> {
  try {
    await del(url)
  } catch {
    // Ignore — the blob may already be gone.
  }
}
