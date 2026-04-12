'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { API, CACHE_KEY } from '../../constants'
import { readCache, writeCache, clearCache } from '../../cache'
import { apiFetch, workspacesClient } from '@/lib/api-client'
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

type SummaryFrequency = 'DAILY' | 'EVERY_TWO_DAYS' | 'WEEKLY'

interface Workspace {
  id: string
  name: string
  slug: string
  logoUrl?: string | null
  summaryEnabled?: boolean
  summaryFrequency?: SummaryFrequency
  summaryLocale?: string
  riskOverdueRatio?: number
  riskStalledDays?: number
  riskStalledMinCount?: number
  riskAgentFailRatio?: number
  riskStalePrDays?: number
  riskThroughputDrop?: number
}

const DEFAULT_RISK = {
  riskOverdueRatio: 0.25,
  riskStalledDays: 7,
  riskStalledMinCount: 3,
  riskAgentFailRatio: 0.3,
  riskStalePrDays: 3,
  riskThroughputDrop: 0.5,
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

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Summary settings
  const [summaryEnabled, setSummaryEnabled] = useState(true)
  const [summaryFrequency, setSummaryFrequency] =
    useState<SummaryFrequency>('DAILY')
  const [summaryLocale, setSummaryLocale] = useState('en')
  const [savingSummary, setSavingSummary] = useState(false)

  // Risk thresholds
  const [riskForm, setRiskForm] = useState(DEFAULT_RISK)
  const [savingRisk, setSavingRisk] = useState(false)

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
      }>()
      const owner = data.role === 'OWNER'

      setWorkspace(data.workspace)
      setIsOwner(owner)
      setName(data.workspace.name)
      setSlug(data.workspace.slug)
      setSummaryEnabled(data.workspace.summaryEnabled ?? true)
      setSummaryFrequency(data.workspace.summaryFrequency ?? 'DAILY')
      setSummaryLocale(data.workspace.summaryLocale ?? 'en')
      setRiskForm({
        riskOverdueRatio:
          data.workspace.riskOverdueRatio ?? DEFAULT_RISK.riskOverdueRatio,
        riskStalledDays:
          data.workspace.riskStalledDays ?? DEFAULT_RISK.riskStalledDays,
        riskStalledMinCount:
          data.workspace.riskStalledMinCount ??
          DEFAULT_RISK.riskStalledMinCount,
        riskAgentFailRatio:
          data.workspace.riskAgentFailRatio ?? DEFAULT_RISK.riskAgentFailRatio,
        riskStalePrDays:
          data.workspace.riskStalePrDays ?? DEFAULT_RISK.riskStalePrDays,
        riskThroughputDrop:
          data.workspace.riskThroughputDrop ?? DEFAULT_RISK.riskThroughputDrop,
      })

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

  // ─── Save risk thresholds ────────────────────────────────────────────────
  const handleSaveRiskThresholds = async () => {
    if (!assertOwner()) return
    setSavingRisk(true)
    try {
      await workspacesClient.updateMe<{ workspace: Workspace }>({
        ...riskForm,
      })
      toast.success(intl.formatMessage({ id: 'workspaceSettings.riskUpdated' }))
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'workspaceSettings.riskUpdateFailed' })
      )
    } finally {
      setSavingRisk(false)
    }
  }

  const handleRestoreRiskDefaults = () => setRiskForm(DEFAULT_RISK)

  // ─── Delete workspace ─────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!assertOwner()) return
    setDeleting(true)
    try {
      await apiFetch(API.workspaces.me, { method: 'DELETE' })
      clearCache()
      window.location.href = '/onboarding'
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'workspaceSettings.deleteFailed' })
      )
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  if (loading) {
    return (
      <div className='h-full flex items-center justify-center'>
        <span className='text-sm text-zinc-400'>
          {intl.formatMessage({ id: 'common.loading' })}
        </span>
      </div>
    )
  }

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-8'>
          {intl.formatMessage({ id: 'workspaceSettings.title' })}
        </h1>

        {/* Settings card */}
        <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden mb-8'>
          {/* Logo row */}
          <div className='flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800'>
            <div>
              <p className='text-sm font-medium text-zinc-800 dark:text-zinc-200'>
                {intl.formatMessage({ id: 'workspaceSettings.logo' })}
              </p>
              <p className='text-xs text-zinc-400 mt-0.5'>
                {intl.formatMessage({ id: 'workspaceSettings.logoHint' })}
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
              {intl.formatMessage({ id: 'workspaceSettings.name' })}
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
                  {savingName
                    ? intl.formatMessage({ id: 'common.saving' })
                    : intl.formatMessage({ id: 'common.save' })}
                </Button>
              )}
            </div>
          </div>

          {/* URL row */}
          <div className='flex items-center justify-between gap-4 px-5 py-4'>
            <label className='text-sm font-medium text-zinc-800 dark:text-zinc-200 shrink-0 w-16'>
              {intl.formatMessage({ id: 'workspaceSettings.url' })}
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
          <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden mb-8'>
            <div className='px-5 py-3 border-b border-zinc-100 dark:border-zinc-800'>
              <p className='text-sm font-semibold text-zinc-800 dark:text-zinc-200'>
                {intl.formatMessage({ id: 'workspaceSettings.summaryTitle' })}
              </p>
            </div>

            {/* Enable toggle */}
            <div className='flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800'>
              <div>
                <p className='text-sm font-medium text-zinc-800 dark:text-zinc-200'>
                  {intl.formatMessage({
                    id: 'workspaceSettings.summaryEnable',
                  })}
                </p>
                <p className='text-xs text-zinc-400 mt-0.5'>
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
                  summaryEnabled
                    ? 'bg-zinc-900 dark:bg-zinc-100'
                    : 'bg-zinc-200 dark:bg-zinc-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white dark:bg-zinc-900 shadow-lg transition-transform ${
                    summaryEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Frequency selector */}
            <div className='flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800'>
              <label className='text-sm font-medium text-zinc-800 dark:text-zinc-200'>
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
                className='h-8 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed'
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
            <div className='flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800'>
              <label className='text-sm font-medium text-zinc-800 dark:text-zinc-200'>
                {intl.formatMessage({ id: 'workspaceSettings.reportLanguage' })}
              </label>
              <select
                value={summaryLocale}
                onChange={e => setSummaryLocale(e.target.value)}
                disabled={savingSummary || !summaryEnabled}
                className='h-8 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed'
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

        {/* Risk thresholds */}
        {isOwner && (
          <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden mb-8'>
            <div className='px-5 py-3 border-b border-zinc-100 dark:border-zinc-800'>
              <p className='text-sm font-semibold text-zinc-800 dark:text-zinc-200'>
                {intl.formatMessage({ id: 'summary.riskThresholds' })}
              </p>
              <p className='text-xs text-zinc-400 mt-0.5'>
                {intl.formatMessage({
                  id: 'summary.riskThresholds.description',
                })}
              </p>
            </div>

            {(
              [
                [
                  'riskOverdueRatio',
                  'summary.riskThresholds.overdueRatio',
                  'number',
                  0,
                  1,
                  0.01,
                ],
                [
                  'riskStalledDays',
                  'summary.riskThresholds.stalledDays',
                  'int',
                  1,
                  30,
                  1,
                ],
                [
                  'riskStalledMinCount',
                  'summary.riskThresholds.stalledMinCount',
                  'int',
                  1,
                  50,
                  1,
                ],
                [
                  'riskAgentFailRatio',
                  'summary.riskThresholds.agentFailRatio',
                  'number',
                  0,
                  1,
                  0.01,
                ],
                [
                  'riskStalePrDays',
                  'summary.riskThresholds.stalePrDays',
                  'int',
                  1,
                  30,
                  1,
                ],
                [
                  'riskThroughputDrop',
                  'summary.riskThresholds.throughputDrop',
                  'number',
                  0,
                  1,
                  0.01,
                ],
              ] as const
            ).map(([key, labelId, kind, min, max, step]) => (
              <div
                key={key}
                className='flex items-center justify-between gap-4 px-5 py-3 border-b border-zinc-100 dark:border-zinc-800'
              >
                <label className='text-sm font-medium text-zinc-800 dark:text-zinc-200'>
                  {intl.formatMessage({ id: labelId })}
                </label>
                <input
                  type='number'
                  min={min}
                  max={max}
                  step={step}
                  value={riskForm[key]}
                  onChange={e => {
                    const raw = e.target.value
                    const parsed =
                      kind === 'int' ? parseInt(raw, 10) : parseFloat(raw)
                    setRiskForm(f => ({
                      ...f,
                      [key]: isNaN(parsed) ? f[key] : parsed,
                    }))
                  }}
                  disabled={savingRisk}
                  className='w-24 h-8 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 text-sm text-right text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 disabled:opacity-50'
                />
              </div>
            ))}

            <div className='flex justify-between px-5 py-4'>
              <Button
                size='sm'
                variant='ghost'
                onClick={handleRestoreRiskDefaults}
                disabled={savingRisk}
              >
                {intl.formatMessage({
                  id: 'summary.riskThresholds.restoreDefaults',
                })}
              </Button>
              <Button
                size='sm'
                onClick={handleSaveRiskThresholds}
                disabled={savingRisk}
              >
                {savingRisk
                  ? intl.formatMessage({ id: 'common.saving' })
                  : intl.formatMessage({ id: 'common.save' })}
              </Button>
            </div>
          </div>
        )}

        {/* Danger zone */}
        {isOwner && (
          <div className='rounded-lg border border-red-200 dark:border-red-900/50 overflow-hidden'>
            <div className='px-5 py-3 bg-red-50 dark:bg-red-950/20 border-b border-red-200 dark:border-red-900/50'>
              <p className='text-sm font-semibold text-red-700 dark:text-red-400'>
                {intl.formatMessage({ id: 'workspaceSettings.dangerZone' })}
              </p>
            </div>
            <div className='flex items-center justify-between px-5 py-4'>
              <div>
                <p className='text-sm font-medium text-zinc-800 dark:text-zinc-200'>
                  {intl.formatMessage({ id: 'workspaceSettings.deleteTitle' })}
                </p>
                <p className='text-xs text-zinc-400 mt-0.5'>
                  {intl.formatMessage({ id: 'workspaceSettings.deleteDesc' })}
                </p>
              </div>
              <Button
                variant='destructive'
                size='sm'
                onClick={() => setDeleteOpen(true)}
                className='shrink-0 ml-4'
              >
                {intl.formatMessage({
                  id: 'workspaceSettings.deleteWorkspace',
                })}
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
            <AlertDialogTitle>
              {intl.formatMessage({
                id: 'workspaceSettings.deleteConfirmTitle',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                { id: 'workspaceSettings.deleteConfirmDesc' },
                { name: workspace?.name ?? '' }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='px-1 pb-2'>
            <p className='text-xs text-zinc-500 mb-1.5'>
              {intl.formatMessage(
                { id: 'workspaceSettings.deleteTypePrompt' },
                { name: workspace?.name ?? '' }
              )}
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
            <AlertDialogCancel disabled={deleting}>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={handleDelete}
              disabled={deleting || deleteConfirm !== workspace?.name}
            >
              {deleting
                ? intl.formatMessage({ id: 'common.deleting' })
                : intl.formatMessage({
                    id: 'workspaceSettings.deleteWorkspace',
                  })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
