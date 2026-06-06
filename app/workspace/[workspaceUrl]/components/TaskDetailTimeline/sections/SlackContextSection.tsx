'use client'

import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import type { SlackContextResource } from '@/lib/api-client/slack-contexts'
import { SlackIcon } from '@/components/icons/SlackIcon'
import { ContextSection } from '../ContextSection'
import { SlackContextCard } from '../SlackContextCard'
import { LinkSlackPopover } from '../../LinkSlackPopover'

interface Props {
  contexts: SlackContextResource[]
  slackConnected: boolean
  onLink: (permalink: string) => Promise<void>
  onRefreshOne: (contextId: string) => Promise<void>
  onUnlink: (contextId: string) => Promise<void>
}

export function SlackContextSection({
  contexts,
  slackConnected,
  onLink,
  onRefreshOne,
  onUnlink,
}: Props): React.ReactElement {
  const intl = useIntl()
  const params = useParams<{ workspaceUrl: string }>()

  const integrationsHref = `/workspace/${params.workspaceUrl}/settings/integrations`

  const addSlot = (
    <LinkSlackPopover
      connected={slackConnected}
      integrationsHref={integrationsHref}
      onAttach={onLink}
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
        <div className='py-4 text-caption text-zinc-400 dark:text-zinc-500 text-center'>
          {intl.formatMessage({
            id: 'slackContext.notConnected.title',
            defaultMessage: 'Slack not connected',
          })}
        </div>
      ) : contexts.length === 0 ? (
        <div className='py-4 text-caption text-zinc-400 dark:text-zinc-500 text-center'>
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
              onRefresh={() => onRefreshOne(c.id)}
              onUnlink={() => onUnlink(c.id)}
            />
          ))}
        </div>
      )}
    </ContextSection>
  )
}
