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

/** Prisma cuid: literal "c" followed by 24 alphanumeric chars. */
const CUID_RE = /^c[a-z0-9]{24}$/

/**
 * Resolve a user-supplied document identifier (URL, cuid, or `slug-N`) to the
 * form `documentService.addExplicitMention` expects. The service itself
 * handles cuid + slug lookups via `documentRepository.findWithPermission`
 * (which already accepts either shape), so we just need to extract the
 * meaningful segment from URLs and pass non-URL inputs through.
 *
 * Pure string parsing — no I/O. Lives next to the schema because it's part
 * of the same input-normalization concern.
 */
export function resolveDocumentIdentifier(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // URL form — pull out the /documents/<slug-N> segment.
  if (trimmed.includes('/documents/')) {
    const m = trimmed.match(/\/documents\/([a-z0-9-]+-\d+)/i)
    if (m) return m[1]!
    return null
  }
  // Bare Prisma cuid — passes straight to the service which resolves cuid OR
  // slug via documentRepository.findWithPermission.
  if (CUID_RE.test(trimmed)) return trimmed
  // Bare workspace slug like "sprint-notes-3".
  if (/^[a-z0-9-]+-\d+$/i.test(trimmed)) return trimmed
  return null
}
