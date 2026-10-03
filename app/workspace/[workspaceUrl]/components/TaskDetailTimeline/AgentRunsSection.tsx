'use client'

import type { TaskDetail, AgentRunSession } from '../../types'
import { DeliveryPanel } from '../DeliveryPanel'
import { anyRunOverstated } from '@/lib/agent-run/usage-dedupe-cutoff'
import { AgentRunList } from '../AgentRunTimeline/AgentRunList'

interface AgentRunsSectionProps {
  taskId: string
  taskStatus: TaskDetail['status']
  agentStatus?: string | null | undefined
  /** Run sessions, fetched once at the dossier level (single source) and passed
   *  in — so the decision head's count and this list cannot drift. */
  runs: AgentRunSession[]
}

/**
 * The ④ "Agent 运行" sub-section of the task dossier (LUM-567) — the per-session
 * delivery evidence: the forecast / progress / retrospective card plus the run
 * list. Lifted out of the old Delivery tab's "runs" sub-view, with one
 * deliberate change: the token-total footer is dropped (`footer` omitted). Cost
 * is owned by the ③ "cost & risk" region (field-unique home in the data
 * ownership matrix), so the runs evidence carries only per-session detail, never
 * a second copy of the cost total.
 *
 * LUM-619: the mechanical-gates panel is no longer mounted here. It moved up
 * into the Acceptance container's audit-only zone (surfaced next to boundary
 * crossings + claim-vs-verification), so it's no longer buried in this
 * evidence sub-section — hence no `footer` on the delivery card.
 */
export function AgentRunsSection({
  taskId,
  taskStatus,
  agentStatus,
  runs,
}: AgentRunsSectionProps) {
  return (
    <div className='space-y-4'>
      <DeliveryPanel
        taskId={taskId}
        status={taskStatus}
        agentStatus={agentStatus}
        preDedupe={anyRunOverstated(runs)}
      />
      {runs.length > 0 && <AgentRunList runs={runs} />}
    </div>
  )
}
