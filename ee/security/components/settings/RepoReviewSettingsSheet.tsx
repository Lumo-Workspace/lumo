'use client'

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useIntl } from 'react-intl'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type {
  RepoReviewSettingView,
  RepoReviewSettingsUpdate,
} from '@/ee/security/services/repo-review-settings.service'
import { RepoReviewTriggersSection } from './RepoReviewTriggersSection'
import { RepoPreMergeChecksSection } from './RepoPreMergeChecksSection'
import { RepoReviewStyleSection } from './RepoReviewStyleSection'
import {
  changedCount,
  draftOfRepo,
  draftProblems,
  repoReviewUpdate,
  type RepoReviewDraft,
} from './repo-review-draft'

const SECTIONS = ['when', 'checks', 'style'] as const
type Section = (typeof SECTIONS)[number]

interface RepoReviewSettingsSheetProps {
  /** The repository being edited; null = closed. */
  setting: RepoReviewSettingView | null
  canEdit: boolean
  saving: boolean
  onClose: () => void
  /** Resolves to the saved setting, or null when the save failed. */
  onSave: (
    update: RepoReviewSettingsUpdate
  ) => Promise<RepoReviewSettingView | null>
}

interface SheetBodyProps extends Omit<RepoReviewSettingsSheetProps, 'setting'> {
  setting: RepoReviewSettingView
  /** Where the sheet's close (×, Escape, outside click) asks this body. */
  closeRequest: MutableRefObject<() => void>
}

/** One draft for the whole repository, saved with one PATCH. */
function SheetBody({
  setting,
  canEdit,
  saving,
  onClose,
  onSave,
  closeRequest,
}: SheetBodyProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, number>) =>
    intl.formatMessage(
      { id: `workspaceSettings.repoReview.sheet.${id}` },
      values
    )
  // The values the draft started from. A refetch while the sheet is open
  // (window focus) never resets the draft; only this sheet's own save moves
  // the baseline, so a PATCH carries just what this owner changed.
  const [baseline, setBaseline] = useState(setting)
  const [draft, setDraft] = useState<RepoReviewDraft>(() =>
    draftOfRepo(setting)
  )
  const [section, setSection] = useState<Section>('when')
  const [confirmClose, setConfirmClose] = useState(false)
  const update = repoReviewUpdate(baseline, draft)
  const problems = draftProblems(draft)
  const blocked = problems.length > 0
  // A half-filled row is unsaved work even though the PATCH would drop it.
  const changes =
    changedCount(update) + (problems.includes('incompleteRows') ? 1 : 0)
  const disabled = !canEdit || saving
  const idBase = `repo-review-${setting.repo.replace(/[^\w-]/g, '-')}`

  // Every way out of the sheet asks first while changes are unsaved.
  useEffect(() => {
    closeRequest.current = () =>
      changes > 0 ? setConfirmClose(true) : onClose()
  }, [closeRequest, changes, onClose])

  const save = async () => {
    if (!update || blocked) return
    const saved = await onSave(update)
    if (!saved) return
    setBaseline(saved)
    setDraft(draftOfRepo(saved))
  }

  return (
    <SheetContent
      side='right'
      className='flex w-full flex-col gap-0 p-0 sm:max-w-2xl'
    >
      <SheetHeader className='border-b border-border px-6 py-5 text-left'>
        <SheetTitle className='break-all font-mono'>{setting.repo}</SheetTitle>
        <SheetDescription>{t('description')}</SheetDescription>
        {!canEdit && (
          <p className='text-caption text-muted-foreground'>
            {intl.formatMessage({
              id: 'workspaceSettings.repoReview.ownerOnly',
            })}
          </p>
        )}
      </SheetHeader>

      <Tabs
        value={section}
        onValueChange={v => setSection(v as Section)}
        className='flex min-h-0 flex-1 flex-col'
      >
        <div className='border-b border-border px-6 py-3'>
          <TabsList>
            {SECTIONS.map(s => (
              <TabsTrigger key={s} value={s}>
                {t(`tab.${s}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto px-6 py-6'>
          <TabsContent value='when' className='mt-0'>
            <RepoReviewTriggersSection
              idBase={`${idBase}-when`}
              emptyBaseBranchesMeans={baseline.emptyBaseBranchesMeans}
              draft={draft.filters}
              disabled={disabled}
              onChange={filters => setDraft(d => ({ ...d, filters }))}
            />
          </TabsContent>
          <TabsContent value='checks' className='mt-0'>
            <RepoPreMergeChecksSection
              idBase={`${idBase}-checks`}
              draft={draft.checks}
              disabled={disabled}
              onChange={checks => setDraft(d => ({ ...d, checks }))}
            />
          </TabsContent>
          <TabsContent value='style' className='mt-0'>
            <RepoReviewStyleSection
              idBase={`${idBase}-style`}
              draft={draft.style}
              disabled={disabled}
              onChange={style => setDraft(d => ({ ...d, style }))}
            />
          </TabsContent>
        </div>
      </Tabs>

      <div className='flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-3'>
        <p
          className={
            problems.includes('incompleteRows')
              ? 'text-caption text-danger-text'
              : 'text-caption text-muted-foreground'
          }
          aria-live='polite'
        >
          {canEdit &&
            (problems.includes('incompleteRows')
              ? t('incompleteRows')
              : changes > 0
                ? t('unsaved', { count: changes })
                : t('noChanges'))}
        </p>
        {canEdit ? (
          <div className='flex gap-2'>
            <Button
              variant='ghost'
              disabled={saving || changes === 0}
              onClick={() => setDraft(draftOfRepo(baseline))}
            >
              {t('discard')}
            </Button>
            <Button
              disabled={saving || changes === 0 || blocked}
              onClick={save}
            >
              {t('save')}
            </Button>
          </div>
        ) : (
          <Button variant='outline' onClick={onClose}>
            {t('close')}
          </Button>
        )}
      </div>
      <p className='px-6 pb-3 text-caption text-muted-foreground'>
        {t('precedence')}
      </p>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('leaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('leaveDescription', { count: changes })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('keepEditing')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                setConfirmClose(false)
                onClose()
              }}
            >
              {t('discardAndClose')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SheetContent>
  )
}

/**
 * LUM-1331 — one repository's automatic review settings in a side sheet:
 * When to review, Pre-merge checks and Review style as tabs over one draft,
 * a single Save for all of them, and a warning before unsaved changes are
 * dropped. Read-only for members who are not OWNERs.
 */
export function RepoReviewSettingsSheet({
  setting,
  ...rest
}: RepoReviewSettingsSheetProps) {
  const closeRequest = useRef<() => void>(rest.onClose)
  return (
    <Sheet
      open={setting !== null}
      onOpenChange={open => {
        if (!open) closeRequest.current()
      }}
    >
      {setting && (
        <SheetBody
          // One body per repository; it keeps its draft across refetches.
          key={setting.repo}
          setting={setting}
          closeRequest={closeRequest}
          {...rest}
        />
      )}
    </Sheet>
  )
}
