/**
 * The server plugins this deployment ships with: none.
 *
 * A static list, never loaded by name: Next.js / Turbopack cannot resolve a
 * variable `import()`, and a static list keeps type checking and
 * tree-shaking working. Every extension point of `lib/plugins/` works with
 * an empty list — the core then runs only its own (baseline) behaviour.
 */
import type { LumoServerPlugin } from '@/lib/plugins/types'

export const INSTALLED_SERVER_PLUGINS: readonly LumoServerPlugin[] = []
