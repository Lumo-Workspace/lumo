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
import { SecurityScanSwitchesCard } from '../settings/SecurityScanSwitchesCard'
import { WorkspaceExportCard } from '../settings/WorkspaceExportCard'
import { WorkspaceDeletionCard } from '../settings/WorkspaceDeletionCard'
import type { PlatformSecurityCeiling } from '@/lib/security-scan/workspace-switches'
import { Button } from '@/components/ui/button'

type SummaryFrequency = 'DAILY' | 'EVERY_TWO_DAYS' | 'WEEKLY'

interface Workspace {
  id: string
  name: string
  slug: string
  logoUrl?: string | null
  summaryEnabled?: boolean
  summaryFrequency?: SummaryFrequency
  summaryLocale?: string
  hookEventRetentionDays?: number | null
  hookEventRetentionMode?: string
  scanEvidenceRetentionDays?: number
  crossingRawRetentionDays?: number
  deadLetterRetentionDays?: number
  securityScanEnabled?: boolean
  securityAiReviewEnabled?: boolean
  securityHuntEnabled?: boolean
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

  // Summary settings
  const [summaryEnabled, setSummaryEnabled] = useState(true)
  const [summaryFrequency, setSummaryFrequency] =
    useState<SummaryFrequency>('DAILY')
  const [summaryLocale, setSummaryLocale] = useState('en')
  const [savingSummary, setSavingSummary] = useState(false)

  // LUM-866: which scan layers the platform env allows at all
  const [securityPlatform, setSecurityPlatform] =
    useState<PlatformSecurityCeiling | null>(null)

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
      const data = await workspacesClient.getMe<{
        workspace: Workspace
        role: string
        securityPlatform?: PlatformSecurityCeiling
      }>()
      const owner = data.role === 'OWNER'

      setWorkspace(data.workspace)
      setSecurityPlatform(data.securityPlatform ?? null)
      setIsOwner(owner)
      setName(data.workspace.name)
      setSlug(data.workspace.slug)
      setSummaryEnabled(data.workspace.summaryEnabled ?? true)
      setSummaryFrequency(data.workspace.summaryFrequency ?? 'DAILY')
      setSummaryLocale(data.workspace.summaryLocale ?? 'en')
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

