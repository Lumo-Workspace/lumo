import {
  createAuthMiddleware,
  createRouteMatcher,
  localModeEntryRedirect,
} from '@/lib/auth/middleware'
import { NextResponse } from 'next/server'
import { requireWorkflowDeliveryAuth } from '@/lib/api/workflow-delivery-auth'
import { cliVersionDenied } from '@/lib/api/cli-version-gate'

export const PUBLIC_ROUTES = [
  '/signin(.*)',
  '/signup(.*)',
  // Forgot / reset password (LUM-1070).
  '/reset-password(.*)',
  '/api/(.*)',
  '/invite(.*)',
  '/share(.*)',
  // OAuth metadata for MCP clients (RFC 8414, RFC 9728), plus the Workflow
  // SDK's delivery routes — those are gated below when self-hosted (LUM-1031).
  '/.well-known/(.*)',
  '/security', // public trust page (LUM-856)
]

const isPublicRoute = createRouteMatcher(PUBLIC_ROUTES)

// The MCP OAuth consent screen (LUM-1044) must never render inside another
// site's frame, or a hidden Allow button could be clickjacked.
const isOAuthConsentRoute = createRouteMatcher(['/oauth/consent(.*)'])
const NO_FRAMING_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
}

// Dev-only design-system catalog (LUM-291). Public in development so it renders
// without signing in; in production the page itself returns notFound(), so the
// route never exists there and this exception is inert.
const isDesignSystemRoute = createRouteMatcher(['/design-system(.*)'])

export default createAuthMiddleware(async (auth, request) => {
  // Self-hosted workflow deliveries must present WORKFLOW_SECRET (LUM-1031).
  // Checked before anything else so a public /.well-known/ route cannot
  // reach a workflow step without it.
  const workflowDenied = requireWorkflowDeliveryAuth(request)
  if (workflowDenied) return workflowDenied

  // A CLI known to be incompatible gets a 426 naming `lumo update` (LUM-1110).
  // Compatibility only: requests without X-Lumo-Cli-Version pass, and the
  // header never reaches authentication below.
  const cliTooOld = cliVersionDenied(request)
  if (cliTooOld) return cliTooOld

  const userId = await auth.userId()
  const { pathname } = request.nextUrl

  if (process.env.NODE_ENV !== 'production' && isDesignSystemRoute(request)) {
    return NextResponse.next()
  }

  // LUMO_MODE=local (LUM-1335): no sign-in page, the visit signs itself in.
  const localEntry = localModeEntryRedirect(request, userId)
  if (localEntry) return localEntry

  // Protect all non-public routes (landing page "/" is always public)
  if (!isPublicRoute(request) && pathname !== '/') {
    await auth.protect()
  }

  // Redirect authenticated users away from signin/signup to workspace
  if (
    userId &&
    (pathname === '/' ||
      pathname.startsWith('/signin') ||
      pathname.startsWith('/signup'))
  ) {
    return NextResponse.redirect(new URL('/workspace', request.url))
  }

  if (isOAuthConsentRoute(request)) {
    return NextResponse.next({ headers: NO_FRAMING_HEADERS })
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static  (static files)
     * - _next/image   (image optimization)
     * - favicon.ico
     * - public folder assets (svg, png, jpg, jpeg, gif, webp, ico, woff,
     *   woff2, yml, yaml, txt, md, json, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|yml|yaml|txt|md|json)$).*)',
  ],
}
