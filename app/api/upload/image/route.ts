import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { privateFileService } from '@/lib/services/private-file.service'
import { logger } from '@/lib/logger'

const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

/**
 * POST /api/upload/image
 * Accepts multipart/form-data with:
 *   - file   Image file (PNG / JPEG / WebP / GIF / SVG), max 10 MB
 *   - folder Ignored (LUM-916). Older clients still send it; the prefix is
 *            chosen by the server so a workspace's images can be found —
 *            and swept on workspace deletion — by prefix.
 *
 * Stored as a PRIVATE blob at workspaces/{workspaceId}/images/{uuid}.
 * Returns { url } — Lumo's file route, readable only by members of the
 * workspace (or, for an image inside a publicly shared document, by anyone
 * holding that document's share token).
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
    const url = await privateFileService.storeImage(
      ws.workspaceId,
      file,
      new URL(request.url).origin
    )

    return NextResponse.json({ url })
  } catch (error) {
    logger.error('POST /api/upload/image error', {
      error: (error as Error).message,
    })
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
