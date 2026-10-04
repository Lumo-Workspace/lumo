'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useIdeaComments } from '../hooks/useIdeaComments'

/**
 * The Comments tab of the idea detail slide-over (LUM-680). Renders the flat
 * comment thread (oldest first) plus a composer. Comment bodies are stored and
 * shown as plain text (idea comments carry no @mention/HTML markup), so they're
 * rendered with `whitespace-pre-wrap` rather than dangerouslySetInnerHTML.
 * They are NOT sanitized on write (LUM-926), so switching to HTML rendering
 * must add write-time sanitization — `idea-comments-text-only.test.tsx` fails
 * until it does.
 *
 * Presentation + local composer state only (SRP); all data/mutations come from
 * `useIdeaComments`.
 */
export function IdeaCommentsSection({ ideaId }: { ideaId: string }) {
  const intl = useIntl()
  const { comments, loading, error, addComment, posting } =
    useIdeaComments(ideaId)
  const [draft, setDraft] = useState('')

  const trimmed = draft.trim()
  const canPost = !posting && trimmed.length > 0

  const handlePost = async () => {
    if (!canPost) return
    await addComment(trimmed)
    setDraft('')
  }

  return (
    <div className='flex flex-col gap-4'>
      {loading ? (
        <p className='text-xs text-muted-foreground'>
          {intl.formatMessage({ id: 'common.loading' })}
        </p>
      ) : error ? (
        <p className='text-xs text-danger-text'>{error}</p>
      ) : comments.length === 0 ? (
        <p className='text-xs text-muted-foreground'>
          {intl.formatMessage({ id: 'ideas.comments.empty' })}
        </p>
      ) : (
        <ul className='flex flex-col gap-3'>
          {comments.map(c => (
            <li key={c.id} className='flex flex-col gap-1'>
              <time className='text-[10px] uppercase tracking-wide text-muted-foreground'>
                {intl.formatDate(new Date(c.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
              <p className='whitespace-pre-wrap text-sm text-foreground/90'>
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className='flex flex-col gap-2'>
        <Textarea
          aria-label={intl.formatMessage({
            id: 'ideas.comments.composerLabel',
          })}
          placeholder={intl.formatMessage({
            id: 'ideas.comments.composerPlaceholder',
          })}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          maxLength={5000}
        />
        <Button
          size='sm'
          className='self-start'
          onClick={handlePost}
          disabled={!canPost}
        >
          {intl.formatMessage({ id: 'ideas.comments.post' })}
        </Button>
      </div>
    </div>
  )
}
