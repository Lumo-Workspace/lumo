/**
 * Single source of truth for each integration's "level" (kind).
 *
 * TEAM     — workspace-wide, ownerless system behavior (one install serves all).
 * PERSONAL — scoped to an individual member's account access.
 *
 * GitHub is classified TEAM: the team App installation (stable backend for
 * agent-created PRs) is the backbone. The existing personal OAuth code is left
 * untouched and is not modeled as a personal capability line in this phase.
 */
export type IntegrationKind = 'TEAM' | 'PERSONAL'

export type IntegrationId =
  | 'slack'
  | 'sentry'
  | 'github'
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
  figma: { id: 'figma', kind: 'PERSONAL' },
  googleDrive: { id: 'googleDrive', kind: 'PERSONAL' },
} as const satisfies Record<IntegrationId, IntegrationDescriptor>

export function getIntegrationKind(id: IntegrationId): IntegrationKind {
  return INTEGRATIONS[id].kind
}
