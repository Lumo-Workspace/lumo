import {
  renderPublicConfigScript,
  resolvePublicConfig,
} from '@/lib/config/public-config'

// LUM-1325: read the environment per request, never at build time — this is
// what lets one prebuilt image serve any domain.
export const dynamic = 'force-dynamic'

/**
 * Browser-visible deployment config as a script that sets
 * `window.__LUMO_PUBLIC_CONFIG__`; the root layout loads it before hydration.
 * Public by design: it carries only NEXT_PUBLIC_* values.
 */
export function GET(): Response {
  return new Response(renderPublicConfigScript(resolvePublicConfig()), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Short so a changed URL reaches browsers soon after a restart.
      'Cache-Control': 'public, max-age=300',
    },
  })
}
