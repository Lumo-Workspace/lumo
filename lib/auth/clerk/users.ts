/**
 * Clerk implementation of the user directory (LUM-1026).
 *
 * The SDK is imported lazily, exactly as most call sites did before, so a
 * module that merely imports this one never loads the Clerk backend SDK.
 */
import type { UserDirectory } from '../types'

const SECRET_KEY_ENV = 'CLERK_SECRET_KEY'

interface ClerkBackend {
  users: UserDirectory
}

function directoryOf(client: ClerkBackend): UserDirectory {
  return {
    getUser: userId => client.users.getUser(userId),
    getUserList: query => client.users.getUserList(query),
    updateUser: (userId, update) => client.users.updateUser(userId, update),
    updateUserProfileImage: (userId, params) =>
      client.users.updateUserProfileImage(userId, params),
  }
}

/**
 * The directory for the current request (Clerk's request-aware
 * `clerkClient()`). Use from routes, server components and services.
 */
export async function getUserDirectory(): Promise<UserDirectory> {
  const { clerkClient } = await import('@clerk/nextjs/server')
  return directoryOf(await clerkClient())
}

/**
 * A standalone directory built from the server secret key (Clerk's
 * `createClerkClient`), for code that runs outside a request — Slack
 * handlers, background notifications, repositories.
 */
export async function createUserDirectory(): Promise<UserDirectory> {
  const { createClerkClient } = await import('@clerk/nextjs/server')
  return directoryOf(
    createClerkClient({ secretKey: process.env[SECRET_KEY_ENV]! })
  )
}

/** Whether `createUserDirectory()` has the credentials it needs. */
export function isUserDirectoryConfigured(): boolean {
  return Boolean(process.env[SECRET_KEY_ENV])
}
