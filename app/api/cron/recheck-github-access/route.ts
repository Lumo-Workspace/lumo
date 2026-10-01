import { NextRequest, NextResponse } from 'next/server'
import { githubAccessRecheckService } from '@/lib/services/github-access-recheck.service'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { parseInstallationIds } from '@/lib/validation/github-installation-ids'

export const runtime = 'nodejs'
/** The sweep stops itself at 240s and resumes from a cursor next run. */
export const maxDuration = 300

/**
 * GET /api/cron/recheck-github-access — daily (vercel.json).
 * LUM-882: narrow each workspace's confirmed GitHub repositories to what its
 * verifier can still read, asked with the installation token (no user
 * credential is kept). Removed repositories have their scan code scrubbed.
 * The `repository` webhook covers privatized / transferred repositories
 * between runs.
 *
 * LUM-927 — when the removal breaker trips, the response lists the held
 * installation ids; an operator who has checked them re-runs with
 * `?confirmRemovals=<id>,<id>` to unbind and scrub exactly those.
 *
 * Cron only: gated by the shared CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  return NextResponse.json(
    await githubAccessRecheckService.sweep(undefined, {
      confirmRemovals: parseInstallationIds(
        req.nextUrl.searchParams.get('confirmRemovals')
      ),
    })
  )
}
