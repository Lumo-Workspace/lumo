'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  CustomPreMergeCheck,
  PreMergeCheckMode,
  PreMergeChecksSetting,
} from '@/ee/security/security-scan/pre-merge-checks'
import type { RepoReviewSettingsUpdate } from '@/ee/security/services/repo-review-settings.service'

/** Same values and limits as the server's schema (which enforces them). */
const MODES: readonly PreMergeCheckMode[] = ['off', 'warning', 'error']
const NAME_MAX = 50
const INSTRUCTIONS_MAX = 1000
const CUSTOM_MAX = 5

export interface PreMergeDraft {
  titleMode: PreMergeCheckMode
  titleRequirements: string
  descriptionMode: PreMergeCheckMode
  /** LUM-1149: the linked task / issue assessment. */
  issueMode: PreMergeCheckMode
  taskDetailsOnPublicRepos: boolean
  customChecks: CustomPreMergeCheck[]
  overrideRequestedReviewersOnly: boolean
}

export function draftOfChecks(s: PreMergeChecksSetting): PreMergeDraft {
  return {
    titleMode: s.title.mode,
    titleRequirements: s.title.requirements ?? '',
    descriptionMode: s.description.mode,
    issueMode: s.issueAssessment.mode,
    taskDetailsOnPublicRepos: s.issueAssessment.taskDetailsOnPublicRepos,
    customChecks: s.customChecks.map(c => ({ ...c })),
    overrideRequestedReviewersOnly: s.overrideRequestedReviewersOnly,
  }
}

/** PURE — the PATCH body for what the owner changed (null = nothing). */
export function preMergeChecksUpdate(
  repo: string,
  s: PreMergeChecksSetting,
  d: PreMergeDraft
): RepoReviewSettingsUpdate | null {
  const requirements = d.titleRequirements.trim()
  const custom = d.customChecks
    .map(c => ({
      name: c.name.trim(),
      mode: c.mode,
      instructions: c.instructions.trim(),
    }))
    .filter(c => c.name.length > 0 && c.instructions.length > 0)
  const title: { mode?: PreMergeCheckMode; requirements?: string | null } = {}
  if (d.titleMode !== s.title.mode) title.mode = d.titleMode
  if (requirements !== (s.title.requirements ?? ''))
    title.requirements = requirements.length > 0 ? requirements : null
  const checks: NonNullable<RepoReviewSettingsUpdate['preMergeChecks']> = {}
  if (Object.keys(title).length > 0) checks.title = title
  if (d.descriptionMode !== s.description.mode)
    checks.description = { mode: d.descriptionMode }
  const issue: {
    mode?: PreMergeCheckMode
    taskDetailsOnPublicRepos?: boolean
  } = {}
  if (d.issueMode !== s.issueAssessment.mode) issue.mode = d.issueMode
  if (d.taskDetailsOnPublicRepos !== s.issueAssessment.taskDetailsOnPublicRepos)
    issue.taskDetailsOnPublicRepos = d.taskDetailsOnPublicRepos
  if (Object.keys(issue).length > 0) checks.issueAssessment = issue
  if (JSON.stringify(custom) !== JSON.stringify(s.customChecks))
    checks.customChecks = custom
  if (d.overrideRequestedReviewersOnly !== s.overrideRequestedReviewersOnly)
    checks.overrideRequestedReviewersOnly = d.overrideRequestedReviewersOnly
  return Object.keys(checks).length > 0
    ? { repo, preMergeChecks: checks }
    : null
}

interface ModeSelectProps {
  id: string
  value: PreMergeCheckMode
  disabled: boolean
  ariaLabel?: string
  onChange: (mode: PreMergeCheckMode) => void
}

