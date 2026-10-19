import { z } from 'zod'

/**
 * Query of `GET /api/notifications`. `unread=1` (or `true`) returns only
 * unread notifications — filtered in the query, before the newest-50 cap, so
 * read rows never crowd unread ones out (LUM-1233, `lumo status`). Absent or
 * `0` / `false` keeps the default: every notification, read or not.
 */
export const notificationListQuerySchema = z.object({
  unread: z
    .enum(['1', 'true', '0', 'false'], {
      message: 'unread must be 1, true, 0 or false',
    })
    .optional()
    .transform(v => v === '1' || v === 'true'),
})

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>
