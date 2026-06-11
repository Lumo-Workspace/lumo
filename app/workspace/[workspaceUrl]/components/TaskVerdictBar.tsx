'use client'

import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { tasksClient } from '@/lib/api-client'
import { CommentEditor } from './comments/CommentEditor'
import type { MentionSources } from '@/types/mention'

type HumanVerdict = 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'

export interface HumanVerdictResult {
  taskStatus: string
  verdict: HumanVerdict
  followUpTask: { id: string; number: number; title: string } | null
}

interface TaskVerdictBarProps {
  taskId: string
  /** Current task status — the bar only renders for IN_REVIEW. */
  status: string
  onVerdictRecorded: (result: HumanVerdictResult) => void
  /** Mention sources for the FAIL send-back editor (reuses the comment editor). */
  mentionSources?: MentionSources
}

/** Strip tags + whitespace to test whether a rich-text note has real content. */
function hasContent(html: string): boolean {
  return html.replace(/<[^>]+>/g, '').trim().length > 0
}

/**
 * Three-state human adjudication bar (LUM-421 + LUM-422). Renders only while
 * the task is IN_REVIEW — the human-initiated entry point to the human-verdict
 * write path (milestone rule 5: agents/CLI can never reach it).
 *
 * LUM-422 ① de-enumeration: a send-back carries ZERO structured burden — there
 * is no rejection-reason selector. FAIL opens the comment editor (markdown,
 * @mentions, images for free); the note is posted as a task comment server-side
 * and the FAIL verdict carries no enum (a downstream agent classifies it).
 * PASS_WITH_FOLLOWUP keeps a plain textarea for the outstanding items that seed
 * the follow-up task.
 *
 * LUM-422 ③ deep link: a `?verdict=pass|pass_with_followup` query param (set by
 * `lumo verdict --pass`) focuses the matching action so the human lands one
 * click from recording the verdict — the CLI never writes it.
 */
export function TaskVerdictBar({
  taskId,
  status,
  onVerdictRecorded,
  mentionSources,
}: TaskVerdictBarProps) {
  const intl = useIntl()
  const searchParams = useSearchParams()
  const deepLinkVerdict = searchParams?.get('verdict') ?? null
  const [panel, setPanel] = useState<'FAIL' | 'PASS_WITH_FOLLOWUP' | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)
  const passButtonRef = useRef<HTMLButtonElement>(null)
  const editorClearRef = useRef<(() => void) | null>(null)

  // Deep-link focus: carry the human to the one click that records the verdict.
  useEffect(() => {
    if (status !== 'IN_REVIEW') return
    if (deepLinkVerdict === 'pass_with_followup') {
      setPanel('PASS_WITH_FOLLOWUP')
      setNote('')
    } else if (deepLinkVerdict === 'pass') {
      passButtonRef.current?.focus()
    }
  }, [deepLinkVerdict, status])

  if (status !== 'IN_REVIEW') return null

  const submit = async (verdict: HumanVerdict) => {
    setSubmitting(true)
    setFailed(false)
    try {
      const sendNote = verdict !== 'PASS' && hasContent(note) ? note : undefined
      const result = await tasksClient.submitHumanVerdict<HumanVerdictResult>(
        taskId,
        {
          verdict,
          ...(sendNote ? { note: sendNote } : {}),
        }
      )
      onVerdictRecorded(result)
    } catch {
      setFailed(true)
    } finally {
      setSubmitting(false)
    }
  }

  const openPanel = (next: 'FAIL' | 'PASS_WITH_FOLLOWUP') => {
    setPanel(prev => (prev === next ? null : next))
    setNote('')
    setFailed(false)
  }

  return (
    <div
      data-testid='task-verdict-bar'
      className='mb-6 rounded-md border border-border px-4 py-3'
    >
      <div className='flex flex-wrap items-center gap-3'>
        <div className='flex-1 min-w-48'>
          <p className='text-body font-semibold text-foreground'>
            {intl.formatMessage({ id: 'task.verdict.title' })}
          </p>
          <p className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'task.verdict.hint' })}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button
            ref={passButtonRef}
            size='sm'
            data-testid='verdict-pass'
            disabled={submitting}
            onClick={() => submit('PASS')}
          >
            {intl.formatMessage({ id: 'task.verdict.pass' })}
          </Button>
          <Button
            size='sm'
            variant='outline'
            data-testid='verdict-followup'
            disabled={submitting}
            onClick={() => openPanel('PASS_WITH_FOLLOWUP')}
          >
            {intl.formatMessage({ id: 'task.verdict.passWithFollowUp' })}
          </Button>
          <Button
            size='sm'
            variant='outline'
            data-testid='verdict-fail'
            disabled={submitting}
            onClick={() => openPanel('FAIL')}
          >
            {intl.formatMessage({ id: 'task.verdict.fail' })}
          </Button>
        </div>
      </div>

      {panel !== null && (
        <div className='mt-3 space-y-2 border-t border-border pt-3'>
          <label className='block text-caption font-medium text-muted-foreground'>
            {intl.formatMessage({
              id:
                panel === 'FAIL'
                  ? 'task.verdict.noteLabel'
                  : 'task.verdict.followUpNoteLabel',
            })}
          </label>
          {panel === 'FAIL' ? (
            <div
              data-testid='verdict-note'
              className='rounded-md border border-input bg-background'
            >
              <CommentEditor
                onCommit={html => setNote(html ?? '')}
                onSubmit={() => submit('FAIL')}
                clearRef={editorClearRef}
                placeholderId='task.verdict.notePlaceholder'
                {...(mentionSources ? { mentionSources } : {})}
              />
            </div>
          ) : (
            <Textarea
              data-testid='verdict-note'
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={intl.formatMessage({
                id: 'task.verdict.followUpNotePlaceholder',
              })}
              rows={2}
            />
          )}
          <div className='flex items-center gap-2'>
            <Button
              size='sm'
              variant={panel === 'FAIL' ? 'destructive' : 'default'}
              data-testid='verdict-confirm'
              disabled={submitting}
              onClick={() => submit(panel)}
            >
              {intl.formatMessage({ id: 'task.verdict.confirm' })}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              disabled={submitting}
              onClick={() => setPanel(null)}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
          </div>
        </div>
      )}

      {failed && (
        <p
          data-testid='verdict-error'
          className='mt-2 text-caption text-danger'
        >
          {intl.formatMessage({ id: 'task.verdict.error' })}
        </p>
      )}
    </div>
  )
}
