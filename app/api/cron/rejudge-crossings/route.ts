import { NextRequest, NextResponse } from 'next/server'
import { boundaryCrossingRejudgeService } from '@/lib/services/boundary-crossing-rejudge.service'
import { requireCronAuth } from '@/lib/api/cron-auth'

export const runtime = 'nodejs'
/** ≤ 200 rows × (one cached source read per project + one PR file list per
 *  linked PR); well inside this budget. */
export const maxDuration = 300

/**
 * GET /api/cron/rejudge-crossings — hourly (vercel.json).
 * LUM-780: the exit path for OPEN blocking POLICY_WEAKENING /
 * TEST_FILE_DELETED crossings whose cause no longer holds — the rule text is
 * still in CLAUDE.md, or no linked PR removes a tracked test file. Each row
 * is re-judged by the current detector's criterion against the current
 * state; a cause that is gone makes the row advisory (still open, trailed),
 * anything else is left untouched. Never a disposition.
 *
 * Cron only: gated by the shared CRON_SECRET. The event triggers (policy
 * recompile, PR close) cover the live path; this sweep is the backstop and
 * the path that retires the backlog.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const summary = await boundaryCrossingRejudgeService.sweep()
  // The per-row decisions are for the dry-run script; the cron reports counts.
  const { decisions: _decisions, ...counts } = summary
  return NextResponse.json(counts)
}
