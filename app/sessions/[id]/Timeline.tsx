'use client'

import { useState } from 'react'
import { useIntl, type IntlShape, type MessageDescriptor } from 'react-intl'
import type {
  BadgeMsg,
  BlockLabelKey,
  DetailBlock,
  SummaryMsg,
  TimelineItem,
} from './merge-events'
import { SESSION_MESSAGES as M } from '../messages'

interface TimelineProps {
  items: TimelineItem[]
}

const BLOCK_LABELS = {
  prompt: M['timeline.block.prompt'],
  rawWithContext: M['timeline.block.rawWithContext'],
  lastMessage: M['timeline.block.lastMessage'],
  command: M['timeline.block.command'],
  stdout: M['timeline.block.stdout'],
  stderr: M['timeline.block.stderr'],
  status: M['timeline.block.status'],
  content: M['timeline.block.content'],
  diff: M['timeline.block.diff'],
  old: M['timeline.block.old'],
  new: M['timeline.block.new'],
  matches: M['timeline.block.matches'],
  response: M['timeline.block.response'],
  files: M['timeline.block.files'],
  todos: M['timeline.block.todos'],
  input: M['timeline.block.input'],
} satisfies Record<BlockLabelKey, MessageDescriptor>

function summaryText(intl: IntlShape, msg: SummaryMsg): string {
  switch (msg.kind) {
    case 'emptyPrompt':
      return intl.formatMessage(M['timeline.summary.emptyPrompt'])
    case 'modelStopped':
      return intl.formatMessage(M['timeline.summary.modelStopped'])
    case 'noInput':
      return intl.formatMessage(M['timeline.summary.noInput'])
    case 'noPath':
      return intl.formatMessage(M['timeline.summary.noPath'])
    case 'todos':
      return intl.formatMessage(M['timeline.summary.todos'], {
        count: msg.count,
      })
    case 'grepIn':
      return intl.formatMessage(M['timeline.summary.grepIn'], {
        pattern: msg.pattern,
        path: msg.path,
      })
  }
}

function badgeText(intl: IntlShape, badge: BadgeMsg): string {
  switch (badge.kind) {
    case 'raw':
      return badge.text
    case 'interrupted':
      return intl.formatMessage(M['timeline.badge.interrupted'])
    case 'stderr':
      return intl.formatMessage(M['timeline.badge.stderr'])
    case 'noMatch':
      return intl.formatMessage(M['timeline.badge.noMatch'])
    case 'lines':
      return intl.formatMessage(M['timeline.badge.lines'], {
        count: badge.count,
      })
    case 'linesWithType':
      return intl.formatMessage(M['timeline.badge.linesWithType'], {
        type: badge.type,
        count: badge.count,
      })
    case 'files':
      return intl.formatMessage(M['timeline.badge.files'], {
        count: badge.count,
      })
    case 'matches':
      return intl.formatMessage(M['timeline.badge.matches'], {
        count: badge.count,
      })
  }
}

export function Timeline({ items }: TimelineProps) {
  const intl = useIntl()
  if (items.length === 0) {
    return (
      <p className='text-body text-muted-foreground'>
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
      ? 'text-info-text font-semibold'
      : item.status === 'error'
        ? 'text-danger-text'
        : item.status === 'pending'
          ? 'text-warning-text'
          : 'text-success-text'

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
        className='flex w-full items-start gap-3 px-3 py-2 text-left font-mono text-caption hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent'
      >
        <span className='w-5 shrink-0 text-muted-foreground'>
          {canExpand ? (open ? '▾' : '▸') : ' '}
        </span>
        <span className='w-20 shrink-0 text-muted-foreground'>{time}</span>
        <span className={`w-24 shrink-0 truncate ${statusClass}`}>
          {kindLabel}
        </span>
        <span className='min-w-0 flex-1 truncate text-foreground'>
          {item.pruned
            ? intl.formatMessage(
                M[item.deleted ? 'timeline.deleted' : 'timeline.pruned']
              )
            : item.summaryMsg
              ? summaryText(intl, item.summaryMsg)
              : item.summary}
        </span>
        {item.badge && (
          <span
            className={`shrink-0 rounded-sm px-1.5 text-caption ${
              item.status === 'error'
                ? 'bg-danger-subtle text-danger-text'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {badgeText(intl, item.badge)}
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
    <div className='text-caption'>
      <div className='mb-1 text-caption uppercase text-muted-foreground'>
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
        label={intl.formatMessage(BLOCK_LABELS[block.labelKey])}
        lines={block.redacted.lines}
        bytes={block.redacted.bytes}
      />
    )
  }
  const variantClass =
    block.variant === 'error'
      ? 'border-danger-border bg-danger-subtle text-danger-text'
      : block.variant === 'diff'
        ? 'border-border bg-background'
        : 'border-border bg-background'

  return (
    <div className='text-caption'>
      <div className='mb-1 text-caption uppercase text-muted-foreground'>
        {intl.formatMessage(BLOCK_LABELS[block.labelKey])}
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
        className={`overflow-x-auto whitespace-pre-wrap break-words rounded-sm border p-2 font-mono text-caption ${variantClass}`}
      >
        {block.textKey
          ? intl.formatMessage(M['timeline.badge.interrupted'])
          : block.variant === 'diff'
            ? renderDiff(block.text)
            : block.text}
      </pre>
    </div>
  )
}

function renderDiff(text: string) {
  return text.split('\n').map((line, i) => {
    let cls = ''
    if (line.startsWith('@@')) cls = 'text-info-text'
    else if (line.startsWith('+') && !line.startsWith('+++'))
      cls = 'text-success-text bg-success-subtle'
    else if (line.startsWith('-') && !line.startsWith('---'))
      cls = 'text-danger-text bg-danger-subtle'
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
