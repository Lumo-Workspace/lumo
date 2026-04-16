'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { sentryApi, type SentryMapping } from '@/lib/api-client/sentry'
import { projectsClient } from '@/lib/api-client'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Project {
  id: string
  name: string
}

export function SentryMappingsDialog({ open, onOpenChange }: Props) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [mappings, setMappings] = useState<SentryMapping[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [newSlug, setNewSlug] = useState('')
  const [newProjectId, setNewProjectId] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([
      sentryApi.listMappings(workspaceUrl),
      projectsClient.list<{ projects: Project[] }>(),
    ])
      .then(([m, projectsResp]) => {
        setMappings(m)
        setProjects(projectsResp.projects)
      })
      .catch(() => toast.error('Failed to load mappings'))
      .finally(() => setLoading(false))
  }, [open, workspaceUrl])

  const addMapping = async () => {
    if (!newSlug || !newProjectId) return
    setSubmitting(true)
    try {
      const created = await sentryApi.createMapping(workspaceUrl, {
        sentryProjectSlug: newSlug,
        projectId: newProjectId,
      })
      setMappings(prev => [...prev, created])
      setNewSlug('')
      setNewProjectId('')
      toast.success('Mapping added')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to add mapping')
    } finally {
      setSubmitting(false)
    }
  }

  const removeMapping = async (id: string) => {
    try {
      await sentryApi.deleteMapping(workspaceUrl, id)
      setMappings(prev => prev.filter(m => m.id !== id))
    } catch {
      toast.error('Failed to remove mapping')
    }
  }

  const projectName = (pid: string) =>
    projects.find(p => p.id === pid)?.name ?? pid

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Sentry project mappings</DialogTitle>
        </DialogHeader>
        <p className='text-xs text-zinc-500 dark:text-zinc-400'>
          Route Sentry alerts for a given Sentry project to a Lumo project. The
          slug is the last segment of{' '}
          <span className='font-mono'>
            /organizations/&lt;org&gt;/projects/&lt;slug&gt;/
          </span>
          .
        </p>

        <div className='mt-3 space-y-2'>
          {loading ? (
            <div className='text-xs text-zinc-500'>Loading…</div>
          ) : mappings.length === 0 ? (
            <div className='text-xs text-zinc-500'>No mappings yet.</div>
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
                  aria-label='Remove mapping'
                >
                  <Trash2 className='h-4 w-4' />
                </button>
              </div>
            ))
          )}
        </div>

        <div className='mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-3'>
          <p className='text-xs font-medium'>Add mapping</p>
          <div className='mt-2 flex items-end gap-2'>
            <label className='flex-1'>
              <span className='text-xs text-zinc-600 dark:text-zinc-300'>
                Sentry slug
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
                Lumo project
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
              onClick={addMapping}
            >
              Add
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
