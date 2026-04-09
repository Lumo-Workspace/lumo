/**
 * Type definitions for Account Management feature
 * Profile management types and interfaces
 */

export interface UserProfile {
  id: string
  displayName?: string | null
  avatarUrl?: string | null
  avatarBlobId?: string | null
  email?: string | null
  createdAt: Date
  updatedAt: Date
}
