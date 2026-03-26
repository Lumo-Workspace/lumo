'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { API, CACHE_KEY } from '../../constants'
import { readCache, writeCache } from '../../cache'
import { LogoUploader } from '@/components/LogoUploader'
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

interface Workspace {
  id: string
  name: string
  slug: string
  logoUrl?: string | null
}

type WorkspaceCache = {
  name?: string
  logoUrl?: string | null
  slug?: string
  role?: string
}

/** Merge new fields into the workspace cache without clobbering unrelated keys
 *  (e.g. name/logoUrl written by Sidebar.tsx). */
function patchWorkspaceCache(patch: Partial<WorkspaceCache>) {
  const prev = readCache<WorkspaceCache>(CACHE_KEY.workspace) ?? {}
  writeCache(CACHE_KEY.workspace, { ...prev, ...patch })
}

export function WorkspaceSettingsPage() {
  const router = useRouter()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  // Start as false only if we have no cached role yet; cache makes it instant
  const [loading, setLoading] = useState(true)

  // Name field
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Slug field
  const [slug, setSlug] = useState('')
  const [savingSlug, setSavingSlug] = useState(false)

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  // ─── Hydrate from cache immediately (stale-while-revalidate) ─────────────
  useEffect(() => {
    const cached = readCache<WorkspaceCache>(CACHE_KEY.workspace)
    if (cached?.name && cached?.slug) {
      const owner = cached.role === 'OWNER'
      setWorkspace({
        id: '',
        name: cached.name,
        slug: cached.slug,
        logoUrl: cached.logoUrl ?? null,
      })
      setName(cached.name)
      setSlug(cached.slug)
      setIsOwner(owner)
      setLoading(false)
      if (!owner && cached.role) {
        // Role is known from cache — redirect immediately
        router.replace(`/workspace/${workspaceUrl}/settings/members`)
      }
    }
  }, [])

  const fetchWorkspace = useCallback(async () => {
    try {
      const res = await fetch(API.workspaces.me)
      if (!res.ok) return
      const data = await res.json()
      const owner = data.role === 'OWNER'

      setWorkspace(data.workspace)
      setIsOwner(owner)
      setName(data.workspace.name)
      setSlug(data.workspace.slug)

      // Persist to cache (merge — don't overwrite logoUrl from Sidebar)
      patchWorkspaceCache({
        name: data.workspace.name,
        slug: data.workspace.slug,
        role: data.role,
      })

      if (!owner) {
        router.replace(`/workspace/${workspaceUrl}/settings/members`)
        return
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWorkspace()
  }, [fetchWorkspace])

  // ─── Permission guard (client-side; server also enforces 403) ────────────
  function assertOwner(): boolean {
    if (!isOwner) {
      toast.error("You don't have permission to modify workspace settings.")
      return false
    }
    return true
  }

  // ─── Save name ────────────────────────────────────────────────────────────
  const handleSaveName = async () => {
    if (!assertOwner()) return
    if (!name.trim() || name === workspace?.name) return
    setSavingName(true)
    try {
      const res = await fetch(API.workspaces.me, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to update name')
      setWorkspace(prev =>
        prev ? { ...prev, name: data.workspace.name } : prev
      )
      patchWorkspaceCache({ name: data.workspace.name })
      toast.success('Workspace name updated')
    } catch (err) {
      setName(workspace?.name ?? '')
      toast.error(err instanceof Error ? err.message : 'Failed to update name')
    } finally {
      setSavingName(false)
    }
  }

  // ─── Save slug ────────────────────────────────────────────────────────────
  const handleSaveSlug = async () => {
    if (!assertOwner()) return
    const trimmed = slug.trim().toLowerCase()
    if (!trimmed || trimmed === workspace?.slug) return
    setSavingSlug(true)
    try {
      const res = await fetch(API.workspaces.me, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to update URL')
      patchWorkspaceCache({ slug: data.workspace.slug })
      toast.success('Workspace URL updated')
      router.push(`/workspace/${data.workspace.slug}/settings/workspace`)
    } catch (err) {
      setSlug(workspace?.slug ?? '')
      toast.error(err instanceof Error ? err.message : 'Failed to update URL')
    } finally {
      setSavingSlug(false)
    }
  }

  // ─── Delete workspace ─────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!assertOwner()) return
    setDeleting(true)
    try {
      const res = await fetch(API.workspaces.me, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to delete workspace')
      window.location.href = '/onboarding'
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete workspace'
      )
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  if (loading) {
    return (
      <div className='h-full flex items-center justify-center'>
        <span className='text-sm text-zinc-400'>Loading…</span>
      </div>
    )
  }

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-8'>
          Workspace
        </h1>

        {/* Settings card */}
        <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden mb-8'>
          {/* Logo row */}
          <div className='flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800'>
            <div>
              <p className='text-sm font-medium text-zinc-800 dark:text-zinc-200'>
                Logo
              </p>
              <p className='text-xs text-zinc-400 mt-0.5'>
                Recommended size is 256×256px
              </p>
            </div>
            <LogoUploader
              currentLogoUrl={workspace?.logoUrl}
              workspaceName={workspace?.name ?? ''}
              uploadUrl={API.workspaces.logo}
              onUpload={url => {
                setWorkspace(w => (w ? { ...w, logoUrl: url } : w))
                patchWorkspaceCache({ logoUrl: url })
              }}
            />
          </div>

          {/* Name row */}
          <div className='flex items-center justify-between gap-4 px-5 py-4 border-b border-zinc-100 dark:border-zinc-800'>
            <label className='text-sm font-medium text-zinc-800 dark:text-zinc-200 shrink-0 w-16'>
              Name
            </label>
            <div className='flex items-center gap-2 flex-1 justify-end'>
              <input
                type='text'
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                disabled={!isOwner || savingName}
                className='h-8 w-64 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed'
              />
              {name !== workspace?.name && (
                <Button
                  size='sm'
                  onClick={handleSaveName}
                  disabled={savingName || !name.trim()}
                >
                  {savingName ? 'Saving…' : 'Save'}
                </Button>
              )}
            </div>
          </div>

          {/* URL row */}
          <div className='flex items-center justify-between gap-4 px-5 py-4'>
            <label className='text-sm font-medium text-zinc-800 dark:text-zinc-200 shrink-0 w-16'>
              URL
            </label>
            <div className='flex items-center gap-2 flex-1 justify-end'>
              <div className='flex items-center h-8 rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden w-64'>
                <span className='px-2.5 text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-700 h-full flex items-center shrink-0'>
                  /workspace/
                </span>
                <input
                  type='text'
                  value={slug}
                  onChange={e =>
                    setSlug(
                      e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                    )
                  }
                  onKeyDown={e => e.key === 'Enter' && handleSaveSlug()}
                  disabled={!isOwner || savingSlug}
                  className='flex-1 px-2.5 text-sm text-zinc-800 dark:text-zinc-200 bg-transparent outline-none disabled:opacity-50 disabled:cursor-not-allowed'
                />
              </div>
              {slug !== workspace?.slug && (
                <Button
                  size='sm'
                  onClick={handleSaveSlug}
                  disabled={savingSlug || !slug.trim()}
                >
                  {savingSlug ? 'Saving…' : 'Save'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Danger zone */}
        {isOwner && (
          <div className='rounded-lg border border-red-200 dark:border-red-900/50 overflow-hidden'>
            <div className='px-5 py-3 bg-red-50 dark:bg-red-950/20 border-b border-red-200 dark:border-red-900/50'>
              <p className='text-sm font-semibold text-red-700 dark:text-red-400'>
                Danger zone
              </p>
            </div>
            <div className='flex items-center justify-between px-5 py-4'>
              <div>
                <p className='text-sm font-medium text-zinc-800 dark:text-zinc-200'>
                  Delete workspace
                </p>
                <p className='text-xs text-zinc-400 mt-0.5'>
                  Permanently delete this workspace and all its data. This
                  cannot be undone.
                </p>
              </div>
              <Button
                variant='destructive'
                size='sm'
                onClick={() => setDeleteOpen(true)}
                className='shrink-0 ml-4'
              >
                Delete workspace
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Delete confirm ─────────────────────────────────────────────────── */}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={open => {
          if (!open) {
            setDeleteOpen(false)
            setDeleteConfirm('')
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{workspace?.name}</strong>{' '}
              and all its projects, tasks, and members. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='px-1 pb-2'>
            <p className='text-xs text-zinc-500 mb-1.5'>
              Type{' '}
              <span className='font-mono font-semibold text-zinc-700 dark:text-zinc-300'>
                {workspace?.name}
              </span>{' '}
              to confirm
            </p>
            <input
              type='text'
              value={deleteConfirm}
              onChange={e => setDeleteConfirm(e.target.value)}
              placeholder={workspace?.name}
              className='w-full h-9 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-red-400 dark:focus:ring-red-700'
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={handleDelete}
              disabled={deleting || deleteConfirm !== workspace?.name}
            >
              {deleting ? 'Deleting…' : 'Delete workspace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
