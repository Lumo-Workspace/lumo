/**
 * Request middleware entry point (LUM-1026), used by proxy.ts. Kept apart
 * from the @/lib/auth barrel so the proxy bundle never pulls in Prisma.
 * Implemented by Clerk today (./clerk/middleware).
 */
export {
  createAuthMiddleware,
  createRouteMatcher,
  type AuthMiddlewareHandler,
} from './clerk/middleware'
export type { MiddlewareAuth } from './types'
