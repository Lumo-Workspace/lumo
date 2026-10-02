'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import type { DetailBlock, TimelineItem } from './merge-events'
import { SESSION_MESSAGES as M } from '../messages'

interface TimelineProps {
  items: TimelineItem[]
}

export function Timeline({ items }: TimelineProps) {
  const intl = useIntl()
  if (items.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>
        {intl.formatMessage(M['timeline.empty'])}
      </p>
    )
  }

  return (
    <ol className='divide-y divide-border rounded-md border'>
      {items.map(item => (
        <TimelineRow key={item.key} item={item} />
      ))}
    </ol>
  )
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const canExpand = item.details.length > 0
  const time = formatTime(item.startAt)
  const duration = item.endAt
    ? formatDuration(item.endAt.getTime() - item.startAt.getTime())
    : null

  const statusClass =
    item.kind === 'user-prompt'
      ? 'text-sky-600 font-medium'
      : item.status === 'error'
        ? 'text-red-600'
        : item.status === 'pending'
          ? 'text-amber-600'
          : 'text-emerald-600'

  const kindLabel =
    item.kind === 'stop'
      ? intl.formatMessage(M['timeline.kindStop'])
      : item.kind === 'user-prompt'
        ? intl.formatMessage(M['timeline.kindYou'])
        : (item.toolName ?? intl.formatMessage(M['timeline.kindTool']))

  return (
    <li>
      <button
        type='button'
        onClick={() => canExpand && setOpen(!open)}
        disabled={!canExpand}
        className='flex w-full items-start gap-3 px-3 py-2 text-left font-mono text-xs hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent'
      >
        <span className='w-5 shrink-0 text-muted-foreground'>
          {canExpand ? (open ? '▾' : '▸') : ' '}
        </span>
        <span className='w-20 shrink-0 text-muted-foreground'>{time}</span>
        <span className={`w-24 shrink-0 truncate ${statusClass}`}>
          {kindLabel}
        </span>
        <span className='min-w-0 flex-1 truncate text-foreground'>
          {item.summary}
        </span>
        {item.badge && (
          <span
            className={`shrink-0 rounded-sm px-1.5 text-[10px] ${
              item.status === 'error'
                ? 'bg-red-50 text-red-700'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {item.badge}
          </span>
        )}
        {duration && (
          <span className='w-14 shrink-0 text-right text-muted-foreground'>
            {duration}
          </span>
        )}
      </button>
      {open && canExpand && (
        <div className='space-y-2 border-t border-border bg-muted/20 px-3 py-3'>
          {item.details.map((block, i) => (
            <DetailBlockView key={`${item.key}:${i}`} block={block} />
          ))}
        </div>
      )}
    </li>
  )
}

function RedactedBlockView({
  label,
  lines,
  bytes,
}: {
  label: string
  lines: number
  bytes: number
}) {
  const intl = useIntl()
  return (
    <div className='text-xs'>
      <div className='mb-1 text-[10px] uppercase tracking-wide text-muted-foreground'>
        {label}
      </div>
      <p className='rounded-sm border border-dashed p-2 text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'sessionTimeline.contentNotRetained',
            defaultMessage:
              'Content not retained ({lines, plural, one {# line} other {# lines}}, {bytes, number} bytes). Lumo keeps paths and sizes, not your code.',
          },
          { lines, bytes }
        )}
      </p>
    </div>
  )
}

function DetailBlockView({ block }: { block: DetailBlock }) {
  const intl = useIntl()
  if (block.redacted) {
    return (
      <RedactedBlockView
        label={block.label}
        lines={block.redacted.lines}
        bytes={block.redacted.bytes}
      />
    )
  }
  const variantClass =
    block.variant === 'error'
      ? 'border-red-300 bg-red-50 text-red-900'
      : block.variant === 'diff'
        ? 'border-border bg-background'
        : 'border-border bg-background'

  return (
    <div className='text-xs'>
      <div className='mb-1 text-[10px] uppercase tracking-wide text-muted-foreground'>
        {block.label}
        {block.truncated && (
          <span className='ml-2 normal-case text-muted-foreground'>
            {intl.formatMessage(M['timeline.truncated'], {
              shown: block.truncated.shownLines,
              total: block.truncated.totalLines,
            })}
          </span>
        )}
      </div>
      <pre
        className={`overflow-x-auto whitespace-pre-wrap break-words rounded-sm border p-2 font-mono text-xs leading-relaxed ${variantClass}`}
      >
        {block.variant === 'diff' ? renderDiff(block.text) : block.text}
      </pre>
    </div>
  )
}

function renderDiff(text: string) {
  return text.split('\n').map((line, i) => {
    let cls = ''
    if (line.startsWith('@@')) cls = 'text-blue-600'
    else if (line.startsWith('+') && !line.startsWith('+++'))
      cls = 'text-emerald-700 bg-emerald-50'
    else if (line.startsWith('-') && !line.startsWith('---'))
      cls = 'text-red-700 bg-red-50'
    return (
      <span key={i} className={`block ${cls}`}>
        {line || ' '}
      </span>
    )
  })
}

function formatTime(d: Date): string {
  return d.toISOString().slice(11, 19)
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}
