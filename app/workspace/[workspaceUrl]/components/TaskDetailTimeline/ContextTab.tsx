'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import { Accordion } from '@/components/landing/ui/accordion'
import { useSlackContexts } from '../../hooks/useSlackContexts'
import { useTaskDocuments } from '../../hooks/useTaskDocuments'
import { useFigmaLinks } from '../../hooks/useFigmaLinks'
import { SlackContextSection } from './sections/SlackContextSection'
import { WebLinkSection } from './sections/WebLinkSection'
import { FigmaSection } from './sections/FigmaSection'
import { PullRequestsSection } from './sections/PullRequestsSection'
import { DocumentsSection } from './sections/DocumentsSection'
import { SpecArtifactGroup } from '../SpecArtifactGroup'

interface PullRequestSummary {
  id: string
  number: number
  title: string
  url: string
  state: string
  ciStatus: string | null
  /** LUM-889: the repository left the confirmed list; state is not refreshed. */
  statusSyncPaused?: boolean
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
  const intl = useIntl()
  const slack = useSlackContexts(taskId, enabled)
  const docs = useTaskDocuments(taskId, enabled)
  const figma = useFigmaLinks(taskId, enabled)

  const defaultOpen = useMemo(() => {
    const open: string[] = []
    if (slack.contexts.length > 0) open.push('slack')
    if (pullRequests.length > 0) open.push('pullRequests')
    if (docs.documents.length > 0) open.push('documents')
    if (figma.figmaLinks.length > 0) open.push('figma')
    return open
  }, [
    slack.contexts.length,
    pullRequests.length,
    docs.documents.length,
    figma.figmaLinks.length,
  ])

  return (
    <div>
      <SpecArtifactGroup taskId={taskId} />

      <p className='text-caption font-semibold text-muted-foreground mb-3'>
        {intl.formatMessage({
          id: 'context.group.reference',
          defaultMessage: 'References',
        })}
      </p>

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
        <WebLinkSection taskId={taskId} />
        <FigmaSection taskId={taskId} />
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
          taskId={taskId}
          onAttached={docs.refresh}
        />
      </Accordion>
    </div>
  )
}
