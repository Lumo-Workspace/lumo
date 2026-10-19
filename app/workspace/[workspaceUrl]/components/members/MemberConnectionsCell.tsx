'use client'

import { useIntl, type IntlShape } from 'react-intl'
import type { TaskArtifactAgent } from '@prisma/client'
import { AGENT_META, useAgentLabel } from '../AgentBadge'
import { formatRelativeAgo } from '@/lib/datetime/relative'
import type { MemberConnectionView } from '@/lib/services/member-connection.service'

/** Localized label for a reported skill version (see SKILL_VERSION_RE). */
export function skillVersionLabel(
  intl: IntlShape,
  skill: string | null
): string | null {
  if (!skill) return null
  if (skill === 'none')
    return intl.formatMessage({ id: 'members.connection.skillNone' })
  if (skill === 'source')
    return intl.formatMessage({ id: 'members.connection.skillSource' })
  if (skill === 'modified')
    return intl.formatMessage({ id: 'members.connection.skillModifiedUnknown' })
  if (skill.endsWith(' modified'))
    return intl.formatMessage(
      { id: 'members.connection.skillModified' },
      { version: skill.slice(0, -' modified'.length) }
    )
  return intl.formatMessage(
    { id: 'members.connection.skill' },
    { version: skill }
  )
}

/** Tinted brand glyph for a coding agent. */
export function AgentGlyph({
  agent,
  size = 16,
}: {
  agent: TaskArtifactAgent
  size?: number
}) {
  const { Icon, color } = AGENT_META[agent] ?? AGENT_META.CLAUDE_CODE
  return (
    <span
      className='inline-flex shrink-0 items-center justify-center rounded-full'
      style={{
        backgroundColor: `${color}1A`,
        color,
        width: size,
        height: size,
      }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.625)} />
    </span>
  )
}

function AgentChip({
  connection: c,
  now,
}: {
  connection: MemberConnectionView
  now: number | null
}) {
  const intl = useIntl()
  const label = useAgentLabel(c.agent)
  return (
    <span className='inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background pl-1 pr-2.5 text-caption'>
      <AgentGlyph agent={c.agent} size={20} />
      <span className='text-foreground'>{label}</span>
      {now !== null && (
        <span className='text-muted-foreground'>
          {formatRelativeAgo(intl, c.lastSeenAt, now)}
        </span>
      )}
    </span>
  )
}

/**
 * LUM-1136: the members table's Agents cell — one chip per coding agent the
 * member used in the last 30 days. Versions live in the status column and
 * the expandable details.
 */
export function MemberConnectionsCell({
  connections,
  unknown,
  now,
}: {
  connections: MemberConnectionView[] | undefined
  /** Still loading, or the request failed: show a dash, not "Not connected". */
  unknown: boolean
  now: number | null
}) {
  const intl = useIntl()
  if (unknown) return <span className='text-body text-muted-foreground'>—</span>
  if (!connections || connections.length === 0)
    return (
      <span className='text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'members.connection.none' })}
      </span>
    )
  return (
    <div className='flex flex-wrap gap-1.5 min-w-0'>
      {connections.map(c => (
        <AgentChip key={c.agent} connection={c} now={now} />
      ))}
    </div>
  )
}
