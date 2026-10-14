'use client'

import { useIntl, type IntlShape } from 'react-intl'
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

function BehindMark({ hint }: { hint: string }) {
  const intl = useIntl()
  return (
    <span className='text-warning-text' title={hint}>
      {' '}
      ({intl.formatMessage({ id: 'members.connection.behind' })})
    </span>
  )
}

function ConnectionLine({
  connection: c,
  now,
}: {
  connection: MemberConnectionView
  now: number | null
}) {
  const intl = useIntl()
  const label = useAgentLabel(c.agent)
  const { Icon, color } = AGENT_META[c.agent] ?? AGENT_META.CLAUDE_CODE
  const skill = skillVersionLabel(intl, c.skillVersion)
  return (
    <div className='flex items-start gap-2 text-xs leading-5 min-w-0'>
      <span
        className='mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full'
        style={{ backgroundColor: `${color}1A`, color }}
        aria-hidden
      >
        <Icon size={10} />
      </span>
      <div className='min-w-0'>
        <span className='font-medium text-foreground'>{label}</span>
        {now !== null && (
          <span className='text-muted-foreground'>
            {' · '}
            {formatRelativeAgo(intl, c.lastSeenAt, now)}
          </span>
        )}
        <div className='text-muted-foreground break-words'>
          {c.cliVersion ? (
            <>
              {intl.formatMessage(
                { id: 'members.connection.cli' },
                { version: c.cliVersion }
              )}
              {c.cliBehind && (
                <BehindMark
                  hint={intl.formatMessage({
                    id: 'members.connection.cliBehindHint',
                  })}
                />
              )}
            </>
          ) : (
            intl.formatMessage({ id: 'members.connection.unknown' })
          )}
          {skill && (
            <>
              {' · '}
              {skill}
              {c.skillBehind && (
                <BehindMark
                  hint={intl.formatMessage({
                    id: 'members.connection.skillBehindHint',
                  })}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * LUM-1136: the members table's Connection cell — one line per coding agent
 * the member used in the last 30 days, with the CLI / skill versions reported.
 */
export function MemberConnectionsCell({
  connections,
  loading,
  now,
}: {
  connections: MemberConnectionView[] | undefined
  loading: boolean
  now: number | null
}) {
  const intl = useIntl()
  if (loading) return <span className='text-xs text-muted-foreground'>—</span>
  if (!connections || connections.length === 0)
    return (
      <span className='text-xs text-muted-foreground'>
        {intl.formatMessage({ id: 'members.connection.none' })}
      </span>
    )
  return (
    <div className='flex flex-col gap-1 min-w-0'>
      {connections.map(c => (
        <ConnectionLine key={c.agent} connection={c} now={now} />
      ))}
    </div>
  )
}
