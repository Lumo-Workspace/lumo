'use client'

import { useIntl } from 'react-intl'
import { SlackIcon } from '@/components/icons/SlackIcon'
import { useIdeaSlackContexts } from '../../hooks/useIdeaSlackContexts'
import { useIntegrationConnected } from '../../hooks/useIntegrationConnected'
import { ContextSection } from '../TaskDetailTimeline/ContextSection'
import { SlackContextCard } from '../TaskDetailTimeline/SlackContextCard'
import { LinkSlackPopover } from '../LinkSlackPopover'

interface Props {
  ideaId: string
}

/** Idea-scoped mirror of `SlackContextSection` (Task variant) — same reused
 * `SlackContextCard` + `LinkSlackPopover` + `ContextSection`, backed by the
 * idea hook instead of the task one.
 *
 * Slack is a workspace asset, so the connection state is read from the
 * workspace rather than threaded in as a prop: the Task variant can take one
 * because its server layout already loads `workspace.slackIntegration`, but the
 * idea pool page is client-side and had no such value — it passed nothing and
 * the default `false` misreported every connected workspace (LUM-684). */
export function IdeaSlackSection({ ideaId }: Props): React.ReactElement {
  const intl = useIntl()
  const { contexts, link, refreshOne, unlink } = useIdeaSlackContexts(ideaId)
  const { connected, loading, integrationsHref } =
    useIntegrationConnected('slack')

  // Gate on an explicit `false` only — while the read is in flight the answer
  // is unknown, and guessing "not connected" is the bug this section had.
  const notConnected = connected === false

  const addSlot = (
    <LinkSlackPopover
      connected={!notConnected}
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
      {loading ? (
        <div className='py-4 text-caption text-muted-foreground text-center'>
          {intl.formatMessage({
            id: 'common.loading',
            defaultMessage: 'Loading…',
          })}
        </div>
      ) : notConnected ? (
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
