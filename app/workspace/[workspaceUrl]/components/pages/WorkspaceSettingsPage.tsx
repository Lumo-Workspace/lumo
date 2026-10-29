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
import { DoneRequirementsCard } from '../settings/DoneRequirementsCard'
import { WorkspaceExportCard } from '../settings/WorkspaceExportCard'
import { WorkspaceDeletionRow } from '../settings/WorkspaceDeletionRow'
import { AiDerivedContentDeleteRow } from '../settings/AiDerivedContentDeleteRow'
import { DangerZoneCard } from '../settings/DangerZoneCard'
import { AiFeaturesSection } from '../settings/AiFeaturesSection'
import {
  SettingsSection,
  SettingsSectionNav,
} from '../settings/SettingsSection'
import { LoadingState } from '../AsyncContent'
import { RowListSkeleton } from '../skeletons/RowListSkeleton'
import { SkeletonLine } from '../skeletons/SkeletonLine'
import { PluginSlot, hasPluginSlot } from '@/lib/plugins/client'
import { Label } from '@/components/ui/label'
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
  doneRequiresTestCase?: boolean
  doneRequiresReview?: boolean
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
      <LoadingState className='h-full overflow-y-auto'>
        <div aria-hidden className='max-w-2xl mx-auto px-6 py-8'>
          <SkeletonLine
            boxHeight='32px'
            barHeight='h-6'
            width='40%'
            className='mb-8'
          />
          <RowListSkeleton
            rows={4}
            subtitle
            divided
            rowClassName='px-5 py-4'
            className='rounded-lg border border-border'
          />
        </div>
      </LoadingState>
    )
  }

  // LUM-1327: the page is grouped into titled sections with jump links.
  // Everything past General needs the real (not cache-hydrated) row.
  const loaded = isOwner && Boolean(workspace?.id)
  const showCodeReview = loaded && hasPluginSlot('settings.workspace.section')
  const sections = [
    {
      id: 'general',
      label: intl.formatMessage({ id: 'workspaceSettings.section.general' }),
    },
    ...(loaded
      ? [
          {
            id: 'done-requirements',
            label: intl.formatMessage({
              id: 'workspaceSettings.section.doneRequirements',
            }),
          },
          {
            id: 'ai-features',
            label: intl.formatMessage({
              id: 'workspaceSettings.section.aiFeatures',
            }),
          },
        ]
      : []),
    ...(showCodeReview
      ? [
          {
            id: 'code-review',
            label: intl.formatMessage({
              id: 'workspaceSettings.section.codeReview',
            }),
          },
        ]
      : []),
    ...(loaded
      ? [
          {
            id: 'data-privacy',
            label: intl.formatMessage({
              id: 'workspaceSettings.section.dataPrivacy',
            }),
          },
          {
            id: 'danger-zone',
            label: intl.formatMessage({ id: 'workspaceSettings.dangerZone' }),
          },
        ]
      : []),
  ]

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 pb-8'>
        <h1 className='text-heading text-foreground pt-8 mb-4'>
          {intl.formatMessage({ id: 'workspaceSettings.title' })}
        </h1>

        {sections.length > 1 && (
          <SettingsSectionNav
            label={intl.formatMessage({
              id: 'workspaceSettings.section.navLabel',
            })}
            items={sections}
          />
        )}

        <SettingsSection
          id='general'
          title={intl.formatMessage({
            id: 'workspaceSettings.section.general',
          })}
        >
          <div className='rounded-lg border border-border overflow-hidden'>
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
              <Label
                htmlFor='workspace-settings-name'
                className='text-body-strong text-foreground shrink-0'
              >
                {intl.formatMessage({ id: 'workspaceSettings.name' })}
              </Label>
              <div className='flex items-center gap-2 flex-1 justify-end'>
                <input
                  type='text'
                  id='workspace-settings-name'
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
            <div
              className={`flex items-center justify-between gap-4 px-5 py-4 ${loaded ? 'border-b border-border' : ''}`}
            >
              <Label
                htmlFor='workspace-settings-url'
                className='text-body-strong text-foreground shrink-0'
              >
                {intl.formatMessage({ id: 'workspaceSettings.url' })}
              </Label>
              <div className='flex items-center gap-2 flex-1 justify-end'>
                <div className='flex items-center h-8 rounded-md border border-border overflow-hidden w-64'>
                  <span className='px-2.5 text-caption text-muted-foreground bg-muted border-r border-border h-full flex items-center shrink-0'>
                    /workspace/
                  </span>
                  <input
                    type='text'
                    id='workspace-settings-url'
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

            {/* Default language (LUM-1097): Slack channel posts + DM fallback,
                and (LUM-1117) AI summaries — the workspace's only language
                setting. */}
            {loaded && workspace && (
              <DefaultLanguageRow
                key={`${workspace.id}:${workspace.defaultLocale ?? 'en'}`}
                value={workspace.defaultLocale ?? 'en'}
                onSaved={defaultLocale =>
                  setWorkspace(prev =>
                    prev ? { ...prev, defaultLocale } : prev
                  )
                }
              />
            )}
          </div>
        </SettingsSection>

        {/* LUM-1334: what a task needs before it can move to Done. */}
        {loaded && workspace && (
          <SettingsSection
            id='done-requirements'
            title={intl.formatMessage({
              id: 'workspaceSettings.section.doneRequirements',
            })}
          >
            <DoneRequirementsCard
              key={`done-requirements:${workspace.id}`}
              testCase={workspace.doneRequiresTestCase ?? null}
              review={workspace.doneRequiresReview ?? null}
            />
          </SettingsSection>
        )}

        {/* AI feature switches (LUM-1338): master, groups, features. */}
        {loaded && workspace && (
          <SettingsSection
            id='ai-features'
            title={intl.formatMessage({
              id: 'workspaceSettings.section.aiFeatures',
            })}
          >
            <AiFeaturesSection />
          </SettingsSection>
        )}

        {/* Plugin settings (LUM-1062; the security plugin's PR scan
            switches, LUM-866). */}
        {showCodeReview && workspace && (
          <SettingsSection
            id='code-review'
            title={intl.formatMessage({
              id: 'workspaceSettings.section.codeReview',
            })}
          >
            <PluginSlot
              key={workspace.id}
              name='settings.workspace.section'
              props={{ workspace, me }}
            />
          </SettingsSection>
        )}

        {loaded && workspace && (
          <SettingsSection
            id='data-privacy'
            title={intl.formatMessage({
              id: 'workspaceSettings.section.dataPrivacy',
            })}
          >
            {/* Data retention (LUM-933): one row per kind of data. */}
            <DataRetentionSection
              key={`retention:${workspace.id}`}
              settings={{
                hookEventRetentionMode:
                  workspace.hookEventRetentionMode ?? null,
                hookEventRetentionDays:
                  workspace.hookEventRetentionDays ?? null,
                crossingRawRetentionDays:
                  workspace.crossingRawRetentionDays ?? null,
                deadLetterRetentionDays:
                  workspace.deadLetterRetentionDays ?? null,
                aiDerivedContentEnabled:
                  workspace.aiDerivedContentEnabled ?? null,
              }}
              workspace={workspace}
            />
            {/* GDPR data export (LUM-858). */}
            <WorkspaceExportCard key={`export:${workspace.id}`} />
          </SettingsSection>
        )}

        {/* Danger zone — every irreversible action: deleting AI-derived
            content (LUM-917) and the workspace, 48h undo (LUM-918). The
            card carries its own header. */}
        {loaded && workspace && (
          <SettingsSection id='danger-zone'>
            <DangerZoneCard>
              <AiDerivedContentDeleteRow workspaceName={workspace.name} />
              <WorkspaceDeletionRow
                workspaceName={workspace.name}
                onDeleted={handleDeleted}
              />
            </DangerZoneCard>
          </SettingsSection>
        )}
      </div>
    </div>
  )
}
