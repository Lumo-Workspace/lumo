'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { API } from '../constants'
import { apiFetch } from '../utils'
import {
  ALL_SLACK_EVENTS,
  SLACK_EVENT_LABELS,
  SlackEventType,
} from '@/lib/slack/types'

interface ProjectSlackDialogProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName: string
  workspaceUrl: string
}

interface AvailableChannel {
  id: string
  name: string
  private: boolean
}

interface SavedChannel {
  id: string
  channelId: string
  channelName: string
  events: SlackEventType[]
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | {
      phase: 'ready'
      savedChannel: SavedChannel | null
      availableChannels: AvailableChannel[]
    }

export function ProjectSlackDialog({
  isOpen,
  onClose,
  projectId,
  projectName,
  workspaceUrl,
}: ProjectSlackDialogProps) {
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' })
  const [enabled, setEnabled] = useState(false)
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [selectedChannelName, setSelectedChannelName] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<SlackEventType[]>([
    ...ALL_SLACK_EVENTS,
  ])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Create-channel inline form
  const [showCreate, setShowCreate] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const createInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!isOpen) return
    setLoadState({ phase: 'loading' })
    try {
      const [channelRes, availableRes] = await Promise.all([
        fetch(API.slack.channels(workspaceUrl, projectId)),
        fetch(API.slack.availableChannels(workspaceUrl)),
      ])
      // If available-channels returns 404, Slack is not connected
      if (availableRes.status === 404) {
        setLoadState({
          phase: 'ready',
          savedChannel: null,
          availableChannels: [],
        })
        setEnabled(false)
        return
      }
      if (!channelRes.ok || !availableRes.ok) throw new Error()
      const channelData = (await channelRes.json()) as {
        channel: SavedChannel | null
      }
      const availableData = (await availableRes.json()) as {
        channels: AvailableChannel[]
      }
      const saved = channelData.channel

      setLoadState({
        phase: 'ready',
        savedChannel: saved,
        availableChannels: availableData.channels ?? [],
      })

      // Initialise form from saved state
      if (saved) {
        setEnabled(true)
        setSelectedChannelId(saved.channelId)
        setSelectedChannelName(saved.channelName)
        setSelectedEvents(saved.events as SlackEventType[])
      } else {
        setEnabled(false)
        setSelectedChannelId('')
        setSelectedChannelName('')
        setSelectedEvents([...ALL_SLACK_EVENTS])
      }
    } catch {
      setLoadState({ phase: 'error' })
    }
  }, [isOpen, workspaceUrl, projectId])

  useEffect(() => {
    if (isOpen) {
      setSaveError(null)
      setShowCreate(false)
      setNewChannelName('')
      setCreateError(null)
      load()
    }
  }, [isOpen, load])

  const handleChannelSelect = (
    channelId: string,
    channels: AvailableChannel[]
  ) => {
    const ch = channels.find(c => c.id === channelId)
    if (!ch) return
    setSelectedChannelId(ch.id)
    setSelectedChannelName(ch.name)
  }

  const toggleEvent = (event: SlackEventType) => {
    setSelectedEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    )
  }

  const isDirty = (savedChannel: SavedChannel | null): boolean => {
    if (!enabled && !savedChannel) return false
    if (!enabled && savedChannel) return true
    if (enabled && !savedChannel)
      return selectedChannelId !== '' && selectedEvents.length > 0
    if (!savedChannel) return false
    if (selectedChannelId !== savedChannel.channelId) return true
    const sortedNew = [...selectedEvents].sort().join(',')
    const sortedOld = [...savedChannel.events].sort().join(',')
    return sortedNew !== sortedOld
  }

  const isSaveDisabled = (savedChannel: SavedChannel | null): boolean => {
    if (saving) return true
    if (!isDirty(savedChannel)) return true
    if (enabled && !selectedChannelId) return true
    if (enabled && selectedEvents.length === 0) return true
    return false
  }

  const handleSave = async (savedChannel: SavedChannel | null) => {
    setSaving(true)
    setSaveError(null)
    try {
      if (!enabled && savedChannel) {
        // Toggle OFF → DELETE
        const res = await fetch(API.slack.channelById(savedChannel.id), {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error('Failed to remove channel')
      } else if (enabled && !savedChannel) {
        // New config → POST
        const res = await apiFetch(
          `/api/slack/channels?workspaceUrl=${workspaceUrl}`,
          {
            method: 'POST',
            body: {
              channelId: selectedChannelId,
              channelName: selectedChannelName,
              events: selectedEvents,
              projectId,
            },
          }
        )
        if (res.status === 409) {
          // Concurrent POST — re-fetch and switch to PATCH path
          await load()
          toast.info('Configuration refreshed from server')
          return
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(data.error ?? 'Failed to save')
        }
      } else if (enabled && savedChannel) {
        // Update → PATCH
        const res = await apiFetch(API.slack.channelById(savedChannel.id), {
          method: 'PATCH',
          body: {
            channelId: selectedChannelId,
            channelName: selectedChannelName,
            events: selectedEvents,
          },
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(data.error ?? 'Failed to save')
        }
      }
      toast.success('Slack notifications updated')
      onClose()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateChannel = async (availableChannels: AvailableChannel[]) => {
    const name = newChannelName.trim()
    if (!name) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await apiFetch(API.slack.createChannel(workspaceUrl), {
        method: 'POST',
        body: { name },
      })
      const data = (await res.json()) as {
        channel?: AvailableChannel
        error?: string
      }
      if (!res.ok) {
        setCreateError(data.error ?? 'Failed to create channel')
        return
      }
      if (!data.channel) {
        setCreateError('Unexpected response from server')
        return
      }
      // Add to available list and auto-select
      if (loadState.phase === 'ready') {
        const newChannel = data.channel
        const already = availableChannels.find(c => c.id === newChannel.id)
        const updatedChannels = already
          ? availableChannels
          : [...availableChannels, newChannel]
        setLoadState(prev =>
          prev.phase === 'ready'
            ? { ...prev, availableChannels: updatedChannels }
            : prev
        )
        setSelectedChannelId(newChannel.id)
        setSelectedChannelName(newChannel.name)
        setEnabled(true)
      }
      setShowCreate(false)
      setNewChannelName('')
      toast.success(`#${name.toLowerCase()} created and selected`)
    } catch {
      setCreateError('Something went wrong. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Slack notifications for {projectName}</DialogTitle>
          <DialogDescription>
            Send notifications to a Slack channel when events occur in this
            project.
          </DialogDescription>
        </DialogHeader>

        {loadState.phase === 'loading' && (
          <div className='flex items-center justify-center py-8'>
            <Loader2 size={20} className='animate-spin text-zinc-400' />
          </div>
        )}

        {loadState.phase === 'error' && (
          <div className='space-y-3 py-2'>
            <p className='text-sm text-red-600 dark:text-red-400'>
              Failed to load configuration.
            </p>
            <Button variant='outline' className='w-full' onClick={load}>
              Retry
            </Button>
          </div>
        )}

        {loadState.phase === 'ready' && (
          <div className='space-y-4 py-2'>
            {/* Not-connected state */}
            {loadState.availableChannels.length === 0 &&
              !loadState.savedChannel && (
                <p className='text-sm text-zinc-500 dark:text-zinc-400'>
                  Slack is not connected to this workspace.{' '}
                  <a
                    href={`/workspace/${workspaceUrl}/settings/integrations`}
                    className='text-blue-600 dark:text-blue-400 hover:underline'
                  >
                    Connect it in Settings →
                  </a>
                </p>
              )}

            {/* Connected state: toggle + channel + events */}
            {(loadState.availableChannels.length > 0 ||
              loadState.savedChannel) && (
              <>
                {/* Toggle */}
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                      Project notifications
                    </p>
                    <p className='text-xs text-zinc-500 dark:text-zinc-400'>
                      Send notifications to a Slack channel.
                    </p>
                  </div>
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>

                {/* Channel + events (disabled when toggle OFF) */}
                <div
                  className={enabled ? '' : 'opacity-50 pointer-events-none'}
                >
                  {/* Channel selector */}
                  <div className='space-y-1.5 mb-4'>
                    <div className='flex items-center justify-between'>
                      <label className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                        Channel
                      </label>
                      {!showCreate && (
                        <button
                          type='button'
                          onClick={() => {
                            const defaultName = projectName
                              .toLowerCase()
                              .replace(/\s+/g, '-')
                              .replace(/[^a-z0-9-_]/g, '')
                              .slice(0, 80)
                            setShowCreate(true)
                            setCreateError(null)
                            setNewChannelName(defaultName)
                            setTimeout(() => {
                              const input = createInputRef.current
                              if (input) {
                                input.focus()
                                input.select()
                              }
                            }, 50)
                          }}
                          className='flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
                        >
                          <Plus size={12} />
                          Create channel
                        </button>
                      )}
                    </div>

                    {showCreate ? (
                      <div className='space-y-2'>
                        <div className='flex gap-2'>
                          <Input
                            ref={createInputRef}
                            value={newChannelName}
                            onChange={e =>
                              setNewChannelName(
                                e.target.value.toLowerCase().replace(/ /g, '-')
                              )
                            }
                            onKeyDown={e => {
                              if (e.key === 'Enter')
                                handleCreateChannel(loadState.availableChannels)
                              if (e.key === 'Escape') {
                                setShowCreate(false)
                                setNewChannelName('')
                                setCreateError(null)
                              }
                            }}
                            placeholder='channel-name'
                            className='h-8 text-sm'
                          />
                          <Button
                            size='sm'
                            className='h-8 shrink-0'
                            onClick={() =>
                              handleCreateChannel(loadState.availableChannels)
                            }
                            disabled={creating || !newChannelName.trim()}
                          >
                            {creating ? (
                              <Loader2 size={12} className='animate-spin' />
                            ) : (
                              'Create'
                            )}
                          </Button>
                          <Button
                            size='sm'
                            variant='ghost'
                            className='h-8 px-2 shrink-0'
                            onClick={() => {
                              setShowCreate(false)
                              setNewChannelName('')
                              setCreateError(null)
                            }}
                          >
                            <X size={12} />
                          </Button>
                        </div>
                        {createError && (
                          <p className='text-xs text-red-600 dark:text-red-400'>
                            {createError}
                          </p>
                        )}
                      </div>
                    ) : (
                      <select
                        value={selectedChannelId}
                        onChange={e =>
                          handleChannelSelect(
                            e.target.value,
                            loadState.availableChannels
                          )
                        }
                        className='w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400'
                      >
                        <option value=''>Select a channel…</option>
                        {loadState.availableChannels.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.private ? ' (private)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Event checklist */}
                  <div className='space-y-2'>
                    <p className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                      Notify on
                    </p>
                    {ALL_SLACK_EVENTS.map(event => (
                      <label
                        key={event}
                        className='flex items-center gap-2 cursor-pointer'
                      >
                        <input
                          type='checkbox'
                          checked={selectedEvents.includes(event)}
                          onChange={() => toggleEvent(event)}
                          className='rounded border-zinc-300 dark:border-zinc-600 text-zinc-900'
                        />
                        <span className='text-sm text-zinc-700 dark:text-zinc-300'>
                          {SLACK_EVENT_LABELS[event]}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {saveError && (
                  <p className='text-xs text-red-600 dark:text-red-400'>
                    {saveError}
                  </p>
                )}

                <Button
                  className='w-full'
                  onClick={() => handleSave(loadState.savedChannel)}
                  disabled={isSaveDisabled(loadState.savedChannel)}
                >
                  {saving ? (
                    <Loader2 size={14} className='animate-spin mr-2' />
                  ) : null}
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
