'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { FormattedMessage, useIntl } from 'react-intl'
import { Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSentryMappings } from '../hooks/useSentryMappings'
import { useProjects } from '../hooks/useProjects'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SentryMappingsDialog({ open, onOpenChange }: Props) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  // Mappings load (and stay cached) only while the dialog is open; projects
  // come from the workspace-level ProjectsProvider cache, so no extra fetch.
  const { mappings, loading, submitting, addMapping, removeMapping } =
    useSentryMappings(workspaceUrl, open)
  const { projects } = useProjects()
  const [newSlug, setNewSlug] = useState('')
  const [newProjectId, setNewProjectId] = useState('')

  const handleAdd = async () => {
    if (!newSlug || !newProjectId) return
    try {
      await addMapping({ sentryProjectSlug: newSlug, projectId: newProjectId })
      setNewSlug('')
      setNewProjectId('')
    } catch {
      // Failure toast is surfaced by the mutation in useSentryMappings.
    }
  }

  const projectName = (pid: string) =>
    projects.find(p => p.id === pid)?.name ?? pid

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'sentry.mappingsTitle' })}
          </DialogTitle>
        </DialogHeader>
        <p className='text-caption text-muted-foreground'>
          <FormattedMessage
            id='sentry.mappingsDesc'
            values={{
              path: chunks => <span className='font-mono'>{chunks}</span>,
            }}
          />
        </p>

        <div className='mt-3 space-y-2'>
          {loading ? (
            <div className='text-caption text-muted-foreground'>
              {intl.formatMessage({ id: 'common.loading' })}
            </div>
          ) : mappings.length === 0 ? (
            <div className='text-caption text-muted-foreground'>
              {intl.formatMessage({ id: 'sentry.mappingsEmpty' })}
            </div>
          ) : (
            mappings.map(m => (
              <div
                key={m.id}
                className='flex items-center justify-between rounded-md border border-border px-3 py-2 text-caption'
              >
                <div>
                  <span className='font-mono'>{m.sentryProjectSlug}</span>
                  <span className='mx-2 text-muted-foreground'>→</span>
                  <span>{projectName(m.projectId)}</span>
                </div>
                <button
                  className='text-danger-text hover:bg-danger-subtle p-1 rounded-sm'
                  onClick={() => removeMapping(m.id)}
                  aria-label={intl.formatMessage({
                    id: 'sentry.mappingsRemoveAriaLabel',
                  })}
                >
                  <Trash2 className='h-4 w-4' />
                </button>
              </div>
            ))
          )}
        </div>

        <div className='mt-4 border-t border-border pt-3'>
          <p className='text-caption'>
            {intl.formatMessage({ id: 'sentry.addMapping' })}
          </p>
          <div className='mt-2 flex items-end gap-2'>
            <label className='flex-1'>
              <span className='text-caption text-foreground'>
                {intl.formatMessage({ id: 'sentry.sentrySlugLabel' })}
              </span>
              <input
                className='mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-caption font-mono'
                value={newSlug}
                onChange={e => setNewSlug(e.target.value)}
                placeholder='frontend'
              />
            </label>
            <div className='flex-1'>
              <span className='text-caption text-foreground'>
                {intl.formatMessage({ id: 'sentry.lumoProjectLabel' })}
              </span>
              <Select value={newProjectId} onValueChange={setNewProjectId}>
                <SelectTrigger
                  aria-label={intl.formatMessage({
                    id: 'sentry.lumoProjectLabel',
                  })}
                  className='mt-1'
                >
                  <SelectValue placeholder='—' />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <button
              className='text-caption px-3 py-1.5 rounded-md bg-foreground text-background disabled:opacity-50'
              disabled={submitting || !newSlug || !newProjectId}
              onClick={handleAdd}
            >
              {intl.formatMessage({ id: 'common.add' })}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
