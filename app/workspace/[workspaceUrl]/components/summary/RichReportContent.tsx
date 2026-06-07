'use client'

import { useMemo, type ReactNode } from 'react'
import { ActorMention } from '../TaskDetailTimeline/ActorMention'
import { PriorityBadge } from '../PriorityBadge'
import type { WorkspaceMemberInfo } from '../../types'
import type { ApiPriority } from '../../types'
import type { AgentActor } from '../../hooks/useMembers'

interface RichReportContentProps {
  markdown: string
  members: WorkspaceMemberInfo[]
  agentActors?: AgentActor[]
  className?: string
}

const PRIORITY_KEYWORDS: Record<string, ApiPriority> = {
  URGENT: 'URGENT',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
}

/**
 * Build a regex that matches any known member name (longest first to avoid
 * partial matches like "Li" inside "Li Wei").
 */
function buildNamePattern(
  members: WorkspaceMemberInfo[],
  agentActors: AgentActor[]
): RegExp | null {
  const names = [...members.map(m => m.name), ...agentActors.map(a => a.name)]
    .filter(n => n.length > 1)
    .sort((a, b) => b.length - a.length) // longest first

  if (names.length === 0) return null
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`(${escaped.join('|')})`, 'g')
}

const PRIORITY_RE = /\b(URGENT|HIGH|MEDIUM|LOW)\b/g

/**
 * Enrich a plain text segment: replace member names with ActorMention
 * and priority keywords with PriorityBadge.
 */
function enrichText(
  text: string,
  members: WorkspaceMemberInfo[],
  agentActors: AgentActor[],
  namePattern: RegExp | null
): ReactNode[] {
  // First pass: split by priority keywords
  const segments = splitByPattern(text, PRIORITY_RE, (match, i) => {
    const priority = PRIORITY_KEYWORDS[match]
    if (!priority) return match
    return <PriorityBadge key={`p-${i}`} priority={priority} variant='icon' />
  })

  if (!namePattern) return segments

  // Second pass: split text segments by member names
  const result: ReactNode[] = []
  for (const seg of segments) {
    if (typeof seg !== 'string') {
      result.push(seg)
      continue
    }
    const parts = splitByPattern(seg, namePattern, (match, i) => {
      const member = members.find(m => m.name === match)
      if (member) {
        return (
          <ActorMention
            key={`m-${i}-${member.id}`}
            name={member.name}
            imageUrl={member.imageUrl ?? undefined}
            email={member.email}
            role={member.role}
          />
        )
      }
      const agent = agentActors.find(a => a.name === match)
      if (agent) {
        return <ActorMention key={`a-${i}`} name={agent.name} isAgent />
      }
      return match
    })
    result.push(...parts)
  }
  return result
}

/**
 * Split a string by a regex pattern, calling replacer for each match.
 * Returns an array of strings and ReactNodes.
 */
function splitByPattern(
  text: string,
  pattern: RegExp,
  replacer: (match: string, index: number) => ReactNode
): ReactNode[] {
  const result: ReactNode[] = []
  let lastIndex = 0
  let matchIndex = 0

  // Reset regex state
  const re = new RegExp(pattern.source, pattern.flags)
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index))
    }
    result.push(replacer(match[0], matchIndex++))
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }

  return result
}

/**
 * Parse a markdown line into a rendered React element with rich content.
 */
function renderLine(
  line: string,
  index: number,
  members: WorkspaceMemberInfo[],
  agentActors: AgentActor[],
  namePattern: RegExp | null
): ReactNode | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const enrich = (text: string) =>
    enrichText(text, members, agentActors, namePattern)

  // Heading ##
  if (trimmed.startsWith('## ')) {
    return (
      <h3
        key={index}
        className='text-sm font-semibold text-zinc-800 dark:text-zinc-200 mt-3 first:mt-0'
      >
        {enrich(trimmed.slice(3))}
      </h3>
    )
  }

  // Bullet list item
  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    return (
      <li
        key={index}
        className='flex gap-2 text-sm text-zinc-700 dark:text-zinc-300'
      >
        <span className='text-zinc-400 shrink-0'>•</span>
        <span>{enrich(trimmed.slice(2))}</span>
      </li>
    )
  }

  // Numbered list
  const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)/)
  if (numberedMatch) {
    return (
      <li
        key={index}
        className='flex gap-2 text-sm text-zinc-700 dark:text-zinc-300'
      >
        <span className='text-zinc-400 shrink-0'>{numberedMatch[1]}.</span>
        <span>{enrich(numberedMatch[2] ?? '')}</span>
      </li>
    )
  }

  // Plain paragraph
  return (
    <p key={index} className='text-sm text-zinc-700 dark:text-zinc-300'>
      {enrich(trimmed)}
    </p>
  )
}

export function RichReportContent({
  markdown,
  members,
  agentActors = [],
  className,
}: RichReportContentProps) {
  const namePattern = useMemo(
    () => buildNamePattern(members, agentActors),
    [members, agentActors]
  )

  const lines = markdown.split('\n')

  return (
    <div className={className ?? 'space-y-1.5'}>
      {lines.map((line, i) =>
        renderLine(line, i, members, agentActors, namePattern)
      )}
    </div>
  )
}
