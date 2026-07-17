// Idea evidence re-exports the Task-side evidence schemas so idea routes
// validate identically to task routes (same shapes, same messages). See
// lib/validation/{slack-context,task-web-link,task-figma-link}.ts for the
// canonical definitions.
export { linkSlackContextBodySchema } from '@/lib/validation/slack-context'
export { createWebLinkBodySchema } from '@/lib/validation/task-web-link'
export { addFigmaLinkSchema } from '@/lib/validation/task-figma-link'

import { z } from 'zod'

/**
 * Citing a GitHub PR as evidence on an idea (LUM-684). Same `prId` xor `url`
 * shape as the Task side's `linkPullRequestSchema`, minus `force` — that flag
 * exists to steal a PR from the task currently holding `PullRequest.taskId`,
 * and an idea citation never moves that FK, so there is nothing to force.
 */
export const linkIdeaPullRequestBodySchema = z
  .object({
    prId: z.string().min(1).optional(),
    url: z.string().url().optional(),
  })
  .refine(data => (data.prId ? !data.url : !!data.url), {
    message: 'Provide exactly one of prId or url',
  })
