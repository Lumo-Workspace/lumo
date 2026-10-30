import { z } from 'zod'

/**
 * Body schema for `POST /api/documents/import-google`. A Google Doc URL or
 * bare file id is required; visibility is optional and defaults (in the
 * service) to PRIVATE.
 */
export const importGoogleSchema = z.object({
  url: z.string().trim().min(1, 'url is required'),
  visibility: z.enum(['PRIVATE', 'WORKSPACE', 'SHARED']).optional(),
})

export type ImportGoogleInput = z.infer<typeof importGoogleSchema>

/**
 * LUM-1343: body schema for `POST /api/documents/import-feishu`. A Feishu /
 * Lark docx or wiki URL is required (parsed by the service so a malformed
 * one gets the distinct `feishu_doc_url_invalid` code); visibility defaults
 * to PRIVATE.
 */
export const importFeishuSchema = z.object({
  url: z.string().trim().min(1, 'url is required').max(2048),
  visibility: z.enum(['PRIVATE', 'WORKSPACE', 'SHARED']).optional(),
})

export type ImportFeishuInput = z.infer<typeof importFeishuSchema>
