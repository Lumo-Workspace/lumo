import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { logoBucket } from '@/lib/gcs'

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
 * Deletes the previous logo from GCS (if any), uploads the new one, updates the DB.
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

    // ── Delete old GCS object ─────────────────────────────────────────────────
    const oldLogoUrl = ws.workspace.logoUrl
    if (oldLogoUrl) {
      try {
        const bucketName = process.env.GCS_BUCKET!
        const prefix = `https://storage.googleapis.com/${bucketName}/`
        if (oldLogoUrl.startsWith(prefix)) {
          const objectPath = oldLogoUrl.slice(prefix.length)
          await logoBucket.file(objectPath).delete()
        }
      } catch {
        // Ignore — file may already be gone
      }
    }

    // ── Upload new object ─────────────────────────────────────────────────────
    const ext = extFromMime(file.type)
    const objectPath = `workspaces/${ws.workspaceId}/logo-${Date.now()}.${ext}`
    const gcFile = logoBucket.file(objectPath)

    const buffer = Buffer.from(await file.arrayBuffer())
    await gcFile.save(buffer, { contentType: file.type })
    await gcFile.makePublic()

    const logoUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${objectPath}`

    // ── Persist ───────────────────────────────────────────────────────────────
    await prisma.workspace.update({
      where: { id: ws.workspaceId },
      data: { logoUrl },
    })

    return NextResponse.json({ logoUrl })
  } catch (error) {
    console.error('POST /api/workspaces/me/logo error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
