'use client'

import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { StatusIcon } from './StatusIcon'
import { PrBadge } from './PrBadge'
import { useMentionStatus } from '@/lib/editor/mention-status-context'
import { renderMentionText } from '@/lib/editor/nodes/mention-with-type'

const ENTITY_TYPES = new Set(['task', 'sprint', 'project', 'milestone'])

/**
 * Read-only node view for mention chips (LUM-411). Renders the same chip the
 * pure renderHTML produces, then — for a task mention whose live status is in
 * context — appends a live status badge (and a PR badge when the task has an
 * open/merged PR). With no live data it degrades to the plain chip, so an
 * unknown / not-visible / failed-lookup mention never breaks rendering.
 *
 * The badge is driven by the CURRENT status from the batched lookup, not the
 * `mentionStatus` snapshot frozen into the node at insertion time.
 */
export function MentionChip({ node }: ReactNodeViewProps) {
  const attrs = node.attrs
  const type = String(attrs.mentionType ?? 'user')
  const identifier = String(attrs.label ?? attrs.id ?? '')
  // Called unconditionally (hook rules); only tasks have a live status.
  const live = useMentionStatus(type === 'task' ? identifier : null)
  const text = renderMentionText(attrs)

  if (!ENTITY_TYPES.has(type)) {
    return (
      <NodeViewWrapper as='span' className='mention mention-user'>
        {text}
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      as='a'
      className={`mention mention-${type}`}
      data-mention-type={type}
      {...(attrs.mentionHref
        ? { href: attrs.mentionHref, 'data-href': attrs.mentionHref }
        : {})}
      {...(attrs.mentionStatus
        ? { 'data-mention-status': attrs.mentionStatus }
        : {})}
    >
      {text}
      {live ? (
        <span
          className='ml-1 inline-flex items-center gap-0.5 align-middle'
          contentEditable={false}
        >
          <span
            data-live-status={live.status}
            className='inline-flex items-center align-middle'
          >
            <StatusIcon status={live.status} size={12} />
          </span>
          {live.pr !== 'none' ? <PrBadge state={live.pr} /> : null}
        </span>
      ) : null}
    </NodeViewWrapper>
  )
}
