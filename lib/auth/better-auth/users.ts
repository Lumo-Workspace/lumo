/**
 * LUM-1027 — Better Auth implementation of the user directory, backed by the
 * `auth_users` table. No network calls: unlike Clerk, a request-scoped and a
 * standalone directory are the same thing.
 */
import { getBlobStorage } from '@/lib/blob/storage'
import { authUserRepository } from '@/lib/repositories/auth-user.repository'
import type { UserDirectory } from '../types'
import { nameFieldsForUpdate, toAuthUser } from './user-shape'

/** Clerk's getUserList defaults: 10 per page, at most 500. */
export const DEFAULT_USER_LIST_LIMIT = 10
export const MAX_USER_LIST_LIMIT = 500

function notFound(userId: string): Error {
  return Object.assign(new Error(`User ${userId} not found`), { status: 404 })
}

function avatarExtension(type: string): string {
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  return 'jpg'
}

export const betterAuthUserDirectory: UserDirectory = {
  async getUser(userId) {
    const record = await authUserRepository.findById(userId)
    if (!record) throw notFound(userId)
    return toAuthUser(record)
  },

  async getUserList(query) {
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_USER_LIST_LIMIT, 1),
      MAX_USER_LIST_LIMIT
    )
    const records = await authUserRepository.findMany({
      ids: query.userId,
      emails: query.emailAddress,
      limit,
    })
    return { data: records.map(toAuthUser) }
  },

  async updateUser(userId, update) {
    const current = await authUserRepository.findById(userId)
    if (!current) throw notFound(userId)
    const fields = nameFieldsForUpdate(current, update)
    return toAuthUser(await authUserRepository.update(userId, fields))
  },

  async updateUserProfileImage(userId, { file }) {
    const current = await authUserRepository.findById(userId)
    if (!current) throw notFound(userId)
    const storage = await getBlobStorage()
    const stored = await storage.put(
      `avatars/${userId}/avatar.${avatarExtension(file.type)}`,
      file,
      { access: 'public', contentType: file.type, addRandomSuffix: true }
    )
    return toAuthUser(
      await authUserRepository.update(userId, { image: stored.url })
    )
  },
}

export async function getUserDirectory(): Promise<UserDirectory> {
  return betterAuthUserDirectory
}

export async function createUserDirectory(): Promise<UserDirectory> {
  return betterAuthUserDirectory
}

/** Always configured: the directory is the app's own database. */
export function isUserDirectoryConfigured(): boolean {
  return true
}
