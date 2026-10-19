'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { CACHE_KEY } from '../../constants'
import { readCache, writeCache, clearCache } from '../../cache'
import { workspacesClient } from '@/lib/api-client'
import { LogoUploader } from '@/components/LogoUploader'
import { DataRetentionSection } from '../settings/DataRetentionSection'
import { DefaultLanguageRow } from '../settings/DefaultLanguageRow'
import { WorkspaceExportCard } from '../settings/WorkspaceExportCard'
import { WorkspaceDeletionCard } from '../settings/WorkspaceDeletionCard'
import { PluginSlot } from '@/lib/plugins/client'
import { Button } from '@/components/ui/button'

/** The core columns this page reads; plugin-owned ones pass through (LUM-1062). */
type Workspace = {
  id: string
  name: string
  slug: string
  logoUrl?: string | null
  defaultLocale?: string
  hookEventRetentionDays?: number | null
  hookEventRetentionMode?: string
  crossingRawRetentionDays?: number
  deadLetterRetentionDays?: number
  aiDerivedContentEnabled?: boolean
} & { [column: string]: unknown }

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
  const intl = useIntl()

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

  // LUM-1062: the whole GET /api/workspaces/me response, for plugin
  // settings sections (the security plugin reads its platform ceiling here).
  const [me, setMe] = useState<Record<string, unknown>>({})

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
      const data = await workspacesClient.getMe<
        {
          workspace: Workspace
          role: string
        } & Record<string, unknown>
      >()
      const owner = data.role === 'OWNER'

      setWorkspace(data.workspace)
      setMe(data)
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
      toast.error(intl.formatMessage({ id: 'workspaceSettings.noPermission' }))
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
      const data = await workspacesClient.updateMe<{ workspace: Workspace }>({
        name: name.trim(),
      })
      setWorkspace(prev =>
        prev ? { ...prev, name: data.workspace.name } : prev
      )
      patchWorkspaceCache({ name: data.workspace.name })
      toast.success(intl.formatMessage({ id: 'workspaceSettings.nameUpdated' }))
    } catch (err) {
      setName(workspace?.name ?? '')
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'workspaceSettings.nameUpdateFailed' })
      )
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
      const data = await workspacesClient.updateMe<{ workspace: Workspace }>({
        slug: trimmed,
      })
      patchWorkspaceCache({ slug: data.workspace.slug })
      toast.success(intl.formatMessage({ id: 'workspaceSettings.urlUpdated' }))
      router.push(`/workspace/${data.workspace.slug}/settings/workspace`)
    } catch (err) {
      setSlug(workspace?.slug ?? '')
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'workspaceSettings.urlUpdateFailed' })
      )
    } finally {
      setSavingSlug(false)
    }
  }

  // ─── Workspace gone (delete-now path, LUM-918) ───────────────────────────
  const handleDeleted = () => {
    clearCache()
    window.location.href = '/onboarding'
  }

  if (loading) {
    return (
      <div className='h-full flex items-center justify-center'>
        <span className='text-body text-muted-foreground'>
          {intl.formatMessage({ id: 'common.loading' })}
        </span>
      </div>
    )
  }

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-heading text-foreground mb-8'>
          {intl.formatMessage({ id: 'workspaceSettings.title' })}
        </h1>

        {/* Settings card */}
        <div className='rounded-lg border border-border overflow-hidden mb-8'>
          {/* Logo row */}
          <div className='flex items-center justify-between px-5 py-4 border-b border-border'>
            <div>
              <p className='text-body-strong text-foreground'>
                {intl.formatMessage({ id: 'workspaceSettings.logo' })}
              </p>
              <p className='text-caption text-muted-foreground mt-0.5'>
                {intl.formatMessage({ id: 'workspaceSettings.logoHint' })}
              </p>
            </div>
            <LogoUploader
              currentLogoUrl={workspace?.logoUrl}
              workspaceName={workspace?.name ?? ''}
              upload={workspacesClient.uploadLogo}
              onUpload={url => {
                setWorkspace(w => (w ? { ...w, logoUrl: url } : w))
                patchWorkspaceCache({ logoUrl: url })
              }}
            />
          </div>

          {/* Name row */}
          <div className='flex items-center justify-between gap-4 px-5 py-4 border-b border-border'>
            <label className='text-body-strong text-foreground shrink-0 w-16'>
              {intl.formatMessage({ id: 'workspaceSettings.name' })}
            </label>
            <div className='flex items-center gap-2 flex-1 justify-end'>
              <input
                type='text'
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                disabled={!isOwner || savingName}
                className='h-8 w-64 rounded-md border border-border bg-transparent px-3 text-body text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed'
              />
              {name !== workspace?.name && (
                <Button
                  size='sm'
                  onClick={handleSaveName}
                  disabled={savingName || !name.trim()}
                >
                  {savingName
                    ? intl.formatMessage({ id: 'common.saving' })
                    : intl.formatMessage({ id: 'common.save' })}
                </Button>
              )}
            </div>
          </div>

          {/* URL row */}
          <div className='flex items-center justify-between gap-4 px-5 py-4'>
            <label className='text-body-strong text-foreground shrink-0 w-16'>
              {intl.formatMessage({ id: 'workspaceSettings.url' })}
            </label>
            <div className='flex items-center gap-2 flex-1 justify-end'>
              <div className='flex items-center h-8 rounded-md border border-border overflow-hidden w-64'>
                <span className='px-2.5 text-caption text-muted-foreground bg-muted border-r border-border h-full flex items-center shrink-0'>
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
                  className='flex-1 px-2.5 text-body text-foreground bg-transparent outline-none disabled:opacity-50 disabled:cursor-not-allowed'
                />
              </div>
              {slug !== workspace?.slug && (
                <Button
                  size='sm'
                  onClick={handleSaveSlug}
                  disabled={savingSlug || !slug.trim()}
                >
                  {savingSlug
                    ? intl.formatMessage({ id: 'common.saving' })
                    : intl.formatMessage({ id: 'common.save' })}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Default language (LUM-1097): Slack channel posts + DM fallback,
            and (LUM-1117) AI summaries — the workspace's only language
            setting. Rendered once the real workspace row is loaded. */}
        {isOwner && workspace?.id && (
          <div className='rounded-lg border border-border overflow-hidden mb-8'>
            <DefaultLanguageRow
              key={`${workspace.id}:${workspace.defaultLocale ?? 'en'}`}
              value={workspace.defaultLocale ?? 'en'}
              onSaved={defaultLocale =>
                setWorkspace(prev => (prev ? { ...prev, defaultLocale } : prev))
              }
            />
          </div>
        )}

        {/* Data retention (LUM-933): one row per kind of data — rendered
            once the real workspace row is loaded, not the cache-hydrated stub. */}
        {isOwner && workspace?.id && (
          <DataRetentionSection
            key={workspace.id}
            settings={{
              hookEventRetentionMode: workspace.hookEventRetentionMode ?? null,
              hookEventRetentionDays: workspace.hookEventRetentionDays ?? null,
              crossingRawRetentionDays:
                workspace.crossingRawRetentionDays ?? null,
              deadLetterRetentionDays:
                workspace.deadLetterRetentionDays ?? null,
              aiDerivedContentEnabled:
                workspace.aiDerivedContentEnabled ?? null,
            }}
            workspace={workspace}
            workspaceName={workspace.name}
          />
        )}

        {/* Plugin settings (LUM-1062; the security plugin's PR scan
            switches, LUM-866) — same gating as above. */}
        {isOwner && workspace?.id && (
          <PluginSlot
            key={workspace.id}
            name='settings.workspace.section'
            props={{ workspace, me }}
          />
        )}

        {/* GDPR data export (LUM-858). */}
        {isOwner && workspace?.id && <WorkspaceExportCard key={workspace.id} />}

        {/* Danger zone — 48h undo window (LUM-918) */}
        {isOwner && workspace && (
          <WorkspaceDeletionCard
            workspaceName={workspace.name}
            onDeleted={handleDeleted}
          />
        )}
      </div>
    </div>
  )
}
