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
const baseSha = z.string().regex(/^[0-9a-f]{7,40}$/)
const prNumber = z.number().int().positive()
const tool = z.string().regex(/^[a-z0-9-]{1,32}$/)

/**
 * What the CI client sends as `clientPayload` to `@vercel/blob/client`'s
 * `upload()` — never trusted for `workspaceId`, which is derived server-side
 * from the bearer key instead (see the upload route's `onBeforeGenerateToken`).
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

/** Body of `POST /api/internal/security-sarif-ingest` — the dispatched job. */
export const sarifIngestJobSchema = z
  .object({
    url: z.string().url(),
    pathname: z.string().min(1),
    workspaceId: z.string().min(1),
    repository,
    headSha,
    prNumber,
    tool,
  })
  .strict()

export type SarifIngestJobInput = z.infer<typeof sarifIngestJobSchema>

/**
 * The tokenPayload minted by the upload route's `onBeforeGenerateToken` and
 * read back in `onUploadCompleted`. Deliberately NOT `.strict()`: it is
 * `JSON.stringify({ workspaceId, ...clientPayload })`, so it may also carry
 * the client payload's optional `baseSha` — irrelevant to dispatch, ignored.
 * Never parses anything the client sent directly; the string was produced by
 * this same server process.
 */
export const sarifTokenPayloadSchema = z.object({
  workspaceId: z.string().min(1),
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

/**
 * Compares an actual blob pathname against the expected one, allowing for
 * the random suffix `addRandomSuffix: true` inserts before the extension
 * (`<tool>.sarif.gz` -> `<tool>-<suffix>.sarif.gz`).
 */
export function pathnameMatches(actual: string, expected: string): boolean {
  if (actual === expected) return true
  const base = expected.slice(0, -'.sarif.gz'.length)
  return actual.startsWith(`${base}-`) && actual.endsWith('.sarif.gz')
}
