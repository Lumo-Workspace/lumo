import { activityRepository } from '@/lib/repositories/activity.repository'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { withAuthorNames } from '@/lib/services/comment-author-names'

export interface TimelineEntry {
  id: string
  kind: 'activity' | 'comment'
  createdAt: Date
  [key: string]: unknown
}

interface TimelineOptions {
  limit: number
  /** Workspace the comment author names are looked up in (LUM-1238). */
  workspaceId: string
  cursor?:
    | { timestamp: string; id: string; source: 'activity' | 'comment' }
    | undefined
}

interface TimelineResult {
  items: TimelineEntry[]
  hasMore: boolean
  nextCursor: string | null
}

/**
 * LUM-1238: `authorName` on the comment entries (and their replies) of one
 * page — looked up only for that page, not for every comment on the task.
 */
async function withPageCommentAuthors(
  items: TimelineEntry[],
  workspaceId: string
): Promise<TimelineEntry[]> {
  const pageComments = items.filter(i => i.kind === 'comment') as Array<
    TimelineEntry & {
      authorActorId: string | null
      replies?: { authorActorId: string | null }[]
    }
  >
  if (pageComments.length === 0) return items
  const named = new Map(
    (await withAuthorNames(pageComments, workspaceId)).map(c => [c.id, c])
  )
  return items.map(i => named.get(i.id) ?? i)
}

export const timelineService = {
  async getTimeline(
    taskId: string,
    options: TimelineOptions
  ): Promise<TimelineResult> {
    const { limit, cursor, workspaceId } = options

    // Build cursor filters per source
    const activityCursor =
      cursor && (cursor.source === 'activity' || !cursor.source)
        ? { timestamp: cursor.timestamp, id: cursor.id }
        : cursor
          ? { timestamp: cursor.timestamp, id: '' }
          : undefined

    // Fetch from both sources (limit+1 each for hasMore detection)
    const findOptions: {
      limit: number
      cursor?: { timestamp: string; id: string }
    } = { limit }
    if (activityCursor) findOptions.cursor = activityCursor
    const [activities, comments] = await Promise.all([
      activityRepository.findByTaskId(taskId, findOptions),
      commentRepository.findByTaskId(taskId),
    ])

    // Convert to unified entries
    const activityEntries: TimelineEntry[] = activities.map(
      (a: Record<string, unknown>) => ({
        id: a.id as string,
        kind: 'activity' as const,
        createdAt: a.createdAt as Date,
        // Flatten so frontend gets { kind, type, payload, actorId, actor, ... }
        ...(a as Record<string, unknown>),
      })
    )

    const commentEntries: TimelineEntry[] = (
      comments as Record<string, unknown>[]
    ).map(c => ({
      id: c.id as string,
      kind: 'comment' as const,
      createdAt: c.createdAt as Date,
      ...(c as Record<string, unknown>),
    }))

    // Filter comments by cursor if needed
    let filteredComments = commentEntries
    if (cursor) {
      const cursorTime = new Date(cursor.timestamp).getTime()
      filteredComments = commentEntries.filter(c => {
        const cTime = c.createdAt.getTime()
        return cTime > cursorTime || (cTime === cursorTime && c.id > cursor.id)
      })
    }

    // Merge and sort by createdAt ASC, then id ASC for ties
    const merged = [...activityEntries, ...filteredComments].sort((a, b) => {
      const timeDiff = a.createdAt.getTime() - b.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

    // Determine hasMore: if either source returned more than limit, there's more
    const hasMore = merged.length > limit
    const items = await withPageCommentAuthors(
      merged.slice(0, limit),
      workspaceId
    )

    let nextCursor: string | null = null
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1]!
      nextCursor = JSON.stringify({
        timestamp: last.createdAt.toISOString(),
        id: last.id,
        source: last.kind,
      })
    }

    return { items, hasMore, nextCursor }
  },
}
