// Idea evidence re-exports the Task-side evidence schemas so idea routes
// validate identically to task routes (same shapes, same messages). See
// lib/validation/{slack-context,task-web-link,task-figma-link}.ts for the
// canonical definitions.
export { linkSlackContextBodySchema } from '@/lib/validation/slack-context'
export { createWebLinkBodySchema } from '@/lib/validation/task-web-link'
export { addFigmaLinkSchema } from '@/lib/validation/task-figma-link'
