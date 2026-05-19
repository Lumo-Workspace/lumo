import { apiFetch } from './base'

interface UpdateProfileInput {
  firstName: string
  lastName: string
}

export const usersClient = {
  /** Update the caller's profile name fields. */
  async updateProfile(input: UpdateProfileInput): Promise<void> {
    await apiFetch('/api/users/profile', {
      method: 'PATCH',
      body: input,
    })
  },

  /**
   * Upload a new avatar image for the caller. The route streams the file to
   * Clerk and refreshes the user's `imageUrl`. Caller should reload the Clerk
   * user object afterwards to see the change.
   */
  async uploadAvatar(file: File): Promise<void> {
    const fd = new FormData()
    fd.append('file', file)
    await apiFetch('/api/users/profile/avatar', {
      method: 'POST',
      body: fd,
    })
  },
}
