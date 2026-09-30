import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { parsePrivateFilePath } from '@/lib/files/private-file-path'
import { privateFileService } from '@/lib/services/private-file.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ path: string[] }> }

/**
 * Served files are customer-authored bytes on OUR origin (SVG can carry
 * script; a text file can be sniffed as HTML). `nosniff` pins the declared
 * type and the sandbox CSP strips scripting from anything a browser renders
 * directly — the file can never run as Lumo.
 */
const SAFETY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  // Never on a shared cache: the response depends on who is asking.
  'Cache-Control': 'private, max-age=300',
}

const notFound = () =>
  NextResponse.json({ error: 'Not found' }, { status: 404 })

/**
 * GET /api/files/<blob pathname> — LUM-916. Streams a private upload (test
 * evidence, editor image) to a member of the workspace that owns it, or an
 * image to anyone presenting `?share=<token>` of a public document that
 * embeds it. Anonymous without a share token → 401; anything else the
 * caller may not read → 404 (no existence oracle).
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { path } = await params
  const file = parsePrivateFilePath(path.join('/'))
  if (!file) return notFound()

  const shareToken = request.nextUrl.searchParams.get('share')
  const identity = await requireIdentity(request)
  const viewerWorkspaceId =
    identity instanceof NextResponse ? null : identity.workspaceId
  if (!viewerWorkspaceId && !shareToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allowed = await privateFileService.canRead(file, {
    viewerWorkspaceId,
    shareToken,
  })
  if (!allowed) return notFound()

  const opened = await privateFileService.open(file)
  if (!opened) return notFound()

  return new NextResponse(opened.stream, {
    status: 200,
    headers: {
      ...SAFETY_HEADERS,
      'Content-Type': opened.contentType,
      'Content-Length': String(opened.size),
      'Content-Disposition': 'inline',
    },
  })
}
