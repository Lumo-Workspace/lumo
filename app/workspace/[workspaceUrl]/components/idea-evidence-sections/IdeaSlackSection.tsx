'use client'

import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { SlackIcon } from '@/components/icons/SlackIcon'
import { useIdeaSlackContexts } from '../../hooks/useIdeaSlackContexts'
import { ContextSection } from '../TaskDetailTimeline/ContextSection'
import { SlackContextCard } from '../TaskDetailTimeline/SlackContextCard'
import { LinkSlackPopover } from '../LinkSlackPopover'

interface Props {
  ideaId: string
  slackConnected: boolean
}

/** Idea-scoped mirror of `SlackContextSection` (Task variant) — same reused
 * `SlackContextCard` + `LinkSlackPopover` + `ContextSection`, backed by the
 * idea hook instead of the task one. */
export function IdeaSlackSection({
  ideaId,
  slackConnected,
}: Props): React.ReactElement {
  const intl = useIntl()
  const params = useParams<{ workspaceUrl: string }>()
  const { contexts, link, refreshOne, unlink } = useIdeaSlackContexts(ideaId)

  const integrationsHref = `/workspace/${params.workspaceUrl}/settings/integrations`

  const addSlot = (
    <LinkSlackPopover
      connected={slackConnected}
      integrationsHref={integrationsHref}
      onAttach={link}
    />
  )

  return (
    <ContextSection
      value='slack'
      label={intl.formatMessage({
        id: 'task.context.section.slack',
        defaultMessage: 'Slack',
      })}
      icon={<SlackIcon size={14} />}
      count={contexts.length}
      addSlot={addSlot}
    >
      {!slackConnected ? (
        <div className='py-4 text-caption text-muted-foreground text-center'>
          {intl.formatMessage({
            id: 'slackContext.notConnected.title',
            defaultMessage: 'Slack not connected',
          })}
        </div>
      ) : contexts.length === 0 ? (
        <div className='py-4 text-caption text-muted-foreground text-center'>
          {intl.formatMessage({
            id: 'slackContext.empty.noContexts',
            defaultMessage: 'No Slack messages',
          })}
        </div>
      ) : (
        <div className='space-y-3'>
          {contexts.map(c => (
            <SlackContextCard
              key={c.id}
              context={c}
              onRefresh={() => refreshOne(c.id)}
              onUnlink={() => unlink(c.id)}
            />
          ))}
        </div>
      )}
    </ContextSection>
  )
}
