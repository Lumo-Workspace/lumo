/**
 * LUM-987 — the active workspace of a Clerk browser session is the workspace
 * URL slug (`/workspace/<slug>/…`). The browser's shared fetch wrapper
 * (`apiFetch`) sends it on every API call under this header; the server
 * resolves the session's workspace from it (`lib/auth`). Bearer credentials
 * ignore it — a key is bound to its own workspace.
 *
 * Dependency-free so both the browser bundle and the server can import it.
 */
export const ACTIVE_WORKSPACE_HEADER = 'X-Lumo-Workspace'

/** `<meta name=…>` a workspace-less page renders to declare its workspace. */
export const ACTIVE_WORKSPACE_META = 'lumo-workspace'

const WORKSPACE_PATH = /^\/workspace\/([^/?#]+)/

/** The workspace slug of a `/workspace/<slug>/…` pathname, else null. */
export function workspaceSlugFromPathname(pathname: string): string | null {
  const match = WORKSPACE_PATH.exec(pathname)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

/** A header value as an active slug: trimmed, empty → null. */
export function normalizeActiveSlug(
  value: string | null | undefined
): string | null {
  const slug = value?.trim()
  return slug ? slug : null
}
