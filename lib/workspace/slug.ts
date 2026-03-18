/**
 * Workspace slug utilities
 */

/**
 * Generate a URL-safe slug from a workspace name.
 * Example: "Hello World!" → "hello-world"
 */
export function generateWorkspaceSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .substring(0, 50)
}
