'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type {
  RepoReviewSettingView,
  RepoReviewSettingsUpdate,
} from '@/ee/security/services/repo-review-settings.service'

/** The list fields the editor shows, one entry per line. */
const LIST_FIELDS = [
  'baseBranches',
  'labels',
  'ignoreTitleKeywords',
  'ignoreUsernames',
  'pathFilters',
] as const
type ListField = (typeof LIST_FIELDS)[number]

type Draft = Record<ListField, string> & { descriptionKeyword: string }

/** One entry per line; blank lines dropped. */
export function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
}

function draftOf(setting: RepoReviewSettingView): Draft {
  return {
    baseBranches: setting.baseBranches.join('\n'),
    labels: setting.labels.join('\n'),
    ignoreTitleKeywords: setting.ignoreTitleKeywords.join('\n'),
    ignoreUsernames: setting.ignoreUsernames.join('\n'),
    pathFilters: setting.pathFilters.join('\n'),
    descriptionKeyword: setting.descriptionKeyword ?? '',
  }
}

/** PURE — the PATCH body for what the owner changed (null = nothing). */
export function filtersUpdate(
  setting: RepoReviewSettingView,
  draft: Draft
): RepoReviewSettingsUpdate | null {
  const update: RepoReviewSettingsUpdate = { repo: setting.repo }
  let changed = false
  for (const field of LIST_FIELDS) {
    const next = linesToList(draft[field])
    if (next.join('\n') !== setting[field].join('\n')) {
      update[field] = next
      changed = true
    }
  }
  const keyword = draft.descriptionKeyword.trim()
  if (keyword !== (setting.descriptionKeyword ?? '')) {
    update.descriptionKeyword = keyword.length > 0 ? keyword : null
    changed = true
  }
  return changed ? update : null
}

interface RepoReviewFiltersEditorProps {
  setting: RepoReviewSettingView
  canEdit: boolean
  saving: boolean
  onSave: (update: RepoReviewSettingsUpdate) => void
}

/**
 * LUM-1143 — one repository's auto-review filters (base
 * branches, labels, skipped titles / authors, description keyword, path
 * filters). Saved together with one button; OWNER only.
 */
export function RepoReviewFiltersEditor({
  setting,
  canEdit,
  saving,
  onSave,
}: RepoReviewFiltersEditorProps) {
  const intl = useIntl()
  const t = (id: string) =>
    intl.formatMessage({ id: `workspaceSettings.repoReview.filters.${id}` })
  const [draft, setDraft] = useState<Draft>(() => draftOf(setting))
  const update = filtersUpdate(setting, draft)
  const idBase = `repo-filters-${setting.repo.replace(/[^\w-]/g, '-')}`
  const disabled = !canEdit || saving

  const field = (name: ListField, hint?: string) => (
    <div className='flex flex-col gap-1'>
      <Label
        htmlFor={`${idBase}-${name}`}
        className='text-caption text-foreground'
      >
        {t(name)}
      </Label>
      <Textarea
        id={`${idBase}-${name}`}
        value={draft[name]}
        rows={2}
        disabled={disabled}
        className='text-caption font-mono'
        onChange={e => setDraft(d => ({ ...d, [name]: e.target.value }))}
      />
      {hint && <p className='text-caption text-muted-foreground'>{hint}</p>}
    </div>
  )

  return (
    <div className='flex flex-col gap-3 pt-3'>
      <p className='text-caption text-muted-foreground'>{t('precedence')}</p>
      <div className='grid gap-3 sm:grid-cols-2'>
        {field(
          'baseBranches',
          t(
            setting.emptyBaseBranchesMeans === 'all_branches'
              ? 'baseBranchesHintAll'
              : 'baseBranchesHintDefault'
          )
        )}
        {field('labels', t('labelsHint'))}
        {field('ignoreTitleKeywords')}
        {field('ignoreUsernames')}
        {field('pathFilters', t('pathFiltersHint'))}
        <div className='flex flex-col gap-1'>
          <Label
            htmlFor={`${idBase}-descriptionKeyword`}
            className='text-caption text-foreground'
          >
            {t('descriptionKeyword')}
          </Label>
          <Input
            id={`${idBase}-descriptionKeyword`}
            value={draft.descriptionKeyword}
            disabled={disabled}
            className='text-caption font-mono'
            onChange={e =>
              setDraft(d => ({ ...d, descriptionKeyword: e.target.value }))
            }
          />
          <p className='text-caption text-muted-foreground'>
            {t('descriptionKeywordHint')}
          </p>
        </div>
      </div>
      {canEdit && (
        <div>
          <Button
            size='sm'
            disabled={saving || update === null}
            onClick={() => update && onSave(update)}
          >
            {t('save')}
          </Button>
        </div>
      )}
    </div>
  )
}
