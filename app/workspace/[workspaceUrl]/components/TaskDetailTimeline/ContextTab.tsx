'use client'

import { useMemo } from 'react'
import { Accordion } from '@/components/landing/ui/accordion'
import { useSlackContexts } from '../../hooks/useSlackContexts'
import { useTaskDocuments } from '../../hooks/useTaskDocuments'
import { SlackContextSection } from './sections/SlackContextSection'
import { PullRequestsSection } from './sections/PullRequestsSection'
import { DocumentsSection } from './sections/DocumentsSection'

interface PullRequestSummary {
  id: string
  number: number
  title: string
  url: string
  state: string
  ciStatus: string | null
}

interface Props {
  taskId: string
  workspaceId: string
  workspaceUrl: string
  slackConnected: boolean
  pullRequests: PullRequestSummary[]
  onLinkPr: () => void
  onUnlinkPr: (prId: string) => void
  enabled: boolean
}

export function ContextTab({
  taskId,
  workspaceId,
  workspaceUrl,
  slackConnected,
  pullRequests,
  onLinkPr,
  onUnlinkPr,
  enabled,
}: Props): React.ReactElement {
  const slack = useSlackContexts(taskId, enabled)
  const docs = useTaskDocuments(taskId, enabled)

  const defaultOpen = useMemo(() => {
    const open: string[] = []
    if (slack.contexts.length > 0) open.push('slack')
    if (pullRequests.length > 0) open.push('pullRequests')
    if (docs.documents.length > 0) open.push('documents')
    return open
  }, [slack.contexts.length, pullRequests.length, docs.documents.length])

  return (
    <Accordion
      type='multiple'
      defaultValue={defaultOpen}
      key={defaultOpen.join(',')}
    >
      <SlackContextSection
        contexts={slack.contexts}
        slackConnected={slackConnected}
        onLink={slack.link}
        onRefreshOne={slack.refreshOne}
        onUnlink={slack.unlink}
      />
      <PullRequestsSection
        taskId={taskId}
        workspaceId={workspaceId}
        pullRequests={pullRequests}
        onLinkPr={onLinkPr}
        onUnlinkPr={onUnlinkPr}
      />
      <DocumentsSection
        documents={docs.documents}
        workspaceUrl={workspaceUrl}
      />
    </Accordion>
  )
}
