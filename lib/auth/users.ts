/**
 * User directory entry point (LUM-1026): server-side user lookups and
 * profile writes. Implemented by Clerk today (./clerk/users).
 */
export {
  getUserDirectory,
  createUserDirectory,
  isUserDirectoryConfigured,
} from './clerk/users'
export type {
  AuthEmailAddress,
  AuthUser,
  UserDirectory,
  UserListQuery,
  UserNameUpdate,
} from './types'
