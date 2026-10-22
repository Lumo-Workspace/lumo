'use client'

import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import { CodeBlock } from '../cli/CodeBlock'
import { AgentGlyph } from './MemberConnectionsCell'
import { useAgentLabel } from '../AgentBadge'
import { formatRelativeAgo } from '@/lib/datetime/relative'
import {
  CONNECT_COMMANDS,
  connectionFixCommand,
} from '@/lib/members/connection-status'
import type { MemberConnectionView } from '@/lib/services/member-connection.service'

type Tone = 'ok' | 'warn' | 'muted'

const TAG_TONE: Record<Tone, string> = {
  ok: 'border-success-border bg-success-subtle',
  warn: 'border-warning-border bg-warning-subtle',
  muted: 'border-border bg-muted',
}

function Tag({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2 text-caption text-foreground',
        TAG_TONE[tone]
      )}
    >
      {children}
    </span>
  )
}

function ConnectionCard({
  connection: c,
  now,
}: {
  connection: MemberConnectionView
  now: number | null
}) {
  const intl = useIntl()
  const label = useAgentLabel(c.agent)
  const fix = connectionFixCommand(c)
  const behind = intl.formatMessage({ id: 'members.connection.behind' })
  return (
    <div className='flex flex-col gap-3 rounded-lg border border-border bg-background p-4'>
      <div className='flex items-center gap-2'>
        <AgentGlyph agent={c.agent} size={20} />
        <span className='flex-1 text-body-strong text-foreground'>{label}</span>
        {now !== null && (
          <span className='text-caption text-muted-foreground'>
            {intl.formatMessage(
              { id: 'members.details.lastSeen' },
              { ago: formatRelativeAgo(intl, c.lastSeenAt, now) }
            )}
          </span>
        )}
      </div>
      <div className='flex flex-col gap-1.5 text-body'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-mono text-caption text-foreground'>
            {c.cliVersion
              ? intl.formatMessage(
                  { id: 'members.connection.cli' },
                  { version: c.cliVersion }
                )
              : intl.formatMessage({ id: 'members.connection.unknown' })}
          </span>
          {c.cliVersion === null ? null : c.stale ? (
            <Tag tone='muted'>
              {intl.formatMessage({ id: 'members.details.asOfLastSeen' })}
            </Tag>
          ) : c.cliBehind ? (
            <Tag tone='warn'>{behind}</Tag>
          ) : (
            <Tag tone='ok'>
              {intl.formatMessage({ id: 'members.details.latest' })}
            </Tag>
          )}
        </div>
      </div>
      {fix && (
        <div className='flex flex-col gap-1.5'>
          <span className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'members.details.fixHint' })}
          </span>
          <CodeBlock lines={[fix]} />
        </div>
      )}
    </div>
  )
}

/**
 * LUM-1136: the expanded row under a member — one card per agent connection
 * with the CLI version and the command that brings it up to date; a
 * setup hint when the member has none.
 */
export function MemberConnectionDetails({
  connections,
  now,
}: {
  connections: MemberConnectionView[] | undefined
  now: number | null
}) {
  const intl = useIntl()
  if (!connections || connections.length === 0)
    return (
      <div className='flex flex-col gap-2 rounded-lg border border-dashed border-border p-4 text-body text-muted-foreground'>
        <span>
          {intl.formatMessage({ id: 'members.details.notConnected' })}
        </span>
        <div className='max-w-md'>
          <CodeBlock lines={[...CONNECT_COMMANDS]} />
        </div>
      </div>
    )
  return (
    <div className='grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3'>
      {connections.map(c => (
        <ConnectionCard key={c.agent} connection={c} now={now} />
      ))}
    </div>
  )
}
