import { z } from 'zod'

/**
 * Permission to match a real Slack archive permalink. We deliberately match
 * the full structure (including the C-prefixed channel id and a 16+ digit
 * `p…` segment) rather than just "starts with https" — so the route layer
 * never hands a clearly-bogus string to the service.
 */
export const slackPermalinkSchema = z
  .string()
  .regex(
    /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/C[A-Z0-9]+\/p\d{16,}(\?.*)?$/,
    'slackContext.error.invalidPermalink'
  )

export const linkSlackContextBodySchema = z.object({
  permalink: slackPermalinkSchema,
})
