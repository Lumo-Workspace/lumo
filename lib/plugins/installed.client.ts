/**
 * LUM-1062 (RFC §3.3) — the client plugins this deployment ships with.
 *
 * The browser-side twin of `installed.ts`: a static list, never loaded by
 * name. The open-source snapshot replaces this file with an empty list
 * (`export const INSTALLED_CLIENT_PLUGINS = []`, RFC §7 PR6); every slot then
 * renders nothing.
 */
import { securityClientPlugin } from '@/ee/security/client'
import type { LumoClientPlugin } from './client'

export const INSTALLED_CLIENT_PLUGINS: readonly LumoClientPlugin[] = [
  securityClientPlugin,
]
