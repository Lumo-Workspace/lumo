/**
 * Public API for the GitHub integration module.
 *
 * All external code must import from this barrel — never from internal files
 * like `@/lib/integrations/github/auth` directly.
 */

// Types
export type { SplitIdentifier } from './types'

// Auth
export {
  getRepoToken,
  getGithubAppJwt,
  createInstallationToken,
  getRepoCloneToken,
  createRepoScopedToken,
  createRepoTokenForInstallation,
  revokeInstallationToken,
} from './auth'
export type { RepoTokenPermissions } from './auth'
export {
  REPO_TOKEN_PERMISSIONS,
  INSTALLATION_TOKEN_PERMISSIONS,
  PRODUCTION_APP_PERMISSIONS,
  isWithinPermissions,
} from './token-permissions'
export {
  isConfirmedRepository,
  requireConfirmedRepository,
  repoNotConfirmedError,
} from './confirmed-repositories'

// App installations (the /app endpoints — install flow, not repository data)
export {
  fetchAppInstallation,
  fetchInstallationRepositories,
  listInstallationRepositories,
  deleteAppInstallation,
  InstallationRepositoryLimitError,
} from './app-installations'
export type {
  AppInstallationAccount,
  InstallationRepository,
} from './app-installations'

// Collaborator access (LUM-882 — the verifier access recheck)
export {
  checkUserExists,
  checkRepositoryReadAccess,
} from './collaborator-access'
export type { RepositoryReadAccess } from './collaborator-access'

// App user authorization (LUM-875 — install callback ownership check)
export {
  buildAppUserAuthorizeUrl,
  exchangeAppUserCode,
  listUserInstallationIds,
  listUserInstallationRepositories,
  fetchAppUserLogin,
  revokeAppUserToken,
  GithubAppUserAuthNotConfiguredError,
} from './app-user-auth'

// Branch utilities
export {
  parseBranchIdentifier,
  splitIdentifier,
  generateBranchName,
} from './branch'

// Webhooks
export { createRepoWebhook, deleteRepoWebhook } from './webhooks'

// Signature verification
export { verifyGitHubSignature } from './verify'

// PR sync
export { syncRepoPRs } from './sync'

// Markdown bridge (server-side only — do not import from client components)
export {
  lumoHtmlToGithubMarkdown,
  githubMarkdownToLumoHtml,
  HEADER_MARKER_OPEN,
  HEADER_MARKER_CLOSE,
  buildHeader,
  computeBodyHash,
} from './markdown-bridge'
