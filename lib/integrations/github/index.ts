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
  getGithubInstallationToken,
  getGithubAppJwt,
  createInstallationToken,
} from './auth'

// App installations (the /app endpoints — install flow, not repository data)
export {
  fetchAppInstallation,
  fetchInstallationRepositories,
  deleteAppInstallation,
} from './app-installations'
export type { AppInstallationAccount } from './app-installations'

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
