'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import type { SlackContextResource } from '@/lib/api-client/slack-contexts'
import { SlackIcon } from '@/components/icons/SlackIcon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ContextSection } from '../ContextSection'
import { SectionAddButton } from '../SectionAddButton'
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
  const router = useRouter()
  const params = useParams<{ workspaceUrl: string }>()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)

  const handleAddClick = () => {
    if (slackConnected) {
      setDialogOpen(true)
    } else {
      setPromptOpen(true)
    }
  }

  const handleOpenSettings = () => {
    setPromptOpen(false)
    router.push(`/workspace/${params.workspaceUrl}/settings/integrations`)
  }

  const addSlot = (
    <SectionAddButton
      onClick={handleAddClick}
      label={intl.formatMessage({
        id: 'slackContext.add',
        defaultMessage: 'Add Slack message',
      })}
    />
  )

  return (
    <>
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
          <div className='py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center'>
            {intl.formatMessage({
              id: 'slackContext.notConnected.title',
              defaultMessage: 'Slack not connected',
            })}
          </div>
        ) : contexts.length === 0 ? (
          <div className='py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center'>
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

      <AddSlackContextDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={async permalink => {
          await onLink(permalink)
        }}
      />

      <AlertDialog open={promptOpen} onOpenChange={setPromptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({
                id: 'slackContext.notConnected.title',
                defaultMessage: 'Slack not connected',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({
                id: 'slackContext.empty.notConnected',
                defaultMessage:
                  'Connect Slack to attach messages as task context.',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {intl.formatMessage({
                id: 'common.cancel',
                defaultMessage: 'Cancel',
              })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleOpenSettings}>
              {intl.formatMessage({
                id: 'slackContext.notConnected.confirm',
                defaultMessage: 'Open settings',
              })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
