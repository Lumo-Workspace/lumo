'use client'

import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { tasksClient } from '@/lib/api-client'
// Imported from the concrete module (not the `@/lib/api-client` barrel) so the
// real class survives when a test mocks the barrel — instanceof stays meaningful.
import { ApiClientError } from '@/lib/api-client/base'
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
  /**
   * Whether the task has an acceptance contract (LUM-431). The human ritual
   * layer follows the data: with no criteria there is nothing to adjudicate,
   * so the bar stays hidden — which is also what self-neutralizes the
   * acceptance-mode toggle (a workspace with the toggle off never drafts
   * criteria, so this stays false). Independent of the workspace toggle.
   */
  hasCriteria: boolean
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
  hasCriteria,
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
  // The specific server-provided reason to show on failure; null = use the
  // generic retry copy (LUM-453).
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
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

  if (status !== 'IN_REVIEW' || !hasCriteria) return null

  const submit = async (verdict: HumanVerdict) => {
    setSubmitting(true)
    setFailed(false)
    setErrorMessage(null)
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
    } catch (err) {
      setFailed(true)
      // Surface the server's real reason when it's an HTTP 4xx carrying a
      // message (403 human-only, 404, 409 send-back gate, …) — the route
      // returns error.message for every non-500 status. Network failures,
      // unknown errors, and 5xx keep the generic retry copy: those may be
      // transient, so "try again" stays the honest message (LUM-453).
      setErrorMessage(
        err instanceof ApiClientError && err.status >= 400 && err.status < 500
          ? err.message
          : null
      )
    } finally {
      setSubmitting(false)
    }
  }

  const openPanel = (next: 'FAIL' | 'PASS_WITH_FOLLOWUP') => {
    setPanel(prev => (prev === next ? null : next))
    setNote('')
    setFailed(false)
    setErrorMessage(null)
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
          {errorMessage || intl.formatMessage({ id: 'task.verdict.error' })}
        </p>
      )}
    </div>
  )
}
