'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { ChevronRight, Plus, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import type {
  CustomPreMergeCheck,
  PreMergeCheckMode,
} from '@/ee/security/security-scan/pre-merge-checks'
import type { PreMergeDraft } from './repo-review-draft'

/** Same values and limits as the server's schema (which enforces them). */
const MODES: readonly PreMergeCheckMode[] = ['off', 'warning', 'error']
const NAME_MAX = 50
const INSTRUCTIONS_MAX = 1000
const CUSTOM_MAX = 5

interface ModeToggleProps {
  label: string
  value: PreMergeCheckMode
  disabled: boolean
  onChange: (mode: PreMergeCheckMode) => void
}

/** Off / Warning / Error as one segmented control. */
function ModeToggle({ label, value, disabled, onChange }: ModeToggleProps) {
  const intl = useIntl()
  return (
    <ToggleGroup
      type='single'
      size='sm'
      value={value}
      disabled={disabled}
      aria-label={label}
      // A segmented control: the chosen mode sits raised on a muted track.
      className='shrink-0 gap-0.5 rounded-md bg-muted p-0.5'
      // Radix sends '' when the pressed item is clicked again: keep the mode.
      onValueChange={v => v && onChange(v as PreMergeCheckMode)}
    >
      {MODES.map(m => (
        <ToggleGroupItem
          key={m}
          value={m}
          className='h-7 min-w-0 px-3 text-caption text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-elevation-1'
        >
          {intl.formatMessage({
            id: `workspaceSettings.repoReview.checks.mode.${m}`,
          })}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

interface CheckRowProps {
  title: string
  hint: string
  control: ReactNode
  children?: ReactNode
}

function CheckRow({ title, hint, control, children }: CheckRowProps) {
  return (
    <div className='flex flex-col gap-3 py-4 first:pt-0'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex min-w-0 flex-1 basis-60 flex-col gap-0.5'>
          <span className='text-body-strong text-foreground'>{title}</span>
          <span className='text-caption text-muted-foreground'>{hint}</span>
        </div>
        {control}
      </div>
      {children}
    </div>
  )
}

interface RepoPreMergeChecksSectionProps {
  idBase: string
  draft: PreMergeDraft
  disabled: boolean
  onChange: (draft: PreMergeDraft) => void
}

/**
 * LUM-1148 — one repository's pre-merge checks: the built-in title,
 * description and linked task checks, up to five natural-language checks,
 * and who may override them on a PR. LUM-1331: a controlled section of the
 * settings sheet, one Off / Warning / Error control per check.
 */
export function RepoPreMergeChecksSection({
  idBase,
  draft,
  disabled,
  onChange,
}: RepoPreMergeChecksSectionProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, number>) =>
    intl.formatMessage(
      { id: `workspaceSettings.repoReview.checks.${id}` },
      values
    )
  const set = (change: Partial<PreMergeDraft>) =>
    onChange({ ...draft, ...change })
  const id = (name: string) => `${idBase}-${name}`

  const setCustom = (i: number, change: Partial<CustomPreMergeCheck>) =>
    set({
      customChecks: draft.customChecks.map((c, j) =>
        j === i ? { ...c, ...change } : c
      ),
    })

  return (
    <div className='flex flex-col gap-4'>
      <p className='text-caption text-muted-foreground'>{t('intro')}</p>
      <div className='flex flex-col divide-y divide-border'>
        <CheckRow
          title={t('title')}
          hint={t('titleHint')}
          control={
            <ModeToggle
              label={t('title')}
              value={draft.titleMode}
              disabled={disabled}
              onChange={mode => set({ titleMode: mode })}
            />
          }
        >
          {draft.titleMode !== 'off' && (
            <div className='flex flex-col gap-1.5'>
              <Label
                htmlFor={id('requirements')}
                className='text-caption text-muted-foreground'
              >
                {t('titleRequirements')}
              </Label>
              <Textarea
                id={id('requirements')}
                value={draft.titleRequirements}
                rows={2}
                maxLength={INSTRUCTIONS_MAX}
                disabled={disabled}
                onChange={e => set({ titleRequirements: e.target.value })}
              />
            </div>
          )}
        </CheckRow>
        <CheckRow
          title={t('description')}
          hint={t('descriptionHint')}
          control={
            <ModeToggle
              label={t('description')}
              value={draft.descriptionMode}
              disabled={disabled}
              onChange={mode => set({ descriptionMode: mode })}
            />
          }
        />
        <CheckRow
          title={t('issueAssessment')}
          hint={t('issueAssessmentHint')}
          control={
            <ModeToggle
              label={t('issueAssessment')}
              value={draft.issueMode}
              disabled={disabled}
              onChange={mode => set({ issueMode: mode })}
            />
          }
        />
        {draft.customChecks.map((c, i) => (
          <CheckRow
            key={i}
            title={c.name.trim() || t('customUntitled')}
            hint={t('customLabel')}
            control={
              <div className='flex items-center gap-1'>
                <ModeToggle
                  label={t('customMode')}
                  value={c.mode}
                  disabled={disabled}
                  onChange={mode => setCustom(i, { mode })}
                />
                {!disabled && (
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('removeCustomAria', { n: i + 1 })}
                    className='text-muted-foreground'
                    onClick={() =>
                      set({
                        customChecks: draft.customChecks.filter(
                          (_, j) => j !== i
                        ),
                      })
                    }
                  >
                    <X aria-hidden='true' />
                  </Button>
                )}
              </div>
            }
          >
            <div className='flex flex-col gap-2'>
              <Input
                aria-label={t('customName')}
                placeholder={t('customName')}
                value={c.name}
                maxLength={NAME_MAX}
                disabled={disabled}
                onChange={e => setCustom(i, { name: e.target.value })}
              />
              <Textarea
                aria-label={t('customInstructions')}
                placeholder={t('customInstructionsPlaceholder')}
                value={c.instructions}
                rows={2}
                maxLength={INSTRUCTIONS_MAX}
                disabled={disabled}
                onChange={e => setCustom(i, { instructions: e.target.value })}
              />
            </div>
          </CheckRow>
        ))}
      </div>
      {!disabled && (
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={draft.customChecks.length >= CUSTOM_MAX}
            onClick={() =>
              set({
                customChecks: [
                  ...draft.customChecks,
                  { name: '', mode: 'warning', instructions: '' },
                ],
              })
            }
          >
            <Plus aria-hidden='true' />
            {t('addCustom')}
          </Button>
          <span className='text-caption text-muted-foreground'>
            {t('customCount', {
              count: draft.customChecks.length,
              max: CUSTOM_MAX,
            })}
          </span>
        </div>
      )}
      <Collapsible className='rounded-md border border-border'>
        <CollapsibleTrigger className='flex w-full items-center gap-2 px-3 py-2 text-caption text-muted-foreground hover:text-foreground'>
          <ChevronRight
            aria-hidden='true'
            className='size-4 transition-transform duration-fast group-data-[state=open]/collapsible:rotate-90'
          />
          {t('advanced')}
        </CollapsibleTrigger>
        <CollapsibleContent className='flex flex-col gap-3 border-t border-border p-3'>
          <div className='flex items-start gap-3'>
            <Switch
              id={id('reviewers-only')}
              checked={draft.overrideRequestedReviewersOnly}
              disabled={disabled}
              className='mt-0.5'
              onCheckedChange={next =>
                set({ overrideRequestedReviewersOnly: next })
              }
            />
            <Label
              htmlFor={id('reviewers-only')}
              className='text-body text-foreground'
            >
              {t('reviewersOnly')}
            </Label>
          </div>
          <div className='flex items-start gap-3'>
            <Switch
              id={id('task-details')}
              checked={draft.taskDetailsOnPublicRepos}
              disabled={disabled}
              className='mt-0.5'
              onCheckedChange={next => set({ taskDetailsOnPublicRepos: next })}
            />
            <Label
              htmlFor={id('task-details')}
              className='text-body text-foreground'
            >
              {t('taskDetailsOnPublicRepos')}
            </Label>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
