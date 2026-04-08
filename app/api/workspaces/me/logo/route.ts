import { NextRequest, NextResponse } from 'next/server'
import { put, del } from '@vercel/blob'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { requireAuth, getUserWorkspace } from '@/lib/auth'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

function extFromMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

/**
 * POST /api/workspaces/me/logo
 * Accepts multipart/form-data with a "file" field.
 * Deletes the previous logo from Vercel Blob (if any), uploads the new one, updates the DB.
 * Caller must be workspace OWNER.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }
    if (ws.member.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Only owners can change the logo' },
        { status: 403 }
      )
    }

    // ── Parse & validate ──────────────────────────────────────────────────────
    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'File must be PNG, JPEG, or WebP' },
        { status: 400 }
      )
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'File must be 2 MB or smaller' },
        { status: 400 }
      )
    }

    // ── Delete old blob ───────────────────────────────────────────────────────
    const oldLogoUrl = ws.workspace.logoUrl
    if (oldLogoUrl) {
      try {
        await del(oldLogoUrl)
      } catch {
        // Ignore — blob may already be gone
      }
    }

    // ── Upload new blob ───────────────────────────────────────────────────────
    const ext = extFromMime(file.type)
    const pathname = `workspaces/${ws.workspaceId}/logo-${Date.now()}.${ext}`

    const blob = await put(pathname, file, {
      access: 'public',
      contentType: file.type,
    })

    // ── Persist ───────────────────────────────────────────────────────────────
    await workspaceRepository.update(ws.workspaceId, { logoUrl: blob.url })

    return NextResponse.json({ logoUrl: blob.url })
  } catch (error) {
    console.error('POST /api/workspaces/me/logo error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
