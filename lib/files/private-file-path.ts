/**
 * LUM-916 — where private uploads live and how they are addressed.
 *
 * Uploads used to be `access: 'public'` blobs guarded only by an unguessable
 * URL. They are now private blobs, served by the authenticated file route
 * `GET /api/files/<blob pathname>`, so the stored/rendered URL is
 * `<origin>/api/files/<pathname>`.
 *
 * Two kinds, each carrying the id that decides who may read it:
 *   - evidence: `test-evidence/<taskId>/<caseId>/<fileId>` — the task's
 *     workspace (the prefix is unchanged so the LUM-861 workspace-deletion
 *     sweep and task deletion keep finding it)
 *   - image:    `workspaces/<workspaceId>/images/<fileId>` — server-chosen
 *     prefix (LUM-862), swept with the workspace
 *
 * Pathnames carry NO file extension on purpose: the Clerk middleware matcher
 * skips any path ending in `.png` / `.json` / `.txt` …, and without it the
 * route cannot read the browser session. The content type lives on the blob.
 */

export const FILE_ROUTE_PREFIX = '/api/files/'

const ID = /^[A-Za-z0-9_-]{1,64}$/

export type PrivateFile =
  | { kind: 'evidence'; taskId: string; caseId: string; fileId: string }
  | { kind: 'image'; workspaceId: string; fileId: string }

export function evidencePathname(
  taskId: string,
  caseId: string,
  fileId: string
): string {
  return `test-evidence/${taskId}/${caseId}/${fileId}`
}

export function imagePathname(workspaceId: string, fileId: string): string {
  return `workspaces/${workspaceId}/images/${fileId}`
}

export function pathnameOf(file: PrivateFile): string {
  return file.kind === 'evidence'
    ? evidencePathname(file.taskId, file.caseId, file.fileId)
    : imagePathname(file.workspaceId, file.fileId)
}

/**
 * Parse a blob pathname (or the route's path segments joined by `/`) into a
 * private file. Anything else — other prefixes, extra segments, `..`, odd
 * characters — is null, so the route can never be steered at a blob it does
 * not own (exports, SARIF, logos).
 */
export function parsePrivateFilePath(pathname: string): PrivateFile | null {
  const parts = pathname.split('/')
  if (parts.length !== 4) return null
  const [head, a, b, c] = parts as [string, string, string, string]
  if (head === 'test-evidence' && ID.test(a) && ID.test(b) && ID.test(c)) {
    return { kind: 'evidence', taskId: a, caseId: b, fileId: c }
  }
  if (head === 'workspaces' && b === 'images' && ID.test(a) && ID.test(c)) {
    return { kind: 'image', workspaceId: a, fileId: c }
  }
  return null
}

/** `<origin>/api/files/<pathname>` — the URL stored in evidence / HTML. */
export function fileRouteUrl(origin: string, pathname: string): string {
  return `${origin.replace(/\/+$/, '')}${FILE_ROUTE_PREFIX}${pathname}`
}

/**
 * Every file-route image reference in a body of HTML/markdown, as pathnames.
 * Origin-agnostic (matches both absolute and relative URLs) so a document
 * written on a preview host still authorises on production.
 */
export function referencedImagePathnames(text: string): Set<string> {
  const out = new Set<string>()
  const re =
    /\/api\/files\/(workspaces\/[A-Za-z0-9_-]+\/images\/[A-Za-z0-9_-]+)/g
  for (const m of text.matchAll(re)) out.add(m[1] as string)
  return out
}

/**
 * Append `share=<token>` to a file-route IMAGE url, so an anonymous viewer of
 * a publicly shared document presents the share token the route checks.
 * Any other URL (links, evidence, external images) comes back unchanged.
 */
export function withShareToken(url: string, token: string): string {
  if (
    !/\/api\/files\/workspaces\/[A-Za-z0-9_-]+\/images\/[A-Za-z0-9_-]+(\?|#|$)/.test(
      url
    )
  ) {
    return url
  }
  const q = `share=${encodeURIComponent(token)}`
  const [path, query] = url.split('?', 2) as [string, string | undefined]
  return query ? `${path}?${query}&${q}` : `${path}?${q}`
}
