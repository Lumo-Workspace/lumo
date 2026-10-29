'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { clearCache } from '../../cache'
import { workspacesClient } from '@/lib/api-client'
import { LogoUploader } from '@/components/LogoUploader'
import { DefaultLanguageRow } from '../settings/DefaultLanguageRow'
import { WorkspaceDeletionRow } from '../settings/WorkspaceDeletionRow'
import { DangerZoneCard } from '../settings/DangerZoneCard'
import { SettingsSection } from '../settings/SettingsSection'
import {
  SettingsPageLayout,
  SettingsPageSkeleton,
} from '../settings/SettingsPageLayout'
import {
  useOwnerWorkspace,
  patchWorkspaceCache,
  type OwnerWorkspace,
} from '../../hooks/useOwnerWorkspace'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

/**
 * LUM-1339 — Settings → Workspace → General: logo, name, URL, workspace
 * language and the workspace's deletion. The other groups the old single
 * Workspace page held (LUM-1327) each have their own page now.
 */
export function GeneralSettingsPage() {
  const router = useRouter()
  const intl = useIntl()
  const { workspace, setWorkspace, isOwner, loading, loaded } =
    useOwnerWorkspace()

  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [slug, setSlug] = useState('')
  const [savingSlug, setSavingSlug] = useState(false)

  // The fields follow the row whenever it (re)loads.
  useEffect(() => {
    if (!workspace) return
    setName(workspace.name)
    setSlug(workspace.slug)
  }, [workspace?.name, workspace?.slug])

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
      const data = await workspacesClient.updateMe<{
        workspace: OwnerWorkspace
      }>({
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
      const data = await workspacesClient.updateMe<{
        workspace: OwnerWorkspace
      }>({
        slug: trimmed,
      })
      patchWorkspaceCache({ slug: data.workspace.slug })
      toast.success(intl.formatMessage({ id: 'workspaceSettings.urlUpdated' }))
      router.push(`/workspace/${data.workspace.slug}/settings/general`)
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

  if (loading) return <SettingsPageSkeleton />

  return (
    <SettingsPageLayout
      title={intl.formatMessage({ id: 'settings.general' })}
      subtitle={intl.formatMessage({ id: 'settings.general.subtitle' })}
    >
      <SettingsSection id='general'>
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

          {/* Workspace language (LUM-1097): Slack channel posts + DM fallback,
              and (LUM-1117) AI summaries — the workspace's only language
              setting. */}
          {loaded && workspace && (
            <DefaultLanguageRow
              key={`${workspace.id}:${workspace.defaultLocale ?? 'en'}`}
              value={workspace.defaultLocale ?? 'en'}
              onSaved={defaultLocale =>
                setWorkspace(prev => (prev ? { ...prev, defaultLocale } : prev))
              }
            />
          )}
        </div>
      </SettingsSection>

      {/* Deleting the workspace, 48h undo (LUM-918). Deleting AI-generated
          content lives on the AI page, next to its switch. */}
      {loaded && workspace && (
        <SettingsSection id='danger-zone'>
          <DangerZoneCard>
            <WorkspaceDeletionRow
              workspaceName={workspace.name}
              onDeleted={handleDeleted}
            />
          </DangerZoneCard>
        </SettingsSection>
      )}
    </SettingsPageLayout>
  )
}
