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
    const loadCommentsWithAuthors = async () =>
      withAuthorNames(await commentRepository.findByTaskId(taskId), workspaceId)
    const [activities, comments] = await Promise.all([
      activityRepository.findByTaskId(taskId, findOptions),
      loadCommentsWithAuthors(),
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
    const items = merged.slice(0, limit)

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
