import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/signin(.*)',
  '/signup(.*)',
  '/api/(.*)',
  '/invite(.*)',
  '/share(.*)',
  '/.well-known/(.*)', // OAuth metadata for MCP clients (RFC 8414, RFC 9728)
])

// Dev-only design-system catalog (LUM-291). Public in development so it renders
// without signing in; in production the page itself returns notFound(), so the
// route never exists there and this exception is inert.
const isDesignSystemRoute = createRouteMatcher(['/design-system(.*)'])

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth()
  const { pathname } = request.nextUrl

  if (process.env.NODE_ENV !== 'production' && isDesignSystemRoute(request)) {
    return NextResponse.next()
  }

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
