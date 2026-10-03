'use client'

import type { TimelineEntry, WorkspaceMemberInfo } from '../../types'
import { CompactActivityItem } from './items/CompactActivityItem'
import { CommentTimelineItem } from './items/CommentTimelineItem'
import { AgentRunItem } from './items/AgentRunItem'
import { PrItem } from './items/PrItem'

interface TimelineEntryRendererProps {
  entry: TimelineEntry
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
}

const AGENT_TYPES = new Set([
  'AGENT_RUN_STARTED',
  'AGENT_RUN_COMPLETED',
  'AGENT_RUN_FAILED',
  'AGENT_INPUT_REQUIRED',
])
const PR_TYPES = new Set([
  'PR_CREATED',
  'PR_MERGED',
  'PR_LINKED',
  'PR_UNLINKED',
])
/**
 * LUM-942: activity types of the removed acceptance-criteria / verification
 * feature. The enum values stay in Postgres and old rows still exist, but
 * nothing writes them any more and the timeline renders none of them.
 */
export const RETIRED_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'CRITERION_CHANGED',
  'CONTRACT_CONFIRMED',
  'VERIFICATION_RUN_RECORDED',
  'VERIFICATION_RUN_WITHDRAWN',
  'VERIFICATION_ESCALATED',
])
// Activities that duplicate inline entries (e.g. comments already shown)
const HIDDEN_TYPES = new Set(['COMMENT_ADDED'])

export function TimelineEntryRenderer({
  entry,
  members,
  agentActors,
}: TimelineEntryRendererProps) {
  if (entry.kind === 'comment') {
    return (
      <CommentTimelineItem
        entry={entry}
        members={members}
        agentActors={agentActors}
      />
    )
  }

  // Activity entry — skip types that duplicate inline entries
  if (HIDDEN_TYPES.has(entry.type) || RETIRED_ACTIVITY_TYPES.has(entry.type)) {
    return null
  }
  if (AGENT_TYPES.has(entry.type)) {
    return <AgentRunItem entry={entry} />
  }
  if (PR_TYPES.has(entry.type)) {
    return <PrItem entry={entry} />
  }

  // All other activities use compact rendering
  return (
    <CompactActivityItem
      entry={entry}
      members={members}
      agentActors={agentActors}
    />
  )
}
