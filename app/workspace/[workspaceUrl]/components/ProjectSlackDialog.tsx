'use client'

import { useState, useEffect, useCallback, useId, useRef } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { API } from '../constants'
import { apiFetch, ApiClientError } from '@/lib/api-client'
import {
  ALL_SLACK_EVENTS,
  SLACK_EVENT_LABEL_KEYS,
  SlackEventType,
  SLACK_RECONNECT_REQUIRED,
} from '@/lib/integrations/slack/types'

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
  const intl = useIntl()
  const fieldId = useId()
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
  // LUM-1080: the Slack token predates the channel-create scopes.
  const [createNeedsReconnect, setCreateNeedsReconnect] = useState(false)
  const createInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!isOpen) return
    setLoadState({ phase: 'loading' })
    try {
      let channelData: { channel: SavedChannel | null }
      let availableData: { channels: AvailableChannel[] }
      try {
        ;[channelData, availableData] = await Promise.all([
          apiFetch<{ channel: SavedChannel | null }>(
            API.slack.channels(workspaceUrl, projectId)
          ),
          apiFetch<{ channels: AvailableChannel[] }>(
            API.slack.availableChannels(workspaceUrl)
          ),
        ])
      } catch (err) {
        // If available-channels returns 404, Slack is not connected
        if (err instanceof ApiClientError && err.status === 404) {
          setLoadState({
            phase: 'ready',
            savedChannel: null,
            availableChannels: [],
          })
          setEnabled(false)
          return
        }
        throw err
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
      setCreateNeedsReconnect(false)
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
        await apiFetch<void>(API.slack.channelById(savedChannel.id), {
          method: 'DELETE',
        })
      } else if (enabled && !savedChannel) {
        // New config → POST
        try {
          await apiFetch<void>(
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
        } catch (err) {
          if (err instanceof ApiClientError && err.status === 409) {
            // Concurrent POST — re-fetch and switch to PATCH path
            await load()
            toast.info(intl.formatMessage({ id: 'slack.configRefreshed' }))
            return
          }
          throw err
        }
      } else if (enabled && savedChannel) {
        // Update → PATCH
        await apiFetch<void>(API.slack.channelById(savedChannel.id), {
          method: 'PATCH',
          body: {
            channelId: selectedChannelId,
            channelName: selectedChannelName,
            events: selectedEvents,
          },
        })
      }
      toast.success(intl.formatMessage({ id: 'slack.notificationsUpdated' }))
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
    setCreateNeedsReconnect(false)
    try {
      const data = await apiFetch<{
        channel?: AvailableChannel
      }>(API.slack.createChannel(workspaceUrl), {
        method: 'POST',
        body: { name },
      })
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
      toast.success(
        intl.formatMessage(
          { id: 'slack.channelCreated' },
          { name: name.toLowerCase() }
        )
      )
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        err.code === SLACK_RECONNECT_REQUIRED
      ) {
        setCreateNeedsReconnect(true)
        setCreateError(
          intl.formatMessage({ id: 'slack.reconnectToCreateChannel' })
        )
        return
      }
      setCreateError(
        err instanceof ApiClientError
          ? err.message
          : 'Something went wrong. Please try again.'
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage(
              { id: 'slack.notificationsFor' },
              { projectName }
            )}
          </DialogTitle>
          <DialogDescription>
            Send notifications to a Slack channel when events occur in this
            project.
          </DialogDescription>
        </DialogHeader>

        {loadState.phase === 'loading' && (
          <div className='flex items-center justify-center py-8'>
            <Loader2 size={20} className='animate-spin text-muted-foreground' />
          </div>
        )}

        {loadState.phase === 'error' && (
          <div className='space-y-3 py-2'>
            <p className='text-body text-danger-text'>
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
                <p className='text-body text-muted-foreground'>
                  Slack is not connected to this workspace.{' '}
                  <a
                    href={`/workspace/${workspaceUrl}/settings/integrations`}
                    className='text-info-text hover:underline'
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
                    <p className='text-body-strong text-foreground'>
                      Project notifications
                    </p>
                    <p className='text-caption text-muted-foreground'>
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
                      <label
                        htmlFor={`${fieldId}-channel`}
                        className='text-caption text-muted-foreground'
                      >
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
                            setCreateNeedsReconnect(false)
                            setNewChannelName(defaultName)
                            setTimeout(() => {
                              const input = createInputRef.current
                              if (input) {
                                input.focus()
                                input.select()
                              }
                            }, 50)
                          }}
                          className='flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground transition-colors'
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
                            // The Channel label points here while creating,
                            // and at the select otherwise — one target always.
                            id={`${fieldId}-channel`}
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
                                setCreateNeedsReconnect(false)
                              }
                            }}
                            placeholder='channel-name'
                            className='h-8 text-body'
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
                              intl.formatMessage({ id: 'common.create' })
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
                              setCreateNeedsReconnect(false)
                            }}
                          >
                            <X size={12} />
                          </Button>
                        </div>
                        {createError && (
                          <p className='text-caption text-danger-text'>
                            {createError}
                          </p>
                        )}
                        {createNeedsReconnect && (
                          <Button
                            type='button'
                            size='sm'
                            variant='outline'
                            className='h-8'
                            onClick={() =>
                              window.open(
                                API.slack.oauth(workspaceUrl),
                                '_blank'
                              )
                            }
                          >
                            {intl.formatMessage({ id: 'slack.reconnect' })}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Select
                        value={selectedChannelId}
                        onValueChange={v =>
                          handleChannelSelect(v, loadState.availableChannels)
                        }
                      >
                        <SelectTrigger
                          id={`${fieldId}-channel`}
                          className='text-foreground'
                        >
                          <SelectValue
                            placeholder={intl.formatMessage({
                              id: 'slack.selectChannel',
                            })}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {loadState.availableChannels.map(c => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                              {c.private ? ' (private)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* Event checklist */}
                  <div className='space-y-2'>
                    <p className='text-caption text-muted-foreground'>
                      {intl.formatMessage({ id: 'slack.notifyOn' })}
                    </p>
                    {ALL_SLACK_EVENTS.map(event => (
                      <div key={event} className='flex items-center gap-2'>
                        <Checkbox
                          id={`${fieldId}-event-${event}`}
                          checked={selectedEvents.includes(event)}
                          onCheckedChange={() => toggleEvent(event)}
                        />
                        <label
                          htmlFor={`${fieldId}-event-${event}`}
                          className='cursor-pointer text-body text-foreground'
                        >
                          {intl.formatMessage({
                            id: SLACK_EVENT_LABEL_KEYS[event],
                          })}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                {saveError && (
                  <p className='text-caption text-danger-text'>{saveError}</p>
                )}

                <Button
                  className='w-full'
                  onClick={() => handleSave(loadState.savedChannel)}
                  disabled={isSaveDisabled(loadState.savedChannel)}
                >
                  {saving ? (
                    <Loader2 size={14} className='animate-spin mr-2' />
                  ) : null}
                  {saving
                    ? intl.formatMessage({ id: 'common.saving' })
                    : intl.formatMessage({ id: 'common.save' })}
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
