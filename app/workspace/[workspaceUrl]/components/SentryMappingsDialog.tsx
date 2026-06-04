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
        <p className='text-xs text-zinc-500 dark:text-zinc-400'>
          <FormattedMessage
            id='sentry.mappingsDesc'
            values={{
              path: chunks => <span className='font-mono'>{chunks}</span>,
            }}
          />
        </p>

        <div className='mt-3 space-y-2'>
          {loading ? (
            <div className='text-xs text-zinc-500'>
              {intl.formatMessage({ id: 'common.loading' })}
            </div>
          ) : mappings.length === 0 ? (
            <div className='text-xs text-zinc-500'>
              {intl.formatMessage({ id: 'sentry.mappingsEmpty' })}
            </div>
          ) : (
            mappings.map(m => (
              <div
                key={m.id}
                className='flex items-center justify-between rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs'
              >
                <div>
                  <span className='font-mono'>{m.sentryProjectSlug}</span>
                  <span className='mx-2 text-zinc-400'>→</span>
                  <span>{projectName(m.projectId)}</span>
                </div>
                <button
                  className='text-red-500 hover:bg-red-500/10 p-1 rounded'
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

        <div className='mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-3'>
          <p className='text-xs font-medium'>
            {intl.formatMessage({ id: 'sentry.addMapping' })}
          </p>
          <div className='mt-2 flex items-end gap-2'>
            <label className='flex-1'>
              <span className='text-xs text-zinc-600 dark:text-zinc-300'>
                {intl.formatMessage({ id: 'sentry.sentrySlugLabel' })}
              </span>
              <input
                className='mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs font-mono'
                value={newSlug}
                onChange={e => setNewSlug(e.target.value)}
                placeholder='frontend'
              />
            </label>
            <label className='flex-1'>
              <span className='text-xs text-zinc-600 dark:text-zinc-300'>
                {intl.formatMessage({ id: 'sentry.lumoProjectLabel' })}
              </span>
              <select
                className='mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs'
                value={newProjectId}
                onChange={e => setNewProjectId(e.target.value)}
              >
                <option value=''>—</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className='text-xs px-3 py-1.5 rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50'
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
