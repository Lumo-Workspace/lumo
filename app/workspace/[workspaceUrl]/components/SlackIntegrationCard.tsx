'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Slack, Plus, Trash2, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
  const [disconnecting, setDisconnecting] = useState(false)
  const [showAddChannel, setShowAddChannel] = useState(false)

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
    if (
      !confirm('Disconnect Slack? All channel subscriptions will be removed.')
    )
      return
    setDisconnecting(true)
    try {
      await fetch(API.slack.integration(workspaceUrl), { method: 'DELETE' })
      setStatus({ connected: false })
      setChannels([])
      toast.success('Slack disconnected')
    } catch {
      toast.error('Failed to disconnect')
    } finally {
      setDisconnecting(false)
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

  if (loading) {
    return (
      <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 p-4'>
        <div className='flex items-center gap-3'>
          <Slack size={20} className='text-zinc-400' />
          <div className='flex-1'>
            <p className='text-sm font-medium'>Slack</p>
            <p className='text-xs text-zinc-500'>Loading...</p>
          </div>
          <Loader2 size={16} className='animate-spin text-zinc-400' />
        </div>
      </div>
    )
  }

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-4'>
      <div className='flex items-center gap-3'>
        <Slack size={20} className='text-zinc-400' />
        <div className='flex-1'>
          <p className='text-sm font-medium'>Slack</p>
          <p className='text-xs text-zinc-500 dark:text-zinc-400'>
            Send notifications and manage tasks from Slack.
          </p>
        </div>
        {status?.connected ? (
          <span className='flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium'>
            ✓ Connected
          </span>
        ) : isOwner ? (
          <Button size='sm' variant='outline' asChild>
            <a href={API.slack.oauth(workspaceUrl)}>Connect Slack</a>
          </Button>
        ) : null}
      </div>

      {status?.connected && (
        <>
          <p className='text-xs text-zinc-500 dark:text-zinc-400'>
            Connected to workspace:{' '}
            <span className='font-medium text-zinc-700 dark:text-zinc-300'>
              {status.slackTeamName}
            </span>
          </p>

          {/* Channels list */}
          <div className='space-y-2'>
            <p className='text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider'>
              Notification Channels
            </p>
            {channels.length === 0 && (
              <p className='text-xs text-zinc-400 dark:text-zinc-500'>
                No channels configured yet.
              </p>
            )}
            {channels.map(ch => (
              <div
                key={ch.id}
                className='flex items-start gap-2 rounded-md border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2'
              >
                <div className='flex-1 min-w-0'>
                  <p className='text-xs font-mono font-medium text-zinc-700 dark:text-zinc-300'>
                    {ch.channelName}
                  </p>
                  <div className='flex flex-wrap gap-1 mt-1'>
                    {ch.events.map(ev => (
                      <span
                        key={ev}
                        className='text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                      >
                        {SLACK_EVENT_LABELS[ev]}
                      </span>
                    ))}
                  </div>
                </div>
                {isOwner && (
                  <button
                    onClick={() => handleRemoveChannel(ch.id)}
                    className='text-zinc-400 hover:text-red-500 transition-colors mt-0.5 shrink-0'
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {isOwner && (
            <div className='flex items-center justify-between pt-1'>
              <Button
                size='sm'
                variant='outline'
                onClick={() => setShowAddChannel(true)}
              >
                <Plus size={13} className='mr-1' />
                Add channel
              </Button>
              <Button
                size='sm'
                variant='ghost'
                onClick={handleDisconnect}
                disabled={disconnecting}
                className='text-zinc-400 hover:text-red-600'
              >
                {disconnecting ? (
                  <Loader2 size={13} className='animate-spin mr-1' />
                ) : (
                  <Trash2 size={13} className='mr-1' />
                )}
                Disconnect
              </Button>
            </div>
          )}

          {showAddChannel && (
            <AddSlackChannelDialog
              workspaceUrl={workspaceUrl}
              onClose={() => setShowAddChannel(false)}
              onAdded={ch => {
                setChannels(prev => [...prev, ch])
                setShowAddChannel(false)
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

function AddSlackChannelDialog({
  workspaceUrl,
  onClose,
  onAdded,
}: {
  workspaceUrl: string
  onClose: () => void
  onAdded: (channel: SlackChannel) => void
}) {
  const [availableChannels, setAvailableChannels] = useState<
    AvailableChannel[]
  >([])
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<SlackEventType[]>([
    ...ALL_SLACK_EVENTS,
  ])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(API.slack.availableChannels(workspaceUrl))
      .then(r => r.json())
      .then(data => {
        const chs = data.channels ?? []
        setAvailableChannels(chs)
        if (chs.length > 0) setSelectedChannelId(chs[0].id)
      })
      .catch(() => toast.error('Failed to load Slack channels'))
      .finally(() => setLoading(false))
  }, [workspaceUrl])

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

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/40'
      onClick={onClose}
    >
      <div
        className='bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xl p-5 w-full max-w-sm space-y-4'
        onClick={e => e.stopPropagation()}
      >
        <div className='flex items-center justify-between'>
          <p className='text-sm font-medium'>Add Slack channel</p>
          <button
            onClick={onClose}
            className='text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className='flex justify-center py-6'>
            <Loader2 size={20} className='animate-spin text-zinc-400' />
          </div>
        ) : (
          <>
            <div className='space-y-1.5'>
              <label className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                Channel
              </label>
              <select
                value={selectedChannelId}
                onChange={e => setSelectedChannelId(e.target.value)}
                className='w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 font-mono'
              >
                {availableChannels.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.private ? ' (private)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className='space-y-1.5'>
              <label className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                Notify on
              </label>
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
          </>
        )}
      </div>
    </div>
  )
}
