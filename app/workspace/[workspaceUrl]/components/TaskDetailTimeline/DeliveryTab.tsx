'use client'

import { useIntl } from 'react-intl'
import type { TaskDetail, WorkspaceMemberInfo } from '../../types'
import type { MentionSources } from '@/types/mention'
import { DeliveryPanel } from '../DeliveryPanel'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { TokenUsageSection } from '../AgentRunTimeline/TokenUsageSection'
import { AgentRunList } from '../AgentRunTimeline/AgentRunList'
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

  const { data, loading, error } = useAgentRuns({
    taskId,
    enabled: enabled && subTab === 'runs',
  })
  const runs = data?.runs ?? []
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
          {...(mentionSources ? { mentionSources } : {})}
        />
      )}
    </div>
  )
}
