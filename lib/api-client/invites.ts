import { apiFetch } from './base'

interface AcceptInviteResult {
  workspaceSlug: string
}

export const invitesClient = {
  /**
   * Accept a workspace invitation by token. Returns the slug of the workspace
   * the caller has been added to, so the page can route the user into it.
   */
  async accept(
    token: string,
    init?: { signal?: AbortSignal }
  ): Promise<AcceptInviteResult> {
    return apiFetch<AcceptInviteResult>(`/api/invites/${token}/accept`, {
      method: 'POST',
      ...(init?.signal ? { signal: init.signal } : {}),
    })
  },
}
