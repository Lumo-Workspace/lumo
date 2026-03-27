'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Slack, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { API } from '../constants'

interface SlackStatus {
  connected: boolean
  slackTeamName?: string
  slackUserId?: string
  slackTeamId?: string
}

export function SlackIntegrationCard({ isOwner }: { isOwner: boolean }) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [status, setStatus] = useState<SlackStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(API.slack.integration(workspaceUrl))
      if (res.ok) setStatus(await res.json())
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [workspaceUrl])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Handle ?slack_connected=1 and ?slack_error=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('slack_connected') === '1') {
      toast.success('Slack connected successfully')
      fetchStatus()
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('slack_error') === '1') {
      toast.error('Failed to connect Slack')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [fetchStatus])

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      const res = await fetch(API.slack.integration(workspaceUrl), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error()
      setStatus({ connected: false })
      toast.success('Slack disconnected')
    } catch {
      toast.error('Failed to disconnect Slack')
    } finally {
      setDisconnecting(false)
      setDisconnectOpen(false)
    }
  }

  return (
    <>
      <div className='rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden'>
        {/* Header */}
        <div className='flex items-center justify-between px-6 py-5 bg-white dark:bg-zinc-900'>
          <div className='flex items-center gap-3'>
            <div className='size-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0'>
              <Slack size={18} className='text-zinc-700 dark:text-zinc-300' />
            </div>
            <div>
              <p className='text-sm font-semibold text-zinc-900 dark:text-zinc-100'>
                Slack
              </p>
              <p className='text-xs text-zinc-500 dark:text-zinc-400'>
                Send notifications and manage tasks from Slack.
              </p>
            </div>
          </div>

          {loading ? (
            <Loader2 size={16} className='animate-spin text-zinc-400' />
          ) : status?.connected ? (
            <span className='flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>
              <Check size={12} />
              Connected
            </span>
          ) : isOwner ? (
            <Button
              size='sm'
              onClick={() => {
                window.open(API.slack.oauth(workspaceUrl), '_blank')
              }}
            >
              Connect Slack
            </Button>
          ) : null}
        </div>

        {/* Connected state */}
        {status?.connected && (
          <div className='border-t border-zinc-100 dark:border-zinc-800 px-6 py-5 bg-zinc-50 dark:bg-zinc-900/50 space-y-4'>
            <p className='text-xs text-zinc-500 dark:text-zinc-400'>
              Connected to workspace:{' '}
              <span className='font-medium text-zinc-700 dark:text-zinc-300'>
                {status.slackTeamName}
              </span>
            </p>

            <p className='text-xs text-zinc-400 dark:text-zinc-500'>
              Channel notifications are configured per project.
            </p>

            {isOwner && (
              <div className='flex items-center justify-end pt-1'>
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-zinc-400 hover:text-destructive'
                  onClick={() => setDisconnectOpen(true)}
                >
                  Disconnect
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Disconnect confirmation */}
      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Slack?</AlertDialogTitle>
            <AlertDialogDescription>
              All channel subscriptions will be removed. You can reconnect at
              any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <Loader2 size={14} className='animate-spin' />
              ) : (
                'Disconnect'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
