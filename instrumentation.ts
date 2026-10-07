/**
 * Next.js boot hook. LUM-1030: a self-hosted deployment on the Postgres World
 * starts its in-process workflow worker here (official world-postgres
 * example). On Vercel — or any deployment that does not select
 * WORKFLOW_TARGET_WORLD=@workflow/world-postgres — this is a no-op.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') return
  const { startSelfHostedWorkflowWorld } =
    await import('@/lib/runtime/workflow-world-start')
  await startSelfHostedWorkflowWorld()
}
