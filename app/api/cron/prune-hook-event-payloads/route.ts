import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { hookEventRetentionService } from '@/lib/services/hook-event-retention.service'
import { prCommentDeadLetterRetentionService } from '@/lib/services/pr-comment-dead-letter-retention.service'

export const maxDuration = 300

/**
 * GET /api/cron/prune-hook-event-payloads
 * Daily Vercel Cron for raw-payload retention.
 *  - LUM-859: clears the raw payload of hook events older than each
 *    workspace's opted-in retention window; see
 *    `hookEventRetentionService.pruneExpiredPayloads` for what is kept and exempt.
 *  - LUM-913: drops the GitHub webhook payload of PR comment sync jobs 7 days
 *    after they entered DEAD_LETTER; see
 *    `prCommentDeadLetterRetentionService.purgeExpiredPayloads`.
 * Each step runs even when the other one fails, so one cannot starve the other.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const [hookEvents, deadLetters] = await Promise.allSettled([
    hookEventRetentionService.pruneExpiredPayloads(),
    prCommentDeadLetterRetentionService.purgeExpiredPayloads(),
  ])
  if (hookEvents.status === 'rejected') throw hookEvents.reason
  if (deadLetters.status === 'rejected') throw deadLetters.reason
  return NextResponse.json({
    ...hookEvents.value,
    prCommentDeadLetters: deadLetters.value,
  })
}
