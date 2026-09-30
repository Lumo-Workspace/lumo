import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { trashService } from '@/lib/services'

/**
 * GET /api/cron/purge-trash
 * Daily Vercel Cron (LUM-918). Permanently deletes tasks and documents that
 * have been in the trash for 30 days.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const result = await trashService.purgeExpired()
  return NextResponse.json(result)
}
