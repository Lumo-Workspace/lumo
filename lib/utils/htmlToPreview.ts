/**
 * Strip HTML tags from a string and truncate to `max` characters. Used to
 * build a plain-text preview (e.g. a Slack `commentBody`) from stored HTML.
 * Null/undefined input yields an empty string.
 */
export function htmlToPreview(
  html: string | null | undefined,
  max = 200
): string {
  return (html ?? '').replace(/<[^>]+>/g, '').slice(0, max)
}
