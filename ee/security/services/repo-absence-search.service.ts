/**
 * LUM-1310 — the one bounded, read-only search of a PR's head the linked
 * task / issue assessment runs for repo-wide absence claims
 * (`repo-absence-search.ts` has what is searched and how hits are read).
 *
 * Static analysis only: one tarball request for the PR's own repository at
 * the head commit, with a contents:read installation token minted for it and
 * revoked after; nothing is checked out, built or run. Bounded in bytes
 * (`ABSENCE_SEARCH_MAX_BYTES` of uncompressed archive, files over
 * `ABSENCE_SEARCH_FILE_MAX_BYTES` skipped unread, and counted so the model
 * is told absence is unproven in them) and in time
 * (`ABSENCE_SEARCH_TIMEOUT_MS`). A cut search is reported as such — it never
 * proves absence.
 *
 * Optional context: the caller drops it when this throws.
 *
 * A platform without a repository archive (`capabilities.repoArchive`) is
 * not searched: undefined, as for no queries — absence stays unproven.
 *
 * Layering: service — the PR's Git platform through the `GitProvider` port
 * (LUM-1318).
 */
import {
  gitProviderFor,
  type GitProviderRef,
} from '@/lib/integrations/git-provider/resolve'
import {
  AbsenceMatcher,
  wantedByQueries,
  type AbsenceQuery,
  type RepoAbsenceSearch,
} from '@/ee/security/security-scan/repo-absence-search'

/** Uncompressed archive read, at most. */
export const ABSENCE_SEARCH_MAX_BYTES = 128 * 1024 * 1024
/** A file larger than this is skipped (generated / vendored / data). */
export const ABSENCE_SEARCH_FILE_MAX_BYTES = 1024 * 1024
export const ABSENCE_SEARCH_TIMEOUT_MS = 15_000

export const repoAbsenceSearchService = {
  /** Search the head for `queries` (none ⇒ undefined, nothing read). */
  async search(
    input: {
      workspaceId: string
      repo: string
      headSha: string
      queries: readonly AbsenceQuery[]
    } & GitProviderRef
  ): Promise<RepoAbsenceSearch | undefined> {
    if (input.queries.length === 0) return undefined
    const gh = gitProviderFor(input)
    if (!gh.capabilities.repoArchive) return undefined
    const matcher = new AbsenceMatcher(input.queries)
    const reader = gh.createArchiveReader({
      maxFileBytes: ABSENCE_SEARCH_FILE_MAX_BYTES,
      wantPath: path => wantedByQueries(path, input.queries),
      onFile: (path, content) => matcher.addFile(path, content),
      onSkip: path => matcher.skipFile(path),
    })
    const read = await gh.withRepoReadToken(
      { workspaceId: input.workspaceId, fullName: input.repo },
      token =>
        gh.streamRepoTarballWithToken({
          token,
          fullName: input.repo,
          ref: input.headSha,
          maxBytes: ABSENCE_SEARCH_MAX_BYTES,
          signal: AbortSignal.timeout(ABSENCE_SEARCH_TIMEOUT_MS),
          onChunk: chunk => reader.push(chunk),
        })
    )
    // A stream that ended without the archive's end block (or past a corrupt
    // header) did not read the whole repository.
    return matcher.result(
      read.stop === 'end' && !reader.done ? 'truncated' : read.stop
    )
  },
}
