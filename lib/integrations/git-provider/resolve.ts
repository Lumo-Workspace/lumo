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
import { GITHUB_PROVIDER, type GitProviderId } from './ids'
import type { GitProvider } from './types'

const ADAPTERS: Partial<Record<GitProviderId, GitProvider>> = {
  [GITHUB_PROVIDER]: githubGitProvider,
}

/** Anything that names its Git platform the way a PR row does. */
export interface GitProviderRef {
  provider?: string | null
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