  // ─── Save summary settings ────────────────────────────────────────────────
  const handleSaveSummarySettings = async () => {
    if (!assertOwner()) return
    setSavingSummary(true)
    try {
      const data = await workspacesClient.updateMe<{ workspace: Workspace }>({
        summaryEnabled,
        summaryFrequency,
        summaryLocale,
      })
      setWorkspace(prev => {
        if (!prev) return prev
        const updated = { ...prev } as Workspace
        if (data.workspace.summaryEnabled !== undefined)
          updated.summaryEnabled = data.workspace.summaryEnabled
        if (data.workspace.summaryFrequency !== undefined)
          updated.summaryFrequency = data.workspace.summaryFrequency
        if (data.workspace.summaryLocale !== undefined)
          updated.summaryLocale = data.workspace.summaryLocale
        return updated
      })
      toast.success(
        intl.formatMessage({ id: 'workspaceSettings.summaryUpdated' })
      )
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'workspaceSettings.summaryUpdateFailed' })
      )
    } finally {
      setSavingSummary(false)
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
        <span className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'common.loading' })}
        </span>
      </div>
    )
  }

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-foreground mb-8'>
          {intl.formatMessage({ id: 'workspaceSettings.title' })}
        </h1>

        {/* Settings card */}
        <div className='rounded-lg border border-border overflow-hidden mb-8'>
          {/* Logo row */}
          <div className='flex items-center justify-between px-5 py-4 border-b border-border'>
            <div>
              <p className='text-sm font-medium text-foreground'>
                {intl.formatMessage({ id: 'workspaceSettings.logo' })}
              </p>
              <p className='text-xs text-muted-foreground mt-0.5'>
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
            <label className='text-sm font-medium text-foreground shrink-0 w-16'>
              {intl.formatMessage({ id: 'workspaceSettings.name' })}
            </label>
            <div className='flex items-center gap-2 flex-1 justify-end'>
              <input
                type='text'
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                disabled={!isOwner || savingName}
                className='h-8 w-64 rounded-md border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed'
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
            <label className='text-sm font-medium text-foreground shrink-0 w-16'>
              {intl.formatMessage({ id: 'workspaceSettings.url' })}
            </label>
            <div className='flex items-center gap-2 flex-1 justify-end'>
              <div className='flex items-center h-8 rounded-md border border-border overflow-hidden w-64'>
                <span className='px-2.5 text-xs text-muted-foreground bg-muted border-r border-border h-full flex items-center shrink-0'>
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
                  className='flex-1 px-2.5 text-sm text-foreground bg-transparent outline-none disabled:opacity-50 disabled:cursor-not-allowed'
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

        {/* Summary settings */}
        {isOwner && (
          <div className='rounded-lg border border-border overflow-hidden mb-8'>
            <div className='px-5 py-3 border-b border-border'>
              <p className='text-sm font-semibold text-foreground'>
                {intl.formatMessage({ id: 'workspaceSettings.summaryTitle' })}
              </p>
            </div>

            {/* Enable toggle */}
            <div className='flex items-center justify-between px-5 py-4 border-b border-border'>
              <div>
                <p className='text-sm font-medium text-foreground'>
                  {intl.formatMessage({
                    id: 'workspaceSettings.summaryEnable',
                  })}
                </p>
                <p className='text-xs text-muted-foreground mt-0.5'>
                  {intl.formatMessage({ id: 'workspaceSettings.summaryDesc' })}
                </p>
              </div>
              <button
                type='button'
                role='switch'
                aria-checked={summaryEnabled}
                onClick={() => setSummaryEnabled(v => !v)}
                disabled={savingSummary}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                  summaryEnabled ? 'bg-primary' : 'bg-input'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-card shadow-elevation-3 transition-transform ${
                    summaryEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Frequency selector */}
            <div className='flex items-center justify-between px-5 py-4 border-b border-border'>
              <label className='text-sm font-medium text-foreground'>
                {intl.formatMessage({
                  id: 'workspaceSettings.summaryFrequency',
                })}
              </label>
              <select
                value={summaryFrequency}
                onChange={e =>
                  setSummaryFrequency(e.target.value as SummaryFrequency)
                }
                disabled={savingSummary || !summaryEnabled}
                className='h-8 rounded-md border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed'
              >
                <option value='DAILY'>
                  {intl.formatMessage({ id: 'workspaceSettings.freqDaily' })}
                </option>
                <option value='EVERY_TWO_DAYS'>
                  {intl.formatMessage({
                    id: 'workspaceSettings.freqEveryTwoDays',
                  })}
                </option>
                <option value='WEEKLY'>
                  {intl.formatMessage({ id: 'workspaceSettings.freqWeekly' })}
                </option>
              </select>
            </div>

            {/* Language selector */}
            <div className='flex items-center justify-between px-5 py-4 border-b border-border'>
              <label className='text-sm font-medium text-foreground'>
                {intl.formatMessage({ id: 'workspaceSettings.reportLanguage' })}
              </label>
              <select
                value={summaryLocale}
                onChange={e => setSummaryLocale(e.target.value)}
                disabled={savingSummary || !summaryEnabled}
                className='h-8 rounded-md border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed'
              >
                <option value='en'>
                  {intl.formatMessage({ id: 'workspaceSettings.langEn' })}
                </option>
                <option value='zh'>
                  {intl.formatMessage({ id: 'workspaceSettings.langZh' })}
                </option>
              </select>
            </div>

            {/* Save button */}
            <div className='flex justify-end px-5 py-4'>
              <Button
                size='sm'
                onClick={handleSaveSummarySettings}
                disabled={savingSummary}
              >
                {savingSummary
                  ? intl.formatMessage({ id: 'common.saving' })
                  : intl.formatMessage({ id: 'common.save' })}
              </Button>
            </div>
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
              scanEvidenceRetentionDays:
                workspace.scanEvidenceRetentionDays ?? null,
              crossingRawRetentionDays:
                workspace.crossingRawRetentionDays ?? null,
              deadLetterRetentionDays:
                workspace.deadLetterRetentionDays ?? null,
            }}
          />
        )}

        {/* PR security-scan switches (LUM-866) — same gating as above. */}
        {isOwner && workspace?.id && securityPlatform && (
          <SecurityScanSwitchesCard
            key={workspace.id}
            initial={{
              securityScanEnabled: workspace.securityScanEnabled ?? true,
              securityAiReviewEnabled:
                workspace.securityAiReviewEnabled ?? true,
              securityHuntEnabled: workspace.securityHuntEnabled ?? true,
            }}
            huntAvailable={securityPlatform.hunt}
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
