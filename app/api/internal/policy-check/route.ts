import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
/**
 * POST /api/internal/policy-check — dedicated per-task code-rule pipeline worker
 * (LUM-590). Mirrors the run-summary worker (LUM-576): task IN_REVIEW transition
 * dispatches exactly one task here so the deterministic diff-regex pass and the
 * semantic LLM judge run in a foreground context with a 300s budget — not inline
 * in the task route's ~15s waitUntil (same shape as the LUM-555 fold incident).
 *
 * Self-call only: gated by the shared CRON_SECRET (same convention as
 * /api/internal/run-summary and /api/internal/fold).
 */
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized

  let body: { taskId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const taskId = typeof body.taskId === 'string' ? body.taskId : null
  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  }

  // Dynamic import keeps the policyCompilerService → @ai-sdk/gateway graph out
  // of the static import chain (same pattern as run-summary and fold routes).
  const { resolvePolicyCheckContext } =
    await import('@/ee/security/services/policy/policy-check-context')
  const ctx = await resolvePolicyCheckContext(taskId)
  if (!ctx) {
    // No linked repo or no open PR — nothing to check.
    logger.info(
      `[policy-check] skipping task=${taskId}: no linked repo or no open PR`
    )
    return NextResponse.json({ skipped: true })
  }

  const { codePipelineService } =
    await import('@/ee/security/services/policy/code-pipeline.service')
  const result = await codePipelineService.runForTask(ctx)
  return NextResponse.json(result)
}
