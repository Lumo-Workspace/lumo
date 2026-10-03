import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { hookEventRetentionService } from '@/lib/services/hook-event-retention.service'
import { prCommentDeadLetterRetentionService } from '@/lib/services/pr-comment-dead-letter-retention.service'
import { crossingRawRetentionService } from '@/lib/services/crossing-raw-retention.service'

export const maxDuration = 300

/**
 * GET /api/cron/prune-hook-event-payloads
 * Daily Vercel Cron for raw-payload retention (Settings → Data retention).
 *  - LUM-859 / LUM-910: clears the raw payload of hook events per each
 *    workspace's session record setting (a day tier, or used-up mode); see
 *    `hookEventRetentionService.pruneExpiredPayloads`.
 *  - LUM-913 / LUM-941: drops the GitHub webhook payload of PR comment sync
 *    jobs the workspace's window after they entered DEAD_LETTER; see
 *    `prCommentDeadLetterRetentionService.purgeExpiredPayloads`.
 *  - LUM-912: replaces the raw text of dispositioned boundary crossings with
 *    a code-free description; see `crossingRawRetentionService.purgeExpired`.
 * Each step runs even when another one fails, so one cannot starve the rest.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const [hookEvents, deadLetters, crossings] = await Promise.allSettled([
    hookEventRetentionService.pruneExpiredPayloads(),
    prCommentDeadLetterRetentionService.purgeExpiredPayloads(),
    crossingRawRetentionService.purgeExpired(),
  ])
  if (hookEvents.status === 'rejected') throw hookEvents.reason
  if (deadLetters.status === 'rejected') throw deadLetters.reason
  if (crossings.status === 'rejected') throw crossings.reason
  return NextResponse.json({
    ...hookEvents.value,
    prCommentDeadLetters: deadLetters.value,
    crossingRaw: crossings.value,
  })
}
