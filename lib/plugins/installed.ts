/**
 * LUM-1061 (RFC §3.3) — the server plugins this deployment ships with.
 *
 * A static list, never loaded by name: Next.js / Turbopack cannot resolve a
 * variable `import()`, and a static list keeps type checking and
 * tree-shaking working. The open-source snapshot replaces this file with an
 * empty list (`export const INSTALLED_SERVER_PLUGINS = []`, RFC §7 PR6); the
 * core must behave correctly with either.
 */
import { securityPlugin } from '@/ee/security/server'
import type { LumoServerPlugin } from './types'

export const INSTALLED_SERVER_PLUGINS: readonly LumoServerPlugin[] = [
  securityPlugin,
]
