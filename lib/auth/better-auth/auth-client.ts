/**
 * LUM-1027 — the browser-side Better Auth client (same origin, /api/auth).
 * Created on first use, never during module load.
 */
import { createAuthClient } from 'better-auth/react'
import { BETTER_AUTH_BASE_PATH } from './config'

let client: ReturnType<typeof createAuthClient> | null = null

export function getAuthClient() {
  client ??= createAuthClient({ basePath: BETTER_AUTH_BASE_PATH })
  return client
}
