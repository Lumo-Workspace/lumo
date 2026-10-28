'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RepoReviewSettingsSheet } from './RepoReviewSettingsSheet'
import { repoReviewSummary } from './repo-review-draft'
import {
  useRepoReviewSettings,
  useUpdateRepoReviewSettings,
} from '@/ee/security/hooks/useRepoReviewSettings'
import type {
  RepoReviewSettingView,
  RepoReviewSettingsUpdate,
} from '@/ee/security/services/repo-review-settings.service'

/** Above this many repositories the list gets a filter box. */
const FILTER_FROM = 6

interface RepoRowProps {
  setting: RepoReviewSettingView
  canEdit: boolean
  saving: boolean
  onChange: (update: RepoReviewSettingsUpdate) => void
  onConfigure: () => void
}

function RepoRow({
  setting,
  canEdit,
  saving,
  onChange,
  onConfigure,
}: RepoRowProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, number | string>) =>
    intl.formatMessage(
      { id: `workspaceSettings.repoReview.${id}` },
      { repo: setting.repo, ...values }
    )
  const summary = setting.autoReview
    ? repoReviewSummary(setting)
        .map(p => t(`summary.${p.id}`, p.values))
        .join(' · ')
    : t('summary.off')
  return (
    <TableRow className='h-14'>
      <TableCell className='max-w-[16rem]'>
        <span
          className={
            setting.autoReview
              ? 'break-all font-mono text-body-strong text-foreground'
              : 'break-all font-mono text-body-strong text-muted-foreground'
          }
        >
          {setting.repo}
        </span>
      </TableCell>
      <TableCell>
        <Switch
          aria-label={t('autoReviewAria')}
          checked={setting.autoReview}
          disabled={!canEdit || saving}
          onCheckedChange={next =>
            onChange({ repo: setting.repo, autoReview: next })
          }
        />
      </TableCell>
      <TableCell>
        <Switch
          aria-label={t('draftsAria')}
          checked={setting.autoReview && setting.reviewDrafts}
          disabled={!canEdit || saving || !setting.autoReview}
          onCheckedChange={next =>
            onChange({ repo: setting.repo, reviewDrafts: next })
          }
        />
      </TableCell>
      <TableCell className='text-caption text-muted-foreground'>
        {summary}
      </TableCell>
      <TableCell className='text-right'>
        <Button
          variant='ghost'
          size='sm'
          aria-label={t('configureAria')}
          onClick={onConfigure}
        >
          {t(canEdit ? 'configure' : 'view')}
          <ChevronRight aria-hidden='true' />
        </Button>
      </TableCell>
    </TableRow>
  )
}

/**
 * LUM-1133 — which connected repositories get an automatic review on every
 * pull request (including ones without a Lumo task), and whether drafts do.
 * LUM-1331: a table with one line of what each repository sets apart from
 * the defaults; Configure opens the repository's settings sheet. The two
 * switches save at once; the sheet saves with one button. Any member sees
 * it; only an OWNER can change it.
 */
export function RepoReviewSettingsCard() {
  const intl = useIntl()
  const { data, isLoading, isError } = useRepoReviewSettings()
  const update = useUpdateRepoReviewSettings()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const t = (id: string, values?: Record<string, number>) =>
    intl.formatMessage({ id: `workspaceSettings.repoReview.${id}` }, values)

  const save = async (change: RepoReviewSettingsUpdate): Promise<boolean> => {
    try {
      await update.mutateAsync(change)
      toast.success(t('updated'))
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('updateFailed'))
      return false
    }
  }

  const repositories = data?.repositories ?? []
  const q = query.trim().toLowerCase()
  const shown = q
    ? repositories.filter(r => r.repo.toLowerCase().includes(q))
    : repositories
  const editingSetting = repositories.find(r => r.repo === editing) ?? null

  let body: React.ReactNode
  if (isLoading) {
    body = (
      <p className='px-5 py-4 text-caption text-muted-foreground'>
        {t('loading')}
      </p>
    )
  } else if (isError || !data) {
    body = (
      <p className='px-5 py-4 text-caption text-muted-foreground'>
        {t('loadFailed')}
      </p>
    )
  } else if (repositories.length === 0) {
    body = (
      <p className='px-5 py-4 text-caption text-muted-foreground'>
        {t('empty')}
      </p>
    )
  } else {
    body = (
      <>
        {repositories.length >= FILTER_FROM && (
          <div className='flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3'>
            <div className='relative w-full max-w-xs'>
              <Search
                aria-hidden='true'
                className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
              />
              <Input
                type='search'
                value={query}
                aria-label={t('filterAria')}
                placeholder={t('filterPlaceholder')}
                className='h-control-sm pl-9'
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            <span className='text-caption text-muted-foreground'>
              {t('reviewedCount', {
                count: repositories.filter(r => r.autoReview).length,
                total: repositories.length,
              })}
            </span>
          </div>
        )}
        <div className='overflow-x-auto'>
          <Table className='min-w-[720px]'>
            <TableHeader>
              <TableRow>
                <TableHead className='px-5'>{t('column.repo')}</TableHead>
                <TableHead className='w-28 whitespace-nowrap'>
                  {t('autoReview')}
                </TableHead>
                <TableHead className='w-32 whitespace-nowrap'>
                  {t('drafts')}
                </TableHead>
                <TableHead>{t('column.configuration')}</TableHead>
                <TableHead className='w-32'>
                  <span className='sr-only'>{t('column.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map(r => (
                <RepoRow
                  key={r.repo}
                  setting={r}
                  canEdit={data.canEdit}
                  saving={update.isPending}
                  onChange={change => void save(change)}
                  onConfigure={() => setEditing(r.repo)}
                />
              ))}
            </TableBody>
          </Table>
          {shown.length === 0 && (
            <p className='px-5 py-4 text-caption text-muted-foreground'>
              {t('noMatch')}
            </p>
          )}
        </div>
      </>
    )
  }

  return (
    <div className='mb-8 overflow-hidden rounded-lg border border-border'>
      <div className='border-b border-border px-5 py-3'>
        <p className='text-body-strong text-foreground'>{t('title')}</p>
        <p className='mt-0.5 text-caption text-muted-foreground'>
          {t('description')}
        </p>
        {data && !data.canEdit && (
          <p className='mt-1 text-caption text-muted-foreground'>
            {t('ownerOnly')}
          </p>
        )}
      </div>
      {body}
      <RepoReviewSettingsSheet
        setting={editingSetting}
        canEdit={data?.canEdit ?? false}
        saving={update.isPending}
        onClose={() => setEditing(null)}
        onSave={save}
      />
    </div>
  )
}
