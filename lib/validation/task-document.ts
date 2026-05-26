import { z } from 'zod'

/**
 * Body schema for `POST /api/tasks/[id]/documents`. The caller provides
 * exactly one of `identifier` (URL / workspace slug-N / cuid string) or
 * `documentId` (raw cuid). The XOR refinement matches the LinkDocPopover
 * client which always submits exactly one.
 */
export const attachTaskDocumentBodySchema = z
  .object({
    identifier: z.string().min(1).optional(),
    documentId: z.string().cuid().optional(),
  })
  .strict()
  .refine(v => Boolean(v.identifier) !== Boolean(v.documentId), {
    message: 'Provide exactly one of identifier or documentId',
  })

export type AttachTaskDocumentBody = z.infer<
  typeof attachTaskDocumentBodySchema
>
