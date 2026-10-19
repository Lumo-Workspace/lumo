'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  RepoReviewSettingView,
  RepoReviewSettingsUpdate,
} from '@/ee/security/services/repo-review-settings.service'
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

interface StyleDraft {
  reviewProfile: ReviewProfile
  toneInstructions: string
  pathInstructions: PathInstruction[]
  highLevelSummary: HighLevelSummaryMode
  sequenceDiagrams: boolean
}

function draftOf(setting: RepoReviewSettingView): StyleDraft {
  return {
    highLevelSummary: setting.highLevelSummary,
    sequenceDiagrams: setting.sequenceDiagrams,
    reviewProfile: setting.reviewProfile,
    toneInstructions: setting.toneInstructions ?? '',
    pathInstructions: setting.pathInstructions.map(p => ({ ...p })),
  }
}

/** Trimmed rows, a row missing either half dropped. */
function cleanRows(rows: readonly PathInstruction[]): PathInstruction[] {
  return rows
    .map(r => ({ path: r.path.trim(), instructions: r.instructions.trim() }))
    .filter(r => r.path.length > 0 && r.instructions.length > 0)
}

/** PURE — the PATCH body for what the owner changed (null = nothing). */
export function styleUpdate(
  setting: RepoReviewSettingView,
  draft: StyleDraft
): RepoReviewSettingsUpdate | null {
  const update: RepoReviewSettingsUpdate = { repo: setting.repo }
  let changed = false
  if (draft.reviewProfile !== setting.reviewProfile) {
    update.reviewProfile = draft.reviewProfile
    changed = true
  }
  // LUM-1151: where the high-level summary goes.
  if (draft.highLevelSummary !== setting.highLevelSummary) {
    update.highLevelSummary = draft.highLevelSummary
    changed = true
  }
  // LUM-1155: the call-flow diagram in the walkthrough.
  if (draft.sequenceDiagrams !== setting.sequenceDiagrams) {
    update.sequenceDiagrams = draft.sequenceDiagrams
    changed = true
  }
  const tone = draft.toneInstructions.trim()
  if (tone !== (setting.toneInstructions ?? '')) {
    update.toneInstructions = tone.length > 0 ? tone : null
    changed = true
  }
  const rows = cleanRows(draft.pathInstructions)
  if (JSON.stringify(rows) !== JSON.stringify(setting.pathInstructions)) {
    update.pathInstructions = rows
    changed = true
  }
  return changed ? update : null
}

interface RepoReviewStyleEditorProps {
  setting: RepoReviewSettingView
  canEdit: boolean
  saving: boolean
  onSave: (update: RepoReviewSettingsUpdate) => void
}

/**
 * LUM-1147 — one repository's review style: the review profile (which
 * findings get inline comments), the tone of the AI review's text, and
 * extra review instructions per path glob. Saved together; OWNER only.
 * `.lumo.yaml` on the base branch overrides each value.
 */
