/**
 * Build a full URL to a document page.
 */
export function buildDocumentUrl(
  workspaceSlug: string,
  docSlug: string
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${appUrl}/workspace/${workspaceSlug}/documents/${docSlug}`
}
