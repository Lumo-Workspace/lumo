'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { RepoReviewFiltersEditor } from './RepoReviewFiltersEditor'
import { RepoReviewStyleEditor } from './RepoReviewStyleEditor'
import {
  useRepoReviewSettings,
  useUpdateRepoReviewSettings,
} from '@/ee/security/hooks/useRepoReviewSettings'
import type {
  RepoReviewSettingView,
  RepoReviewSettingsUpdate,
} from '@/ee/security/services/repo-review-settings.service'

interface RepoRowProps {
  setting: RepoReviewSettingView
  canEdit: boolean
  saving: boolean
  onChange: (update: RepoReviewSettingsUpdate) => void
}

function RepoRow({ setting, canEdit, saving, onChange }: RepoRowProps) {
  const intl = useIntl()
  const t = (id: string) =>
    intl.formatMessage(
      { id: `workspaceSettings.repoReview.${id}` },
      { repo: setting.repo }
    )
  const id = `repo-review-${setting.repo.replace(/[^\w-]/g, '-')}`
  // LUM-1143: the auto-review filters fold out under the row.
  const [showFilters, setShowFilters] = useState(false)
  // LUM-1147: the review style (profile, tone, path instructions) too.
  const [showStyle, setShowStyle] = useState(false)
  return (
    <div className='px-5 py-3 border-b border-border last:border-b-0'>
      <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2'>
        <p className='text-sm font-medium text-foreground break-all'>
          {setting.repo}
        </p>
        <div className='flex items-center gap-4'>
          <Button
            variant='ghost'
            size='sm'
            aria-expanded={showFilters}
            aria-controls={`${id}-filters`}
            aria-label={t('filters.toggleAria')}
            onClick={() => setShowFilters(v => !v)}
          >
            {t('filters.toggle')}
          </Button>
          <Button
            variant='ghost'
            size='sm'
            aria-expanded={showStyle}
            aria-controls={`${id}-style`}
            aria-label={t('style.toggleAria')}
            onClick={() => setShowStyle(v => !v)}
          >
            {t('style.toggle')}
          </Button>
          <label
            htmlFor={`${id}-auto`}
            className='flex items-center gap-2 text-xs text-muted-foreground'
          >
            {t('autoReview')}
            <Switch
              id={`${id}-auto`}
              aria-label={t('autoReviewAria')}
              checked={setting.autoReview}
              disabled={!canEdit || saving}
              onCheckedChange={next =>
                onChange({ repo: setting.repo, autoReview: next })
              }
            />
          </label>
          <label
            htmlFor={`${id}-drafts`}
            className='flex items-center gap-2 text-xs text-muted-foreground'
          >
            {t('drafts')}
            <Switch
              id={`${id}-drafts`}
              aria-label={t('draftsAria')}
              checked={setting.autoReview && setting.reviewDrafts}
              disabled={!canEdit || saving || !setting.autoReview}
              onCheckedChange={next =>
                onChange({ repo: setting.repo, reviewDrafts: next })
              }
            />
          </label>
        </div>
      </div>
      {showFilters && (
        <div id={`${id}-filters`}>
          <RepoReviewFiltersEditor
            setting={setting}
            canEdit={canEdit}
            saving={saving}
            onSave={onChange}
          />
        </div>
      )}
      {showStyle && (
        <div id={`${id}-style`}>
          <RepoReviewStyleEditor
            setting={setting}
            canEdit={canEdit}
            saving={saving}
            onSave={onChange}
          />
        </div>
      )}
    </div>
  )
}

/**
 * LUM-1133 — which connected repositories get an automatic review on every
 * pull request (including ones without a Lumo task), and whether drafts do.
 * Any member sees it; only an OWNER can change it. Each switch saves at once.
 */
export function RepoReviewSettingsCard() {
  const intl = useIntl()
  const { data, isLoading, isError } = useRepoReviewSettings()
  const update = useUpdateRepoReviewSettings()
  const t = (id: string) =>
    intl.formatMessage({ id: `workspaceSettings.repoReview.${id}` })

  const handleChange = async (change: RepoReviewSettingsUpdate) => {
    try {
      await update.mutateAsync(change)
      toast.success(t('updated'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('updateFailed'))
    }
  }

  let body: React.ReactNode
  if (isLoading) {
    body = (
      <p className='px-5 py-4 text-xs text-muted-foreground'>{t('loading')}</p>
    )
  } else if (isError || !data) {
    body = (
      <p className='px-5 py-4 text-xs text-muted-foreground'>
        {t('loadFailed')}
      </p>
    )
  } else if (data.repositories.length === 0) {
    body = (
      <p className='px-5 py-4 text-xs text-muted-foreground'>{t('empty')}</p>
    )
  } else {
    body = data.repositories.map(r => (
      <RepoRow
        key={r.repo}
        setting={r}
        canEdit={data.canEdit}
        saving={update.isPending}
        onChange={handleChange}
      />
    ))
  }

  return (
    <div className='rounded-lg border border-border overflow-hidden mb-8'>
      <div className='px-5 py-3 border-b border-border'>
        <p className='text-sm font-semibold text-foreground'>{t('title')}</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          {t('description')}
        </p>
        {data && !data.canEdit && (
          <p className='text-xs text-muted-foreground mt-1'>{t('ownerOnly')}</p>
        )}
      </div>
      {body}
    </div>
  )
}
