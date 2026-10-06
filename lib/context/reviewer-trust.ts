/**
 * LUM-1003 — who wrote a mirrored GitHub comment, as far as Lumo can verify.
 *
 * PR review comments and mirrored PR comments can be written by anyone who can
 * comment on the GitHub PR: external contributors, drive-by accounts, bots.
 * Agent context renders a *trusted* reviewer's ask as work to do and an
 * *unverified* one as quoted reference data. Trust comes from two facts:
 *
 *   - the comment's author maps to a Lumo workspace member (a HUMAN actor —
 *     `resolveInboundAuthor` found a linked GitHub login), or
 *   - GitHub's `author_association` at mirror time is OWNER, MEMBER or
 *     COLLABORATOR (write-level standing on the repository or its org).
 *
 * Everything else is unverified, including a null association: rows mirrored
 * before LUM-1003 never recorded it, and unknown must never read as trusted.
 */

export type ReviewerRole =
  | 'workspace_member'
  | 'repo_owner'
  | 'org_member'
  | 'collaborator'
  | 'contributor'
  | 'first_time_contributor'
  | 'no_association'
  | 'unknown'

export interface ReviewerTrust {
  trusted: boolean
  role: ReviewerRole
}

const TRUSTED_ASSOCIATIONS: Record<string, ReviewerRole> = {
  OWNER: 'repo_owner',
  MEMBER: 'org_member',
  COLLABORATOR: 'collaborator',
}

const UNTRUSTED_ASSOCIATIONS: Record<string, ReviewerRole> = {
  CONTRIBUTOR: 'contributor',
  FIRST_TIME_CONTRIBUTOR: 'first_time_contributor',
  FIRST_TIMER: 'first_time_contributor',
  NONE: 'no_association',
  MANNEQUIN: 'no_association',
}

export function classifyReviewer(input: {
  /** GitHub `author_association`, as stored on the mirror row. */
  authorAssociation: string | null | undefined
  /** The comment's author actor type (`HUMAN` = a Lumo workspace member). */
  authorActorType: string | null | undefined
}): ReviewerTrust {
  if (input.authorActorType === 'HUMAN') {
    return { trusted: true, role: 'workspace_member' }
  }
  const assoc = input.authorAssociation?.trim().toUpperCase() ?? ''
  const trustedRole = TRUSTED_ASSOCIATIONS[assoc]
  if (trustedRole) return { trusted: true, role: trustedRole }
  return { trusted: false, role: UNTRUSTED_ASSOCIATIONS[assoc] ?? 'unknown' }
}

const ROLE_LABEL: Record<ReviewerRole, string> = {
  workspace_member: 'workspace member',
  repo_owner: 'repo owner',
  org_member: 'org member',
  collaborator: 'collaborator',
  contributor: 'contributor, no write access',
  first_time_contributor: 'first-time contributor, no write access',
  no_association: 'no write access',
  unknown: 'role not verified',
}

/** Agent-facing label shown next to the reviewer handle. */
export function reviewerRoleLabel(role: ReviewerRole): string {
  return ROLE_LABEL[role]
}

/**
 * Provenance of a comment written by a GitHub user (a GITHUB_USER
 * pseudo-actor, i.e. mirrored from a PR and not a Lumo member); undefined for
 * Lumo-native comments, which render unchanged.
 */
export function githubCommentProvenance(c: {
  author?: { type: string; externalIdentity: string | null } | null
  mirror?: { authorAssociation: string | null } | null
}): { login: string | null; reviewer: ReviewerTrust } | undefined {
  if (c.author?.type !== 'GITHUB_USER') return undefined
  const ext = c.author.externalIdentity
  return {
    login: ext?.startsWith('github:') ? ext.slice('github:'.length) : null,
    reviewer: classifyReviewer({
      authorAssociation: c.mirror?.authorAssociation,
      authorActorType: c.author.type,
    }),
  }
}
