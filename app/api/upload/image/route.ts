import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'

const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

function extFromMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/svg+xml') return 'svg'
  return 'jpg'
}

/**
 * POST /api/upload/image
 * Accepts multipart/form-data with:
 *   - file   Image file (PNG / JPEG / WebP / GIF / SVG), max 10 MB
 *   - folder Optional path segment (e.g., taskId) — stored under
 *            documents/{folder}/{timestamp}-{random}.ext
 *            Falls back to "misc" when omitted.
 *
 * Returns { url: string } on success.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    // ── Parse & validate ──────────────────────────────────────────────────────
    const formData = await request.formData()
    const file = formData.get('file')
    const folder = (formData.get('folder') as string | null) ?? 'misc'

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'File must be PNG, JPEG, WebP, GIF, or SVG' },
        { status: 400 }
      )
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'File must be 10 MB or smaller' },
        { status: 400 }
      )
    }

    // ── Upload ─────────────────────────────────────────────────────────────────
    const ext = extFromMime(file.type)
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // e.g. documents/task_abc123/1748000000000-xk7r2f.png
    const pathname = `documents/${folder}/${unique}.${ext}`

    const blob = await put(pathname, file, {
      access: 'public',
      contentType: file.type,
    })

    return NextResponse.json({ url: blob.url })
  } catch (error) {
    console.error('POST /api/upload/image error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
