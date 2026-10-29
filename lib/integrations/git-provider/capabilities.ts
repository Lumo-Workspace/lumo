/**
 * LUM-1318 — what a Git platform adapter can do beyond the core every
 * adapter must offer (read a PR's diff / head / files, post a comment).
 *
 * A scan layer that needs a capability the PR's platform lacks is recorded as
 * unsupported on that platform and skipped — the scan never branches on the
 * platform's name (`ee/security/security-scan/platform-support.ts`).
 */
export const GIT_PROVIDER_CAPABILITIES = [
  /** A short-lived clone token + checkout for the sandbox layers (managed scan, hunt). */
  'repoClone',
  /** One request for the repository archive at a ref (`streamRepoTarballWithToken`). */
  'repoArchive',
  /** The PR's per-file list with patches (`fetchPrFiles`). */
  'prFileList',
  /** Review threads: list / resolve / unresolve. */
  'reviewThreads',
  /** Reviews with an event (APPROVE / REQUEST_CHANGES) and their dismissal. */
  'reviewVerdict',
  /** Writing the PR description. */
  'descriptionWrite',
  /** Reading the repository's issues (linked requirements). */
  'repoIssues',
  /** Asking whether a user may push to the repository. */
  'collaboratorAccess',
] as const

export type GitProviderCapability = (typeof GIT_PROVIDER_CAPABILITIES)[number]

export type GitProviderCapabilities = Readonly<
  Record<GitProviderCapability, boolean>
>

/** Every capability on — what a full adapter (GitHub) declares. */
export function allCapabilities(): GitProviderCapabilities {
  const out = {} as Record<GitProviderCapability, boolean>
  for (const capability of GIT_PROVIDER_CAPABILITIES) out[capability] = true
  return out
}

/** Whether `capabilities` has every capability in `required`. */
export function supportsAll(
  capabilities: GitProviderCapabilities,
  required: readonly GitProviderCapability[]
): boolean {
  return required.every(capability => capabilities[capability] === true)
}
