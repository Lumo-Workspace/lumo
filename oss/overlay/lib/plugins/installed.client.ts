/**
 * The client plugins this deployment ships with: none.
 *
 * The browser-side twin of `installed.ts`: a static list, never loaded by
 * name. With an empty list every plugin slot renders nothing.
 */
import type { LumoClientPlugin } from '@/lib/plugins/client'

export const INSTALLED_CLIENT_PLUGINS: readonly LumoClientPlugin[] = []
