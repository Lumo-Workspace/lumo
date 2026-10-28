'use client'

import { useIntl } from 'react-intl'
import { Plus, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  PATH_INSTRUCTIONS_MAX_ENTRIES,
  PATH_INSTRUCTION_MAX_CHARS,
  PATH_INSTRUCTION_PATH_MAX_CHARS,
  TONE_INSTRUCTIONS_MAX_CHARS,
  type PathInstruction,
} from '@/ee/security/security-scan/path-instructions'
import {
  REVIEW_PROFILES,
  type ReviewProfile,
} from '@/ee/security/security-scan/review-profile'
import {
  HIGH_LEVEL_SUMMARY_MODES,
  type HighLevelSummaryMode,
} from '@/ee/security/security-scan/pr-description-summary'
import type { StyleDraft } from './repo-review-draft'

interface RepoReviewStyleSectionProps {
  idBase: string
  draft: StyleDraft
  disabled: boolean
  onChange: (draft: StyleDraft) => void
}

/**
 * LUM-1147 — one repository's review style: the review profile (which
 * findings get inline comments), the tone of the AI review's text, the
 * summary and diagram, and extra review instructions per path glob.
 * LUM-1331: a controlled section of the settings sheet.
 */
export function RepoReviewStyleSection({
  idBase,
  draft,
  disabled,
  onChange,
}: RepoReviewStyleSectionProps) {
  const intl = useIntl()
  const t = (id: string) =>
    intl.formatMessage({ id: `workspaceSettings.repoReview.style.${id}` })
  const set = (change: Partial<StyleDraft>) => onChange({ ...draft, ...change })
  const id = (name: string) => `${idBase}-${name}`

  const setRow = (i: number, patch: Partial<PathInstruction>) =>
    set({
      pathInstructions: draft.pathInstructions.map((r, j) =>
        j === i ? { ...r, ...patch } : r
      ),
    })

  return (
    <div className='flex flex-col gap-6'>
      <fieldset className='flex flex-col gap-2'>
        <legend className='mb-2 text-body-strong text-foreground'>
          {t('profile')}
        </legend>
        <RadioGroup
          value={draft.reviewProfile}
          disabled={disabled}
          className='grid gap-2 sm:grid-cols-3'
          onValueChange={v => set({ reviewProfile: v as ReviewProfile })}
        >
          {REVIEW_PROFILES.map(p => (
            <Label
              key={p}
              htmlFor={id(`profile-${p}`)}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3',
                draft.reviewProfile === p && 'border-foreground'
              )}
            >
              <RadioGroupItem
                id={id(`profile-${p}`)}
                value={p}
                className='mt-0.5'
              />
              <span className='flex flex-col gap-0.5'>
                <span className='text-body-strong'>{t(`profile.${p}`)}</span>
                <span className='text-caption text-muted-foreground'>
                  {t(`profileShort.${p}`)}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        <p className='text-caption text-muted-foreground'>
          {t(`profileHint.${draft.reviewProfile}`)}
        </p>
      </fieldset>

      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='flex flex-col gap-1.5'>
          <Label
            htmlFor={id('summary')}
            className='text-body-strong text-foreground'
          >
            {t('summary')}
          </Label>
          <Select
            value={draft.highLevelSummary}
            disabled={disabled}
            onValueChange={v =>
              set({ highLevelSummary: v as HighLevelSummaryMode })
            }
          >
            <SelectTrigger id={id('summary')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HIGH_LEVEL_SUMMARY_MODES.map(m => (
                <SelectItem key={m} value={m}>
                  {t(`summary.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className='text-caption text-muted-foreground'>
            {t(`summaryHint.${draft.highLevelSummary}`)}
          </p>
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label
            htmlFor={id('tone')}
            className='text-body-strong text-foreground'
          >
            {t('tone')}
          </Label>
          <Input
            id={id('tone')}
            value={draft.toneInstructions}
            maxLength={TONE_INSTRUCTIONS_MAX_CHARS}
            disabled={disabled}
            onChange={e => set({ toneInstructions: e.target.value })}
          />
          <p className='text-caption text-muted-foreground'>{t('toneHint')}</p>
        </div>
      </div>

      <div className='flex items-start gap-3'>
        <Switch
          id={id('diagrams')}
          checked={draft.sequenceDiagrams}
          disabled={disabled}
          className='mt-0.5'
          onCheckedChange={next => set({ sequenceDiagrams: next })}
        />
        <div className='flex flex-col gap-0.5'>
          <Label
            htmlFor={id('diagrams')}
            className='text-body-strong text-foreground'
          >
            {t('sequenceDiagrams')}
          </Label>
          <p className='text-caption text-muted-foreground'>
            {t('sequenceDiagramsHint')}
          </p>
        </div>
      </div>

      <Separator />

      <div className='flex flex-col gap-2'>
        <div className='flex flex-col gap-1'>
          <p className='text-body-strong text-foreground'>
            {t('pathInstructions')}
          </p>
          <p className='text-caption text-muted-foreground'>
            {t('pathInstructionsHint')}
          </p>
        </div>
        {draft.pathInstructions.length > 0 && (
          <div className='flex flex-col divide-y divide-border rounded-md border border-border'>
            {draft.pathInstructions.map((row, i) => (
              <div
                key={i}
                className='flex flex-col gap-2 p-2 sm:flex-row sm:items-start'
              >
                <Input
                  aria-label={t('pathAria')}
                  placeholder='scripts/**'
                  value={row.path}
                  maxLength={PATH_INSTRUCTION_PATH_MAX_CHARS}
                  disabled={disabled}
                  className='font-mono sm:w-48'
                  onChange={e => setRow(i, { path: e.target.value })}
                />
                <Textarea
                  aria-label={t('instructionsAria')}
                  value={row.instructions}
                  rows={1}
                  maxLength={PATH_INSTRUCTION_MAX_CHARS}
                  disabled={disabled}
                  className='min-h-control-md flex-1'
                  onChange={e => setRow(i, { instructions: e.target.value })}
                />
                {!disabled && (
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('removeAria')}
                    className='self-end text-muted-foreground sm:self-start'
                    onClick={() =>
                      set({
                        pathInstructions: draft.pathInstructions.filter(
                          (_, j) => j !== i
                        ),
                      })
                    }
                  >
                    <X aria-hidden='true' />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {!disabled && (
          <div>
            <Button
              variant='outline'
              size='sm'
              disabled={
                draft.pathInstructions.length >= PATH_INSTRUCTIONS_MAX_ENTRIES
              }
              onClick={() =>
                set({
                  pathInstructions: [
                    ...draft.pathInstructions,
                    { path: '', instructions: '' },
                  ],
                })
              }
            >
              <Plus aria-hidden='true' />
              {t('add')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
