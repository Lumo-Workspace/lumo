import { z } from 'zod'

/**
 * Shared field validators for the LUM-735 SARIF ingest pipeline (spec §6-9).
 * `repository` is `owner/repo` (no extra slashes — enforced so
 * `expectedSarifPathname` can safely split on the first one), `headSha`/
 * `baseSha` are short-or-full git SHAs, `tool` is the CI-supplied slug
 * (e.g. `semgrep`) used both as a findings-source tag and as a blob
 * pathname segment.
 */
const repository = z.string().regex(/^[\w.-]+\/[\w.-]+$/)
const headSha = z.string().regex(/^[0-9a-f]{7,40}$/)
// Accepted for forward-compat with a future diff-base override; currently
// unused — the workflow derives the diff itself from the PR's own base ref.
const baseSha = z.string().regex(/^[0-9a-f]{7,40}$/)
const prNumber = z.number().int().positive()
const tool = z.string().regex(/^[a-z0-9-]{1,32}$/)

/**
 * Vercel Blob's own token verification already restricts an authenticated
 * upload to a blob it minted, so this is defense-in-depth: it stops
 * `complete`'s start call (fed by a CI-supplied `url`, not a signed callback)
 * from ever resolving a URL on a host we don't recognize as blob storage.
 */
export const BLOB_HOST_SUFFIX = '.blob.vercel-storage.com'

/**
 * What the CI client sends as `clientPayload` to `@vercel/blob/client`'s
 * `upload()` — never trusted for workspace ownership, which comes from the
 * bearer (ApiKey) or from the PullRequest row (GitHub OIDC) instead. On the
 * OIDC path `repository`/`prNumber` are additionally pinned to the token's own
 * claims (see the upload route's `onBeforeGenerateToken`).
 */
export const sarifClientPayloadSchema = z
  .object({
    repository,
    headSha,
    prNumber,
    baseSha: baseSha.optional(),
    tool,
  })
  .strict()

export type SarifClientPayload = z.infer<typeof sarifClientPayloadSchema>

/** Body of `POST /api/integrations/security/sarif/complete`. */
export const sarifCompleteBodySchema = sarifClientPayloadSchema.extend({
  url: z.string().url(),
})

export type SarifCompleteBody = z.infer<typeof sarifCompleteBodySchema>

/**
 * The tokenPayload minted by the upload route's `onBeforeGenerateToken` and
 * read back in `onUploadCompleted`. Deliberately NOT `.strict()`: it is
 * `JSON.stringify({ auth, workspaceId?, ...clientPayload })`, so it may also
 * carry the client payload's optional `baseSha` — irrelevant to the started
 * job, ignored. Never parses anything the client sent directly; the string
 * was produced by this same server process.
 *
 * `auth` records which credential minted the token, and `workspaceId` is
 * present only for `auth: 'key'` (see the `SarifIngestJob` the workflow is
 * started with, `lib/services/security-sarif-ingest-start.ts`).
 *
 * `auth` is **optional** for the deploy window: an upload whose token was
 * minted by the previous deployment can complete minutes after the new code is
 * live, and that older payload has no `auth` field. Rejecting it would silently
 * drop a report that was already accepted. The shape still says which path
 * minted it — `workspaceId` exists on the ApiKey path and only there — so
 * readers fall back to that (see the upload route's `onUploadCompleted`). The
 * field can be made required once no in-flight upload predates the rollout.
 */
export const sarifTokenPayloadSchema = z.object({
  auth: z.enum(['oidc', 'key']).optional(),
  workspaceId: z.string().min(1).optional(),
  repository,
  headSha,
  prNumber,
  tool,
})

/**
 * The canonical blob pathname for one tool's report on one PR head commit —
 * `security-sarif/<owner>--<repo>/<headSha>/<tool>.sarif.gz`. `owner--repo`
 * (not `owner/repo`) because blob pathnames are otherwise free of slashes.
 */
export function expectedSarifPathname(p: {
  repository: string
  headSha: string
  tool: string
}): string {
  const [owner, repo] = p.repository.split('/')
  return `security-sarif/${owner}--${repo}/${p.headSha}/${p.tool}.sarif.gz`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Compares an actual blob pathname against the expected one, allowing for
 * the random suffix `addRandomSuffix: true` inserts before the extension
 * (`<tool>.sarif.gz` -> `<tool>-<suffix>.sarif.gz`). Anchored so the suffix
 * can only be a single run of `[A-Za-z0-9]` immediately before `.sarif.gz`
 * (no extra `/`, `.` or `-` segments the old prefix/suffix check let through).
 *
 * The suffix must also be at least 16 characters. `tool` values are
 * lowercase-only (`^[a-z0-9-]{1,32}$`), so a lowercase-only "suffix" could
 * actually be another valid tool slug colliding with a shorter one — e.g.
 * `semgrep-oss.sarif.gz` satisfying a token minted for the bare `semgrep`
 * tool. Length is the stable discriminator here (Vercel's real random
 * suffix is far longer than any tool slug); case is not — Vercel's
 * `addRandomSuffix` is generated server-side and opaque to this repo, so it
 * could legitimately be all-lowercase/digits, and requiring an uppercase
 * letter would silently reject a valid suffix and drop the ingest.
 */
export function pathnameMatches(actual: string, expected: string): boolean {
  if (actual === expected) return true
  const base = expected.slice(0, -'.sarif.gz'.length)
  const match = actual.match(
    new RegExp(`^${escapeRegExp(base)}-([A-Za-z0-9]+)\\.sarif\\.gz$`)
  )
  return !!match && /^[A-Za-z0-9]{16,}$/.test(match[1]!)
}
