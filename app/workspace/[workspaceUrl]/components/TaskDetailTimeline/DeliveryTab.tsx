'use client'

import { useIntl } from 'react-intl'
import type { TaskDetail, WorkspaceMemberInfo } from '../../types'
import type { MentionSources } from '@/types/mention'
import { DeliveryPanel } from '../DeliveryPanel'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { TokenUsageSection } from '../AgentRunTimeline/TokenUsageSection'
import { AgentRunList } from '../AgentRunTimeline/AgentRunList'
import { deriveRunDigest } from '../AgentRunTimeline/derive-run-digest'
import { AcceptanceTab } from './AcceptanceTab'
import type { HumanVerdictResult } from './VerdictDecision'

export type DeliverySubTab = 'runs' | 'acceptance'

interface DeliveryTabProps {
  taskId: string
  taskIdentifier: string
  taskStatus: TaskDetail['status']
  agentStatus?: string | null | undefined
  workspaceUrl: string
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string }[]
  enabled: boolean
  subTab: DeliverySubTab
  onSubTabChange: (tab: DeliverySubTab) => void
  onVerdictRecorded: (result: HumanVerdictResult) => void
  mentionSources?: MentionSources | undefined
}

export function DeliveryTab({
  taskId,
  taskIdentifier,
  taskStatus,
  agentStatus,
  workspaceUrl,
  members,
  agentActors,
  enabled,
  subTab,
  onSubTabChange,
  onVerdictRecorded,
  mentionSources,
}: DeliveryTabProps) {
  const intl = useIntl()

  // Runs power both sub-views now: the runs list AND the acceptance verdict
  // card's latest-run summary (LUM-481). Enabled for the whole delivery tab so
  // `runs[0]` is available on the acceptance sub-view — same react-query key,
  // so switching sub-segments does not refetch.
  const { data, loading, error } = useAgentRuns({
    taskId,
    enabled,
  })
  const runs = data?.runs ?? []
  // Same two-layer rule as the run card: prefer the LLM-synthesized summary,
  // else fall back to the raw digest joined into one line, else nothing.
  const latestRunSummary =
    runs[0]?.runSummary ??
    (runs[0] ? deriveRunDigest(runs[0].items ?? []).join(' · ') || null : null)
  const hasModels = (data?.totals.byModel.length ?? 0) > 0
  // Footer = the token-usage body of the delivery card. Null only when runs
  // exist but captured no model usage, so the card shows no empty divider.
  const showTokenSection = loading || !!error || runs.length === 0 || hasModels
  const tokenFooter = showTokenSection ? (
    <TokenUsageSection
      data={data}
      loading={loading}
      error={error}
      taskIdentifier={taskIdentifier}
    />
  ) : null

  const segBtn = (active: boolean) =>
    `px-4 py-1 text-sm rounded-md transition-colors ${
      active
        ? 'bg-background font-semibold shadow-elevation-1'
        : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <div>
      <div className='inline-flex gap-1 bg-muted p-1 rounded-lg mb-4'>
        <button
          type='button'
          className={segBtn(subTab === 'runs')}
          onClick={() => onSubTabChange('runs')}
        >
          {intl.formatMessage({
            id: 'task.agentRun',
            defaultMessage: 'Agent Run',
          })}
        </button>
        <button
          type='button'
          className={segBtn(subTab === 'acceptance')}
          onClick={() => onSubTabChange('acceptance')}
        >
          {intl.formatMessage({
            id: 'task.acceptance',
            defaultMessage: 'Acceptance',
          })}
        </button>
      </div>

      {/* The delivery forecast/cost summary belongs with the runs — it's the
          headline for "what this task burned". The Acceptance sub-segment is
          kept clean (verdict + criteria only), so the budget panel never sits
          on top of the adjudication surface. */}
      {subTab === 'runs' && (
        <div className='space-y-4'>
          <DeliveryPanel
            taskId={taskId}
            status={taskStatus}
            agentStatus={agentStatus}
            footer={tokenFooter}
          />
          {runs.length > 0 && <AgentRunList runs={runs} />}
        </div>
      )}
      {subTab === 'acceptance' && (
        <AcceptanceTab
          taskIdentifier={taskIdentifier}
          enabled={enabled && subTab === 'acceptance'}
          workspaceUrl={workspaceUrl}
          members={members}
          agentActors={agentActors}
          onVerdictRecorded={onVerdictRecorded}
          latestRunSummary={latestRunSummary}
          {...(mentionSources ? { mentionSources } : {})}
        />
      )}
    </div>
  )
}
