'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { FileText } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SectionAddButton } from './TaskDetailTimeline/SectionAddButton'

interface DocSearchHit {
  id: string
  slug: string
  title: string
  emoji: string | null
}

export interface LinkDocPopoverProps {
  onSearch: (query: string) => Promise<DocSearchHit[]>
  onAttach: (
    payload: { identifier: string } | { documentId: string }
  ) => Promise<void>
}

const URL_PATTERN = /\/documents\//
// Lumo Prisma cuid: leading 'c' + 24 alphanum. Matches isLikelyCuid in the codebase.
const CUID_PATTERN = /^c[a-z0-9]{24}$/i
const SLUG_PATTERN = /^[a-z0-9-]+-\d+$/i

function looksLikeIdentifier(input: string): boolean {
  const t = input.trim()
  return URL_PATTERN.test(t) || CUID_PATTERN.test(t) || SLUG_PATTERN.test(t)
}

export function LinkDocPopover({
  onSearch,
  onAttach,
}: LinkDocPopoverProps): React.ReactElement {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DocSearchHit[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setQuery('')
    setResults([])
    setError(null)
    setSubmitting(false)
  }

  // Debounced search for free-text queries. Identifier-shaped input (URL,
  // cuid, slug-N) skips the network round-trip; Enter will attach by
  // `identifier` directly.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q || looksLikeIdentifier(q)) {
      setResults([])
      return
    }
    const handle = setTimeout(async () => {
      try {
        const hits = await onSearch(q)
        setResults(hits)
      } catch {
        // Popover stays usable; just no results on this keystroke.
        setResults([])
      }
    }, 200)
    return () => clearTimeout(handle)
  }, [open, query, onSearch])

  const attachAndClose = async (
    payload: { identifier: string } | { documentId: string }
  ) => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onAttach(payload)
      reset()
      setOpen(false)
    } catch (err) {
      const e = err as { message?: string }
      setError(
        e?.message ??
          intl.formatMessage({ id: 'task.contextLink.common.errors.network' })
      )
    } finally {
      setSubmitting(false)
    }
  }

  const onEnter = () => {
    const t = query.trim()
    if (!t || submitting) return
    if (looksLikeIdentifier(t)) {
      void attachAndClose({ identifier: t })
    } else if (results[0]) {
      void attachAndClose({ documentId: results[0].id })
    }
  }

  const trimmed = query.trim()
  const showEmpty =
    !!trimmed && !looksLikeIdentifier(trimmed) && results.length === 0
  const label = intl.formatMessage({ id: 'task.documents.addButton' })

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <PopoverTrigger asChild>
        <SectionAddButton label={label} />
      </PopoverTrigger>
      <PopoverContent align='end' className='w-96 p-0'>
        <div className='p-2 border-b border-border'>
          <input
            type='text'
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onEnter()
              }
            }}
            disabled={submitting}
            placeholder={intl.formatMessage({
              id: 'task.contextLink.doc.placeholder',
            })}
            className='w-full text-body bg-transparent outline-none placeholder:text-muted-foreground text-foreground px-1 py-1 disabled:opacity-50'
            autoFocus
          />
        </div>
        <ul className='max-h-64 overflow-y-auto'>
          {results.map(r => (
            <li key={r.id}>
              <button
                type='button'
                onClick={() => attachAndClose({ documentId: r.id })}
                disabled={submitting}
                className='w-full flex items-center gap-2 px-3 py-2 text-left text-body hover:bg-muted transition-colors disabled:opacity-50'
              >
                {r.emoji ? (
                  <span className='shrink-0'>{r.emoji}</span>
                ) : (
                  <FileText
                    size={14}
                    className='shrink-0 text-muted-foreground'
                  />
                )}
                <span className='text-foreground truncate'>{r.title}</span>
              </button>
            </li>
          ))}
          {showEmpty && (
            <li className='px-3 py-2 text-caption text-muted-foreground text-center'>
              {intl.formatMessage({ id: 'task.contextLink.doc.searchEmpty' })}
            </li>
          )}
        </ul>
        {error && (
          <p role='alert' className='px-3 py-2 text-caption text-danger-text'>
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
