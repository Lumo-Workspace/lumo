import { apiFetch } from './base'

/** One PR cited as evidence on an idea. The PR fields are a read-only
 * projection of the workspace's synced `PullRequest` row. */
export interface IdeaPullRequestCitation {
  id: string
  createdAt: string
  pullRequest: {
    id: string
    repo: string
    number: number
    title: string
    url: string
    state: string
    ciStatus: string | null
    authorLogin: string
  }
}

export const ideaPullRequestsClient = {
  list(ideaId: string): Promise<{ pullRequests: IdeaPullRequestCitation[] }> {
    return apiFetch(`/api/ideas/${ideaId}/pull-requests`)
  },

  /** Cite a PR — by an already-synced `prId`, or by pasting a GitHub `url`. */
  link(
    ideaId: string,
    payload: { prId?: string; url?: string }
  ): Promise<{ citation: { id: string } }> {
    return apiFetch(`/api/ideas/${ideaId}/pull-requests`, {
      method: 'POST',
      body: payload,
    })
  },

  unlink(ideaId: string, citationId: string): Promise<void> {
    return apiFetch(`/api/ideas/${ideaId}/pull-requests/${citationId}`, {
      method: 'DELETE',
    })
  },
}
