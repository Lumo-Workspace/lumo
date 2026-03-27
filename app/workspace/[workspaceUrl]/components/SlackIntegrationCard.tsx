'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Slack, Check, Plus, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  ALL_SLACK_EVENTS,
  SLACK_EVENT_LABELS,
  SlackEventType,
} from '@/lib/slack/types'

interface SlackChannel {
  id: string
  channelId: string
  channelName: string
  events: SlackEventType[]
}

interface SlackStatus {
  connected: boolean
  slackTeamName?: string
  slackUserId?: string
  slackTeamId?: string
}

interface AvailableChannel {
  id: string
  name: string
  private: boolean
}

export function SlackIntegrationCard({ isOwner }: { isOwner: boolean }) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [status, setStatus] = useState<SlackStatus | null>(null)
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [addChannelOpen, setAddChannelOpen] = useState(false)

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

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch(API.slack.channels(workspaceUrl))
      if (res.ok) {
        const data = await res.json()
        setChannels(data.channels ?? [])
      }
    } catch {
      /* ignore */
    }
  }, [workspaceUrl])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  useEffect(() => {
    if (status?.connected) fetchChannels()
  }, [status?.connected, fetchChannels])

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
      setChannels([])
      toast.success('Slack disconnected')
    } catch {
      toast.error('Failed to disconnect Slack')
    } finally {
      setDisconnecting(false)
      setDisconnectOpen(false)
    }
  }

  const handleRemoveChannel = async (id: string) => {
    try {
      await fetch(API.slack.channelById(id), { method: 'DELETE' })
      setChannels(prev => prev.filter(c => c.id !== id))
    } catch {
      toast.error('Failed to remove channel')
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

            {/* Channels list */}
            <div>
              <p className='text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2'>
                Notification channels
              </p>

              {channels.length > 0 ? (
                <ul className='space-y-1.5'>
                  {channels.map(ch => (
                    <li
                      key={ch.id}
                      className='flex items-start justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700'
                    >
                      <div className='min-w-0'>
                        <p className='text-xs font-mono font-medium text-zinc-700 dark:text-zinc-300'>
                          {ch.channelName}
                        </p>
                        <div className='flex flex-wrap gap-1 mt-1'>
                          {ch.events.map(ev => (
                            <span
                              key={ev}
                              className='text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
                            >
                              {SLACK_EVENT_LABELS[ev]}
                            </span>
                          ))}
                        </div>
                      </div>
                      {isOwner && (
                        <button
                          onClick={() => handleRemoveChannel(ch.id)}
                          className='text-zinc-400 hover:text-red-500 transition-colors ml-3 shrink-0 mt-0.5'
                          title='Remove channel'
                        >
                          <X size={13} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='text-xs text-zinc-400 dark:text-zinc-500 italic'>
                  No channels configured yet.
                </p>
              )}
            </div>

            {isOwner && (
              <div className='flex items-center justify-between pt-1'>
                <Button
                  variant='outline'
                  size='sm'
                  className='gap-1.5'
                  onClick={() => setAddChannelOpen(true)}
                >
                  <Plus size={13} />
                  Add channel
                </Button>
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

      {/* Add channel dialog */}
      <AddSlackChannelDialog
        open={addChannelOpen}
        onOpenChange={setAddChannelOpen}
        workspaceUrl={workspaceUrl}
        existingChannelIds={channels.map(c => c.channelId)}
        onAdded={ch => {
          setChannels(prev => [...prev, ch])
          setAddChannelOpen(false)
        }}
      />
    </>
  )
}

function AddSlackChannelDialog({
  open,
  onOpenChange,
  workspaceUrl,
  existingChannelIds,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceUrl: string
  existingChannelIds: string[]
  onAdded: (channel: SlackChannel) => void
}) {
  const [availableChannels, setAvailableChannels] = useState<
    AvailableChannel[]
  >([])
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<SlackEventType[]>([
    ...ALL_SLACK_EVENTS,
  ])
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoadingChannels(true)
    setSelectedEvents([...ALL_SLACK_EVENTS])
    fetch(API.slack.availableChannels(workspaceUrl))
      .then(r => r.json())
      .then(data => {
        const chs: AvailableChannel[] = data.channels ?? []
        setAvailableChannels(chs)
        const first = chs.find(c => !existingChannelIds.includes(c.id))
        setSelectedChannelId(first?.id ?? '')
      })
      .catch(() => toast.error('Failed to load Slack channels'))
      .finally(() => setLoadingChannels(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggleEvent = (ev: SlackEventType) => {
    setSelectedEvents(prev =>
      prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]
    )
  }

  const handleSave = async () => {
    const ch = availableChannels.find(c => c.id === selectedChannelId)
    if (!ch) return
    setSaving(true)
    try {
      const res = await fetch(API.slack.channels(workspaceUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: ch.id,
          channelName: ch.name,
          events: selectedEvents,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to add channel')
        return
      }
      onAdded(data.channel)
      toast.success(`${ch.name} added`)
    } catch {
      toast.error('Failed to add channel')
    } finally {
      setSaving(false)
    }
  }

  const available = availableChannels.filter(
    c => !existingChannelIds.includes(c.id)
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Slack channel</DialogTitle>
          <DialogDescription>
            Select a channel to receive Lumo notifications.
          </DialogDescription>
        </DialogHeader>

        {loadingChannels ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 size={20} className='animate-spin text-zinc-400' />
          </div>
        ) : available.length === 0 ? (
          <p className='text-xs text-zinc-400 text-center py-6'>
            All accessible channels have been added.
          </p>
        ) : (
          <div className='space-y-4'>
            {/* Channel picker */}
            <ul className='max-h-48 overflow-y-auto space-y-1'>
              {available.map(c => (
                <li key={c.id}>
                  <button
                    onClick={() => setSelectedChannelId(c.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left ${
                      selectedChannelId === c.id
                        ? 'bg-zinc-100 dark:bg-zinc-800'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    {selectedChannelId === c.id ? (
                      <Check size={14} className='text-emerald-500 shrink-0' />
                    ) : (
                      <div className='size-3.5 shrink-0' />
                    )}
                    <span className='text-sm text-zinc-700 dark:text-zinc-300 font-mono'>
                      {c.name}
                    </span>
                    {c.private && (
                      <span className='ml-auto text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'>
                        private
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>

            {/* Event checkboxes */}
            <div>
              <p className='text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2'>
                Notify on
              </p>
              <div className='grid grid-cols-2 gap-1.5'>
                {ALL_SLACK_EVENTS.map(ev => (
                  <label
                    key={ev}
                    className='flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer'
                  >
                    <input
                      type='checkbox'
                      checked={selectedEvents.includes(ev)}
                      onChange={() => toggleEvent(ev)}
                      className='rounded'
                    />
                    {SLACK_EVENT_LABELS[ev]}
                  </label>
                ))}
              </div>
            </div>

            <Button
              size='sm'
              className='w-full'
              onClick={handleSave}
              disabled={
                saving || !selectedChannelId || selectedEvents.length === 0
              }
            >
              {saving ? (
                <Loader2 size={14} className='animate-spin mr-2' />
              ) : null}
              {saving ? 'Adding…' : 'Add channel'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
