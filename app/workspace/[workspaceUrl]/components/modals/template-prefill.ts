/** Visible text of an HTML fragment, whitespace-collapsed (for comparisons). */
function plainText(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * LUM-970: can the new-task form switch template without asking? Yes when
 * the description is empty or still exactly the previously applied
 * template; otherwise switching would discard what the user wrote.
 */
export function canReplaceDescriptionSilently(
  currentHtml: string | null | undefined,
  appliedTemplateHtml: string | null | undefined
): boolean {
  const current = plainText(currentHtml)
  if (current === '') return true
  return (
    appliedTemplateHtml != null && current === plainText(appliedTemplateHtml)
  )
}
