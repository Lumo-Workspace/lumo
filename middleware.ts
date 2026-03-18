import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/(.*)',
])

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth()
  const { pathname } = request.nextUrl

  // Redirect unauthenticated users from "/" to sign-in
  if (!userId && pathname === '/') {
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  // Protect all non-public routes
  if (!isPublicRoute(request)) {
    await auth.protect()
  }

  // Redirect authenticated users away from sign-in/sign-up to dashboard
  if (userId && (pathname === '/' || pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up'))) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Authenticated but no workspace → redirect to onboarding
  // (except if already going to /onboarding or /settings or /dashboard)
  if (userId) {
    const isOnboarding = pathname.startsWith('/onboarding')
    const isSettings = pathname.startsWith('/settings')
    const isDashboard = pathname.startsWith('/dashboard')

    // Workspace check will be implemented in Sprint 2
    // For now, allow all authenticated users through
    void isOnboarding
    void isSettings
    void isDashboard
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
     * - public folder assets (svg, png, jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
}
