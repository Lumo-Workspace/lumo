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
