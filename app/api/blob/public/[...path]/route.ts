import { NextResponse } from 'next/server'
import { openWorkspaceLogo } from '@/lib/services/workspace-logo-blob'

export const runtime = 'nodejs'

type Params = { params: Promise<{ path: string[] }> }

/**
 * GET /api/blob/public/<pathname> — LUM-1021. Serves PUBLIC blobs (workspace
 * logos) on self-hosted S3 / local-disk storage, where there is no CDN URL.
 * Anonymous by design — logos are public. It reads only the public
 * namespace and only logo-shaped pathnames, so a private object (evidence,
 * editor image, export, SARIF) is unreachable here; on Vercel it is always
 * 404 (logos are served by the public store's CDN).
 */
export async function GET(_request: Request, { params }: Params) {
  const { path } = await params
  const opened = await openWorkspaceLogo(path.join('/')).catch(() => null)
  if (!opened) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return new NextResponse(opened.stream, {
    status: 200,
    headers: {
      'Content-Type': opened.contentType,
      'Content-Length': String(opened.size),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // The pathname carries the upload timestamp, so the bytes never change.
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  })
}