export function RepoReviewStyleEditor({
  setting,
  canEdit,
  saving,
  onSave,
}: RepoReviewStyleEditorProps) {
  const intl = useIntl()
  const t = (id: string) =>
    intl.formatMessage({ id: `workspaceSettings.repoReview.style.${id}` })
  const [draft, setDraft] = useState<StyleDraft>(() => draftOf(setting))
  const update = styleUpdate(setting, draft)
  const idBase = `repo-style-${setting.repo.replace(/[^\w-]/g, '-')}`
  const disabled = !canEdit || saving

  const setRow = (i: number, patch: Partial<PathInstruction>) =>
    setDraft(d => ({
      ...d,
      pathInstructions: d.pathInstructions.map((r, j) =>
        j === i ? { ...r, ...patch } : r
      ),
    }))

  return (
    <div className='flex flex-col gap-3 pt-3'>
      <p className='text-caption text-muted-foreground'>{t('precedence')}</p>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor={`${idBase}-profile`}
            className='text-caption text-foreground'
          >
            {t('profile')}
          </label>
          <Select
            value={draft.reviewProfile}
            disabled={disabled}
            onValueChange={v =>
              setDraft(d => ({ ...d, reviewProfile: v as ReviewProfile }))
            }
          >
            <SelectTrigger id={`${idBase}-profile`} className='text-caption'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REVIEW_PROFILES.map(p => (
                <SelectItem key={p} value={p} className='text-caption'>
                  {t(`profile.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className='text-caption text-muted-foreground'>
            {t(`profileHint.${draft.reviewProfile}`)}
          </p>
        </div>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor={`${idBase}-tone`}
            className='text-caption text-foreground'
          >
            {t('tone')}
          </label>
          <Input
            id={`${idBase}-tone`}
            value={draft.toneInstructions}
            maxLength={TONE_INSTRUCTIONS_MAX_CHARS}
            disabled={disabled}
            className='text-caption'
            onChange={e =>
              setDraft(d => ({ ...d, toneInstructions: e.target.value }))
            }
          />
          <p className='text-caption text-muted-foreground'>{t('toneHint')}</p>
        </div>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor={`${idBase}-summary`}
            className='text-caption text-foreground'
          >
            {t('summary')}
          </label>
          <Select
            value={draft.highLevelSummary}
            disabled={disabled}
            onValueChange={v =>
              setDraft(d => ({
                ...d,
                highLevelSummary: v as HighLevelSummaryMode,
              }))
            }
          >
            <SelectTrigger id={`${idBase}-summary`} className='text-caption'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HIGH_LEVEL_SUMMARY_MODES.map(m => (
                <SelectItem key={m} value={m} className='text-caption'>
                  {t(`summary.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className='text-caption text-muted-foreground'>
            {t(`summaryHint.${draft.highLevelSummary}`)}
          </p>
        </div>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor={`${idBase}-diagrams`}
            className='flex items-center gap-2 self-start text-caption text-foreground'
          >
            <Switch
              id={`${idBase}-diagrams`}
              checked={draft.sequenceDiagrams}
              disabled={disabled}
              onCheckedChange={next =>
                setDraft(d => ({ ...d, sequenceDiagrams: next }))
              }
            />
            {t('sequenceDiagrams')}
          </label>
          <p className='text-caption text-muted-foreground'>
            {t('sequenceDiagramsHint')}
          </p>
        </div>
      </div>
      <div className='flex flex-col gap-2'>
        <p className='text-caption text-foreground'>{t('pathInstructions')}</p>
        <p className='text-caption text-muted-foreground'>
          {t('pathInstructionsHint')}
        </p>
        {draft.pathInstructions.map((row, i) => (
          <div
            key={i}
            className='flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2'
          >
            <Input
              aria-label={t('pathAria')}
              placeholder='scripts/**'
              value={row.path}
              maxLength={PATH_INSTRUCTION_PATH_MAX_CHARS}
              disabled={disabled}
              className='text-caption font-mono sm:w-48'
              onChange={e => setRow(i, { path: e.target.value })}
            />
            <Textarea
              aria-label={t('instructionsAria')}
              value={row.instructions}
              rows={2}
              maxLength={PATH_INSTRUCTION_MAX_CHARS}
              disabled={disabled}
              className='text-caption flex-1'
              onChange={e => setRow(i, { instructions: e.target.value })}
            />
            {canEdit && (
              <Button
                variant='ghost'
                size='sm'
                disabled={saving}
                aria-label={t('removeAria')}
                onClick={() =>
                  setDraft(d => ({
                    ...d,
                    pathInstructions: d.pathInstructions.filter(
                      (_, j) => j !== i
                    ),
                  }))
                }
              >
                {t('remove')}
              </Button>
            )}
          </div>
        ))}
        {canEdit && (
          <div>
            <Button
              variant='outline'
              size='sm'
              disabled={
                saving ||
                draft.pathInstructions.length >= PATH_INSTRUCTIONS_MAX_ENTRIES
              }
              onClick={() =>
                setDraft(d => ({
                  ...d,
                  pathInstructions: [
                    ...d.pathInstructions,
                    { path: '', instructions: '' },
                  ],
                }))
              }
            >
              {t('add')}
            </Button>
          </div>
        )}
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