function ModeSelect({
  id,
  value,
  disabled,
  ariaLabel,
  onChange,
}: ModeSelectProps) {
  const intl = useIntl()
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={v => onChange(v as PreMergeCheckMode)}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className='h-8 w-auto gap-2 px-2 text-caption text-foreground'
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODES.map(m => (
          <SelectItem key={m} value={m}>
            {intl.formatMessage({
              id: `workspaceSettings.repoReview.checks.mode.${m}`,
            })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface RepoPreMergeChecksEditorProps {
  repo: string
  setting: PreMergeChecksSetting
  canEdit: boolean
  saving: boolean
  onSave: (update: RepoReviewSettingsUpdate) => void
}

/**
 * LUM-1148 — one repository's pre-merge checks: the built-in title and
 * description checks, up to five natural-language checks, and who may
 * override them on a PR. Saved together with one button; OWNER only.
 * LUM-1149 adds the linked task / issue assessment and its privacy switch.
 */
export function RepoPreMergeChecksEditor({
  repo,
  setting,
  canEdit,
  saving,
  onSave,
}: RepoPreMergeChecksEditorProps) {
  const intl = useIntl()
  const t = (id: string) =>
    intl.formatMessage({ id: `workspaceSettings.repoReview.checks.${id}` })
  const [draft, setDraft] = useState<PreMergeDraft>(() =>
    draftOfChecks(setting)
  )
  const update = preMergeChecksUpdate(repo, setting, draft)
  const idBase = `repo-checks-${repo.replace(/[^\w-]/g, '-')}`
  const disabled = !canEdit || saving

  const setCustom = (i: number, change: Partial<CustomPreMergeCheck>) =>
    setDraft(d => ({
      ...d,
      customChecks: d.customChecks.map((c, j) =>
        j === i ? { ...c, ...change } : c
      ),
    }))

  return (
    <div className='flex flex-col gap-3 pt-3'>
      <p className='text-caption text-muted-foreground'>{t('intro')}</p>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor={`${idBase}-title`}
            className='text-caption text-foreground'
          >
            {t('title')}
          </label>
          <ModeSelect
            id={`${idBase}-title`}
            value={draft.titleMode}
            disabled={disabled}
            onChange={mode => setDraft(d => ({ ...d, titleMode: mode }))}
          />
        </div>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor={`${idBase}-description`}
            className='text-caption text-foreground'
          >
            {t('description')}
          </label>
          <ModeSelect
            id={`${idBase}-description`}
            value={draft.descriptionMode}
            disabled={disabled}
            onChange={mode => setDraft(d => ({ ...d, descriptionMode: mode }))}
          />
        </div>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor={`${idBase}-issue`}
            className='text-caption text-foreground'
          >
            {t('issueAssessment')}
          </label>
          <ModeSelect
            id={`${idBase}-issue`}
            value={draft.issueMode}
            disabled={disabled}
            onChange={mode => setDraft(d => ({ ...d, issueMode: mode }))}
          />
          <p className='text-caption text-muted-foreground'>
            {t('issueAssessmentHint')}
          </p>
        </div>
        <label
          htmlFor={`${idBase}-task-details`}
          className='flex items-center gap-2 self-start text-caption text-muted-foreground sm:pt-6'
        >
          <Switch
            id={`${idBase}-task-details`}
            checked={draft.taskDetailsOnPublicRepos}
            disabled={disabled}
            onCheckedChange={next =>
              setDraft(d => ({ ...d, taskDetailsOnPublicRepos: next }))
            }
          />
          {t('taskDetailsOnPublicRepos')}
        </label>
        <div className='flex flex-col gap-1 sm:col-span-2'>
          <label
            htmlFor={`${idBase}-requirements`}
            className='text-caption text-foreground'
          >
            {t('titleRequirements')}
          </label>
          <Textarea
            id={`${idBase}-requirements`}
            value={draft.titleRequirements}
            rows={2}
            maxLength={INSTRUCTIONS_MAX}
            disabled={disabled}
            className='text-caption'
            onChange={e =>
              setDraft(d => ({ ...d, titleRequirements: e.target.value }))
            }
          />
        </div>
      </div>
      <p className='text-caption text-foreground'>{t('custom')}</p>
      {draft.customChecks.map((c, i) => (
        <div
          key={i}
          className='flex flex-col gap-2 rounded-md border border-border p-2'
        >
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              aria-label={t('customName')}
              placeholder={t('customName')}
              value={c.name}
              maxLength={NAME_MAX}
              disabled={disabled}
              className='h-8 flex-1 text-caption'
              onChange={e => setCustom(i, { name: e.target.value })}
            />
            <ModeSelect
              id={`${idBase}-custom-${i}-mode`}
              value={c.mode}
              disabled={disabled}
              ariaLabel={t('customMode')}
              onChange={mode => setCustom(i, { mode })}
            />
            {canEdit && (
              <Button
                variant='ghost'
                size='sm'
                disabled={saving}
                onClick={() =>
                  setDraft(d => ({
                    ...d,
                    customChecks: d.customChecks.filter((_, j) => j !== i),
                  }))
                }
              >
                {t('removeCustom')}
              </Button>
            )}
          </div>
          <Textarea
            aria-label={t('customInstructions')}
            placeholder={t('customInstructions')}
            value={c.instructions}
            rows={2}
            maxLength={INSTRUCTIONS_MAX}
            disabled={disabled}
            className='text-caption'
            onChange={e => setCustom(i, { instructions: e.target.value })}
          />
        </div>
      ))}
      {canEdit && draft.customChecks.length < CUSTOM_MAX && (
        <div>
          <Button
            variant='outline'
            size='sm'
            disabled={saving}
            onClick={() =>
              setDraft(d => ({
                ...d,
                customChecks: [
                  ...d.customChecks,
                  { name: '', mode: 'warning', instructions: '' },
                ],
              }))
            }
          >
            {t('addCustom')}
          </Button>
        </div>
      )}
      <label
        htmlFor={`${idBase}-reviewers-only`}
        className='flex items-center gap-2 text-caption text-muted-foreground'
      >
        <Switch
          id={`${idBase}-reviewers-only`}
          checked={draft.overrideRequestedReviewersOnly}
          disabled={disabled}
          onCheckedChange={next =>
            setDraft(d => ({ ...d, overrideRequestedReviewersOnly: next }))
          }
        />
        {t('reviewersOnly')}
      </label>
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
