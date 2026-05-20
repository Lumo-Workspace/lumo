'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Plus } from 'lucide-react'
import type { SlackContextResource } from '@/lib/api-client/slack-contexts'
import { ContextSection } from '../ContextSection'
import { SlackContextCard } from '../SlackContextCard'
import { AddSlackContextDialog } from '../AddSlackContextDialog'

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
  const [dialogOpen, setDialogOpen] = useState(false)

  const addSlot = slackConnected ? (
    <button
      onClick={() => setDialogOpen(true)}
      className='inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
    >
      <Plus size={12} />
      {intl.formatMessage({
        id: 'slackContext.add',
        defaultMessage: 'Add Slack message',
      })}
    </button>
  ) : null

  return (
    <>
      <ContextSection
        value='slack'
        label={intl.formatMessage({
          id: 'task.context.section.slack',
          defaultMessage: 'Slack',
        })}
        count={contexts.length}
        addSlot={addSlot}
      >
        {!slackConnected ? (
          <div className='py-4 text-sm text-zinc-500'>
            {intl.formatMessage({
              id: 'slackContext.empty.notConnected',
              defaultMessage:
                'Connect Slack to attach messages as task context.',
            })}
          </div>
        ) : contexts.length === 0 ? (
          <div className='py-4 text-sm text-zinc-500 text-center'>
            {intl.formatMessage({
              id: 'slackContext.empty.noContexts',
              defaultMessage: 'No Slack messages attached yet.',
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

      <AddSlackContextDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={async permalink => {
          await onLink(permalink)
        }}
      />
    </>
  )
}
