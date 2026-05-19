'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Plus } from 'lucide-react'
import { useSlackContexts } from '../../hooks/useSlackContexts'
import { SlackContextCard } from './SlackContextCard'
import { AddSlackContextDialog } from './AddSlackContextDialog'

interface Props {
  taskId: string
  slackConnected: boolean
}

export function SlackContextTab({
  taskId,
  slackConnected,
}: Props): React.ReactElement {
  const intl = useIntl()
  const { contexts, link, refreshOne, unlink } = useSlackContexts(taskId)
  const [dialogOpen, setDialogOpen] = useState(false)

  if (!slackConnected) {
    return (
      <div className='py-6 text-sm text-zinc-500'>
        {intl.formatMessage({
          id: 'slackContext.empty.notConnected',
          defaultMessage: 'Connect Slack to attach messages as task context.',
        })}
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex justify-end'>
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
      </div>

      {contexts.length === 0 ? (
        <div className='py-6 text-sm text-zinc-500 text-center'>
          {intl.formatMessage({
            id: 'slackContext.empty.noContexts',
            defaultMessage: 'No Slack messages attached yet.',
          })}
        </div>
      ) : (
        contexts.map(c => (
          <SlackContextCard
            key={c.id}
            context={c}
            onRefresh={() => refreshOne(c.id)}
            onUnlink={() => unlink(c.id)}
          />
        ))
      )}

      <AddSlackContextDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={async permalink => {
          await link(permalink)
        }}
      />
    </div>
  )
}
