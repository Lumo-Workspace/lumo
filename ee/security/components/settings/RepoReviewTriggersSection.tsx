'use client'

import { useIntl } from 'react-intl'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import type { EmptyBaseBranchesMeans } from '@/ee/security/security-scan/auto-review-policy'
import { ChipInput } from './ChipInput'
import {
  branchScopesFor,
  invalidRegExp,
  type BranchScope,
  type FiltersDraft,
} from './repo-review-draft'

interface RepoReviewTriggersSectionProps {
  idBase: string
  emptyBaseBranchesMeans: EmptyBaseBranchesMeans
  draft: FiltersDraft
  disabled: boolean
  onChange: (draft: FiltersDraft) => void
}

/**
 * LUM-1331 — "When to review": the base branches, then what skips a pull
 * request, then what limits the review to (or, with automatic review off,
 * opts in) a pull request, then the files the AI review leaves out.
 */
export function RepoReviewTriggersSection({
  idBase,
  emptyBaseBranchesMeans,
  draft,
  disabled,
  onChange,
}: RepoReviewTriggersSectionProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string>) =>
    intl.formatMessage(
      { id: `workspaceSettings.repoReview.when.${id}` },
      values
    )
  const set = (change: Partial<FiltersDraft>) =>
    onChange({ ...draft, ...change })
  const id = (name: string) => `${idBase}-${name}`

  const chips = (
    name: keyof FiltersDraft,
    label: string,
    placeholder: string,
    hint?: string
  ) => (
    <div className='flex flex-col gap-1.5'>
      <Label htmlFor={id(name)} className='text-body-strong text-foreground'>
        {label}
      </Label>
      <ChipInput
        id={id(name)}
        values={draft[name] as string[]}
        placeholder={placeholder}
        disabled={disabled}
        aria-describedby={hint ? id(`${name}-hint`) : undefined}
        onChange={v => set({ [name]: v })}
      />
      {hint && (
        <p
          id={id(`${name}-hint`)}
          className='text-caption text-muted-foreground'
        >
          {hint}
        </p>
      )}
    </div>
  )

  return (
    <div className='flex flex-col gap-6'>
      <fieldset className='flex flex-col gap-2'>
        <legend className='mb-2 text-body-strong text-foreground'>
          {t('branch.title')}
        </legend>
        <RadioGroup
          value={draft.branchScope}
          disabled={disabled}
          className='grid gap-2 sm:grid-cols-3'
          onValueChange={v => set({ branchScope: v as BranchScope })}
        >
          {branchScopesFor(emptyBaseBranchesMeans).map(scope => (
            <Label
              key={scope}
              htmlFor={id(`branch-${scope}`)}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3',
                draft.branchScope === scope && 'border-foreground'
              )}
            >
              <RadioGroupItem
                id={id(`branch-${scope}`)}
                value={scope}
                className='mt-0.5'
              />
              <span className='flex flex-col gap-0.5'>
                <span className='text-body-strong'>{t(`branch.${scope}`)}</span>
                <span className='text-caption text-muted-foreground'>
                  {t(`branch.${scope}Hint`)}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        {draft.branchScope === 'patterns' && (
          <div className='flex flex-col gap-1'>
            <ChipInput
              id={id('branchPatterns')}
              values={draft.branchPatterns}
              placeholder={t('branch.patternPlaceholder')}
              disabled={disabled}
              aria-describedby={id('branchPatterns-hint')}
              validate={v =>
                invalidRegExp(v) ? t('branch.invalid', { value: v }) : null
              }
              onChange={v => set({ branchPatterns: v })}
            />
            <p
              id={id('branchPatterns-hint')}
              className={cn(
                'text-caption',
                draft.branchPatterns.length === 0
                  ? 'text-danger-text'
                  : 'text-muted-foreground'
              )}
            >
              {t(
                draft.branchPatterns.length === 0
                  ? 'branch.patternsEmpty'
                  : 'branch.patternsInputHint'
              )}
            </p>
          </div>
        )}
      </fieldset>

      <Separator />

      <div className='flex flex-col gap-1'>
        <p className='text-body-strong text-foreground'>{t('skip.title')}</p>
        <p className='text-caption text-muted-foreground'>{t('skip.hint')}</p>
      </div>
      <div className='grid gap-4 sm:grid-cols-2'>
        {chips(
          'ignoreUsernames',
          t('skip.authors'),
          t('skip.authorsPlaceholder'),
          t('skip.authorsHint')
        )}
        {chips(
          'ignoreTitleKeywords',
          t('skip.titles'),
          t('skip.titlesPlaceholder'),
          t('skip.titlesHint')
        )}
        {chips('skipLabels', t('skip.labels'), t('labelPlaceholder'))}
      </div>

      <Separator />

      <div className='flex flex-col gap-1'>
        <p className='text-body-strong text-foreground'>{t('only.title')}</p>
        <p className='text-caption text-muted-foreground'>{t('only.hint')}</p>
      </div>
      <div className='grid gap-4 sm:grid-cols-2'>
        {chips('onlyLabels', t('only.labels'), t('labelPlaceholder'))}
        <div className='flex flex-col gap-1.5'>
          <Label
            htmlFor={id('descriptionKeyword')}
            className='text-body-strong text-foreground'
          >
            {t('only.keyword')}
          </Label>
          <Input
            id={id('descriptionKeyword')}
            value={draft.descriptionKeyword}
            disabled={disabled}
            placeholder={t('only.keywordPlaceholder')}
            className='font-mono'
            aria-describedby={id('descriptionKeyword-hint')}
            onChange={e => set({ descriptionKeyword: e.target.value })}
          />
          <p
            id={id('descriptionKeyword-hint')}
            className='text-caption text-muted-foreground'
          >
            {t('only.keywordHint')}
          </p>
        </div>
      </div>

      <Separator />

      {chips(
        'pathFilters',
        t('paths.title'),
        t('paths.placeholder'),
        t('paths.hint')
      )}
    </div>
  )
}
