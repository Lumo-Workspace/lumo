import { resolveAppUrl } from '@/lib/config/public-config'
/**
 * Build a full URL to a document page.
 */
export function buildDocumentUrl(
  workspaceSlug: string,
  docSlug: string
): string {
  const appUrl = resolveAppUrl() ?? 'http://localhost:3000'
  return `${appUrl}/workspace/${workspaceSlug}/documents/${docSlug}`
}
