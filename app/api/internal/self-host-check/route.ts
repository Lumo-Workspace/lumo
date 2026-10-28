import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import {
  defaultSelfHostProbes,
  runSelfHostChecks,
} from '@/lib/services/self-host-check.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/internal/self-host-check — LUM-1332. Tests every configured
 * component (database, file storage, email, Redis, realtime, public URL)
 * against the real service and returns one result per component.
 * `scripts/self-host/setup.sh` calls it from inside the app container after
 * `docker compose up`. Gated by CRON_SECRET; not served on Vercel, which is
 * not a self-hosted deployment.
 */
export async function POST(request: NextRequest) {
  if (process.env.VERCEL) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized

  const checks = await runSelfHostChecks(defaultSelfHostProbes)
  return NextResponse.json({ checks })
}
