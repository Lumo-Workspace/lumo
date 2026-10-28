/**
 * LUM-1318 — the one place a Git platform id becomes an adapter. Scan and
 * review services call `gitProviderFor(pr)` with the PR row (or any object
 * carrying its `provider` column) and never branch on the platform's name.
 *
 * A row without a provider (`null` / absent) is GitHub: the column defaults
 * to it and rows predating it are GitHub (LUM-1315). A platform with no
 * adapter registered yet is refused (501) rather than sent to another
 * platform's API — a Codeup path must never reach GitHub.
 *
 * Kept apart from `./index.ts` so the repositories that only need the ids
 * do not load an adapter.
 */
import { githubGitProvider } from './github'
import { codeupGitProvider } from './codeup'
import { CODEUP_PROVIDER, GITHUB_PROVIDER, type GitProviderId } from './ids'
import type { GitApiError, GitProvider } from './types'

const ADAPTERS: Partial<Record<GitProviderId, GitProvider>> = {
  [GITHUB_PROVIDER]: githubGitProvider,
  // LUM-1316: behind `codeup-integration` (its token mint checks the flag).
  [CODEUP_PROVIDER]: codeupGitProvider,
}

/** Anything that names its Git platform the way a PR row does. */
export interface GitProviderRef {
  provider?: string | null | undefined
}

export function unsupportedGitProviderError(provider: string) {
  return Object.assign(
    new Error(
      `No Git provider adapter for "${provider}" (unsupported_git_provider)`
    ),
    { status: 501, code: 'unsupported_git_provider' as const }
  )
}

/** The adapter for `ref`'s platform; GitHub when the row names none. */
export function gitProviderFor(
  ref: GitProviderRef | null | undefined
): GitProvider {
  const id = ref?.provider ?? GITHUB_PROVIDER
  const adapter = Object.prototype.hasOwnProperty.call(ADAPTERS, id)
    ? ADAPTERS[id as GitProviderId]
    : undefined
  if (!adapter) throw unsupportedGitProviderError(id)
  return adapter
}

/**
 * `ref`'s provider as a spreadable `{ provider }` — empty when `ref` names
 * none, so a call forwarding it to a nested service keeps its arguments
 * unchanged for a row without the column.
 */
export function gitProviderRefOf(ref: GitProviderRef): GitProviderRef {
  return ref.provider === undefined ? {} : { provider: ref.provider }
}

/**
 * Whether `error` is an API refusal of any registered platform — for code
 * that classifies an error without knowing which PR it came from (a log
 * line, a 404 / 422 check after a write).
 */
export function isGitApiError(error: unknown): error is GitApiError {
  return Object.values(ADAPTERS).some(adapter => adapter?.isApiError(error))
}
