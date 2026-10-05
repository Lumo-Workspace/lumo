/**
 * LUM-988 — the AI review's changed-file context for one scan: ONE
 * contents:read installation token for the repository (`withRepoReadToken`),
 * every file read with it, then revoked.
 *
 * Minting per file (`readRepoFile`) cost up to 60 installation-token mints a
 * scan, none revoked, and any one 403/429 among them dropped all context.
 * Minting still refuses an unconfirmed repository (LUM-883), once, up front.
 * Never throws: a failed mint, read or timeout comes back as `error` with no
 * context, and the review runs on the diff.
 *
 * Only `@/lib/integrations/github/contents` is imported, never `./auth`
 * directly: the scan service imports this module statically, and pulling
 * `@octokit/auth-app` (ESM) into its graph breaks every jest suite that
 * mocks `contents` but not `auth`.
 */
import {
  readRepoFileWithToken,
  withRepoReadToken,
} from '@/lib/integrations/github/contents'
import {
  isSkippedContextPath,
  loadReviewContext,
  type LoadedReviewContext,
} from '@/lib/security-scan/review-context'

const noContext = (error: string | null): LoadedReviewContext => ({
  text: '',
  included: [],
  error,
})

export const reviewContextService = {
  async load(opts: {
    workspaceId: string
    repo: string
    headSha: string
    /** Changed, not-deleted paths the review covers. */
    paths: readonly string[]
    /** Char cap for the packed context (the caller's remaining budget). */
    maxChars?: number
  }): Promise<LoadedReviewContext> {
    // Nothing to read (no path, only lockfiles / binaries, no budget): no
    // token is minted at all.
    const paths = opts.paths.filter(p => !isSkippedContextPath(p))
    if (paths.length === 0 || opts.maxChars === 0) return noContext(null)
    try {
      return await withRepoReadToken(
        { workspaceId: opts.workspaceId, fullName: opts.repo },
        token =>
          loadReviewContext({
            paths,
            ...(opts.maxChars !== undefined ? { maxChars: opts.maxChars } : {}),
            readFile: (path, signal) =>
              readRepoFileWithToken({
                token,
                fullName: opts.repo,
                path,
                ref: opts.headSha,
                signal,
              }),
          })
      )
    } catch (error) {
      return noContext(error instanceof Error ? error.message : String(error))
    }
  },
}
