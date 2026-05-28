import { htmlToMarkdown } from '@/lib/utils/markdown'

/**
 * Enrich a task DTO with a `descriptionMarkdown` sibling field rendered
 * from the stored HTML. Leaves `description` (HTML) untouched so Web
 * callers continue to feed it straight into Tiptap.
 *
 * Generic over the input shape so service-layer callers can pipe the
 * raw task entity through without losing field-level types.
 */
export function withMarkdown<T extends { description: string | null }>(
  task: T
): T & { descriptionMarkdown: string | null } {
  return {
    ...task,
    descriptionMarkdown: task.description
      ? htmlToMarkdown(task.description)
      : null,
  }
}
