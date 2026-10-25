/**
 * Single source of truth for each integration's "level" (kind).
 *
 * TEAM     — workspace-wide, ownerless system behavior (one install serves all).
 * PERSONAL — scoped to an individual member's account access.
 *
 * GitHub is two lines. `github` (TEAM) is the App installation — every
 * repository read and write, from PR links to the security scan, runs as it.
 * `githubAccount` (PERSONAL) is a member's OAuth link: identity only, so
 * comments arriving from GitHub are attributed to the member who wrote them.
 *
 * `codeup` (TEAM, LUM-1315) is the workspace's Codeup connection: one
 * personal access token, entered by an owner, that every Codeup call runs as.
 */
export type IntegrationKind = 'TEAM' | 'PERSONAL'

export type IntegrationId =
  | 'slack'
  | 'sentry'
  | 'github'
  | 'githubAccount'
  | 'codeup'
  | 'figma'
  | 'googleDrive'

export interface IntegrationDescriptor {
  id: IntegrationId
  kind: IntegrationKind
}

export const INTEGRATIONS = {
  slack: { id: 'slack', kind: 'TEAM' },
  sentry: { id: 'sentry', kind: 'TEAM' },
  github: { id: 'github', kind: 'TEAM' },
  githubAccount: { id: 'githubAccount', kind: 'PERSONAL' },
  codeup: { id: 'codeup', kind: 'TEAM' },
  figma: { id: 'figma', kind: 'PERSONAL' },
  googleDrive: { id: 'googleDrive', kind: 'PERSONAL' },
} as const satisfies Record<IntegrationId, IntegrationDescriptor>

export function getIntegrationKind(id: IntegrationId): IntegrationKind {
  return INTEGRATIONS[id].kind
}
