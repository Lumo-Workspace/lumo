'use client'

import { useId, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useIntl } from 'react-intl'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ApiClientError, feedbackClient } from '@/lib/api-client'
import {
  FEEDBACK_KINDS,
  MAX_FEEDBACK_EVIDENCE_FILES,
  MAX_FEEDBACK_TEXT_LEN,
  MAX_FEEDBACK_TITLE_LEN,
  type FeedbackKindValue,
} from '@/lib/validation/feedback'
import {
  FEEDBACK_SCREENSHOT_MAX_MB,
  FEEDBACK_SCREENSHOT_TYPES,
  checkScreenshots,
  toFeedbackInput,
  type ScreenshotProblem,
} from '@/lib/feedback/web-form'
import { isSubmitShortcut, submitModLabel } from '../../utils'

interface Props {
  onClose: () => void
}

const KIND_LABEL: Record<FeedbackKindValue, string> = {
  BUG: 'feedback.kind.bug',
  IDEA: 'feedback.kind.idea',
  QUESTION: 'feedback.kind.question',
}

/**
 * LUM-1287: report a bug, an idea or a question to the Lumo team from the
 * web app — the browser side of LUM-1240's `lumo feedback create`. Mounted
 * only while open, so every open starts from an empty form.
 */
export function FeedbackDialog({ onClose }: Props) {
  const intl = useIntl()
  const fieldId = useId()
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values)

  const [kind, setKind] = useState<FeedbackKindValue>('BUG')
  const [title, setTitle] = useState('')
  const [actual, setActual] = useState('')
  const [expected, setExpected] = useState('')
  const [details, setDetails] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [fileProblem, setFileProblem] = useState<ScreenshotProblem | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      feedbackClient.submit(
        toFeedbackInput({ kind, title, actual, expected, details }),
        files
      ),
    onSuccess: ({ ref, failedFiles }) => {
      if (failedFiles.length > 0)
        toast.warning(
          t('feedback.sent.partial', { ref, count: failedFiles.length })
        )
      else toast.success(t('feedback.sent', { ref }))
      onClose()
    },
  })

  const busy = mutation.isPending
  const canSubmit = !busy && title.trim().length > 0 && fileProblem === null

  const submit = () => {
    if (canSubmit) mutation.mutate()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isSubmitShortcut(e)) {
      e.preventDefault()
      submit()
    }
  }

  const handleFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    setFiles(picked)
    setFileProblem(checkScreenshots(picked))
  }

  const errorMessage = (() => {
    if (!mutation.isError) return null
    const err = mutation.error
    return t(
      err instanceof ApiClientError && err.status === 429
        ? 'feedback.error.rateLimited'
        : 'feedback.error.generic'
    )
  })()

  return (
    <Dialog open onOpenChange={open => !open && !busy && onClose()}>
      <DialogContent className='max-w-[560px]' onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('feedback.dialog.title')}</DialogTitle>
          <DialogDescription>
            {t('feedback.dialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-2'>
            <Label id={`${fieldId}-kind`}>{t('feedback.field.kind')}</Label>
            <ToggleGroup
              type='single'
              variant='chip'
              aria-labelledby={`${fieldId}-kind`}
              value={kind}
              // Radix reports '' when the pressed chip is clicked again; a
              // report always has a kind, so that click is ignored.
              onValueChange={(v: string) =>
                v && setKind(v as FeedbackKindValue)
              }
            >
              {FEEDBACK_KINDS.map(k => (
                <ToggleGroupItem key={k} value={k}>
                  {t(KIND_LABEL[k])}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className='flex flex-col gap-2'>
            <Label htmlFor={`${fieldId}-title`}>
              {t('feedback.field.title')}
            </Label>
            <Input
              id={`${fieldId}-title`}
              value={title}
              maxLength={MAX_FEEDBACK_TITLE_LEN}
              placeholder={t('feedback.field.title.placeholder')}
              onChange={e => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          {kind === 'BUG' ? (
            <>
              <div className='flex flex-col gap-2'>
                <Label htmlFor={`${fieldId}-actual`}>
                  {t('feedback.field.actual')}
                </Label>
                <Textarea
                  id={`${fieldId}-actual`}
                  value={actual}
                  rows={3}
                  maxLength={MAX_FEEDBACK_TEXT_LEN}
                  onChange={e => setActual(e.target.value)}
                />
              </div>
              <div className='flex flex-col gap-2'>
                <Label htmlFor={`${fieldId}-expected`}>
                  {t('feedback.field.expected')}
                </Label>
                <Textarea
                  id={`${fieldId}-expected`}
                  value={expected}
                  rows={2}
                  maxLength={MAX_FEEDBACK_TEXT_LEN}
                  onChange={e => setExpected(e.target.value)}
                />
              </div>
            </>
          ) : (
            <div className='flex flex-col gap-2'>
              <Label htmlFor={`${fieldId}-details`}>
                {t('feedback.field.details')}
              </Label>
              <Textarea
                id={`${fieldId}-details`}
                value={details}
                rows={4}
                maxLength={MAX_FEEDBACK_TEXT_LEN}
                onChange={e => setDetails(e.target.value)}
              />
            </div>
          )}

          <div className='flex flex-col gap-2'>
            <Label htmlFor={`${fieldId}-screenshots`}>
              {t('feedback.field.screenshots')}
            </Label>
            <Input
              id={`${fieldId}-screenshots`}
              type='file'
              className='text-muted-foreground'
              multiple
              accept={FEEDBACK_SCREENSHOT_TYPES.join(',')}
              onChange={handleFiles}
            />
            {fileProblem ? (
              <p role='alert' className='text-caption text-danger-text'>
                {screenshotProblemMessage(fileProblem, t)}
              </p>
            ) : (
              <span className='text-caption text-muted-foreground'>
                {t('feedback.field.screenshots.hint', {
                  max: MAX_FEEDBACK_EVIDENCE_FILES,
                  sizeMb: FEEDBACK_SCREENSHOT_MAX_MB,
                })}
              </span>
            )}
          </div>

          {errorMessage && (
            <p
              role='alert'
              aria-live='polite'
              className='text-body text-danger-text'
            >
              {errorMessage}
            </p>
          )}
        </div>

        <div className='mt-2 flex items-center justify-end gap-2'>
          <Button variant='ghost' onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy && <Spinner className='size-4' />}
            {t(busy ? 'common.sending' : 'feedback.action.send')}
            <Kbd variant='solid'>{submitModLabel}↵</Kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function screenshotProblemMessage(
  problem: ScreenshotProblem,
  t: (id: string, values?: Record<string, string | number>) => string
): string {
  switch (problem.code) {
    case 'tooMany':
      return t('feedback.error.tooManyFiles', { max: problem.max })
    case 'tooLarge':
      return t('feedback.error.fileTooLarge', {
        name: problem.name,
        sizeMb: problem.maxMb,
      })
    case 'type':
      return t('feedback.error.fileType', { name: problem.name })
  }
}
