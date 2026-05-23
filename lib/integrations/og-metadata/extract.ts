// lib/integrations/og-metadata/extract.ts
//
// Thin adapter around link-preview-js's `getPreviewFromContent`. It expects an
// already-fetched body (we still own the HTTP layer because the library does
// not surface HTTP status codes, which our should-escalate.ts classifier
// depends on). This module's job is just to translate the library's richer
// response shape into our OgData contract.
import { getPreviewFromContent } from 'link-preview-js'

export interface OgData {
  title?: string | undefined
  description?: string | undefined
  imageUrl?: string | undefined
  faviconUrl?: string | undefined
}

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function pickFirstString(v: unknown): string | undefined {
  if (!Array.isArray(v)) return undefined
  for (const item of v) {
    const s = pickString(item)
    if (s) return s
  }
  return undefined
}

export async function extractOgData(
  html: string,
  baseUrl: string
): Promise<OgData> {
  // link-preview-js returns absolute URLs for images/favicons (it resolves
  // against `url`), so we don't need a manual `resolve(href, base)` step here.
  const preview = (await getPreviewFromContent({
    url: baseUrl,
    headers: {},
    data: html,
  })) as Record<string, unknown>

  return {
    title: pickString(preview.title),
    description: pickString(preview.description),
    imageUrl: pickFirstString(preview.images),
    faviconUrl: pickFirstString(preview.favicons),
  }
}
