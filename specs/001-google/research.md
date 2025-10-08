# Research: Google OAuth Login

**Feature**: `001-google` | **Date**: 2025-01-27  
**Phase**: 0 - Research & Technology Selection

## Overview

This document captures research findings for implementing Google OAuth 2.0 authentication using NextAuth.js (Auth.js) in a Next.js 15 application with Prisma ORM.

## Research Tasks

### 1. NextAuth.js Google OAuth Provider Configuration

**Decision**: Use NextAuth.js v4 (currently installed) with Google OAuth provider

**Rationale**:

- NextAuth.js is already installed (v4.24.11) and provides first-class Google OAuth support
- Built-in CSRF protection, session management, and JWT handling
- Seamless integration with Next.js App Router via route handlers
- Prisma adapter already available (@auth/prisma-adapter v2.10.0)
- Well-documented, widely adopted, and actively maintained

**Configuration Requirements**:

```typescript
// lib/auth/config.ts
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'

export const authOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile', // Minimal scopes as per SR-004
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
        },
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours (SR-005)
  },
  pages: {
    signIn: '/login',
    error: '/api/auth/error',
  },
}
```

**Environment Variables Required**:

- `GOOGLE_CLIENT_ID`: From Google Cloud Console OAuth 2.0 credentials
- `GOOGLE_CLIENT_SECRET`: From Google Cloud Console OAuth 2.0 credentials
- `NEXTAUTH_URL`: Application base URL (e.g., https://app.example.com)
- `NEXTAUTH_SECRET`: Random secret for JWT signing (generate with `openssl rand -base64 32`)

**Alternatives Considered**:

- **Passport.js**: More boilerplate, less Next.js-specific optimization
- **Auth0**: Third-party service adds cost and external dependency
- **Custom OAuth implementation**: Higher maintenance burden, reinventing the wheel

---

### 2. AES-256-GCM Token Encryption Implementation

**Decision**: Use Node.js built-in `crypto` module with AES-256-GCM cipher

**Rationale**:

- Native Node.js crypto module provides FIPS-compliant encryption
- AES-256-GCM offers authenticated encryption (prevents tampering)
- No additional dependencies required
- NextAuth.js JWT strategy already encrypts tokens, but we need additional encryption for OAuth refresh tokens stored in database

**Implementation Pattern**:

```typescript
// lib/auth/token-encryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, 'base64') // 32 bytes
const IV_LENGTH = 12 // GCM standard
const AUTH_TAG_LENGTH = 16

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // Format: iv:encrypted:authTag (all hex encoded)
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
}

export function decryptToken(ciphertext: string): string {
  const [ivHex, encrypted, authTagHex] = ciphertext.split(':')

  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, KEY, iv)

  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
```

**Environment Variables Required**:

- `TOKEN_ENCRYPTION_KEY`: Base64-encoded 32-byte key (generate with `openssl rand -base64 32`)

**Key Rotation Strategy**:

- Store `TOKEN_ENCRYPTION_KEY_CURRENT` and `TOKEN_ENCRYPTION_KEY_PREVIOUS`
- Encrypt new tokens with CURRENT key
- Attempt decryption with CURRENT first, fall back to PREVIOUS
- Migrate tokens on access (re-encrypt with new key)

**Alternatives Considered**:

- **libsodium/tweetnacl**: Additional dependency, overkill for this use case
- **AWS KMS**: Cloud dependency, adds latency and cost
- **Database-level encryption**: Doesn't protect keys in memory

---

### 3. Prisma Schema for NextAuth.js Adapter

**Decision**: Use standard NextAuth.js Prisma adapter schema with extensions

**Rationale**:

- NextAuth.js provides official Prisma adapter schema
- Follows established patterns for session and account management
- Supports account linking out of the box
- Extensions needed for encryption metadata and audit logging

**Schema Design**:

```prisma
// prisma/schema.prisma

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  image         String?
  accounts      Account[]
  sessions      Session[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@map("users")
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String  // "oauth"
  provider          String  // "google"
  providerAccountId String  // Google user ID
  refresh_token     String? @db.Text // Encrypted with AES-256-GCM
  access_token      String? @db.Text // Encrypted (short-lived, optional storage)
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  lastUsedAt        DateTime @default(now()) @updatedAt // Track token usage for SR-009

  @@unique([provider, providerAccountId])
  @@index([userId])
  @@map("accounts")
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt    DateTime @default(now())

  @@index([userId])
  @@map("sessions")
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
  @@map("verification_tokens")
}
```

**Migration Strategy**:

1. Create migration with `npx prisma migrate dev --name add_oauth_tables`
2. Existing users table may need reconciliation (check if User model exists)
3. Test migration on development database first
4. Backup production database before applying migration

**Alternatives Considered**:

- **Custom session storage**: More complex, loses NextAuth.js adapter benefits
- **Redis for sessions**: Adds infrastructure complexity, not needed for initial scale
- **Separate OAuth database**: Unnecessary complexity for current scope

---

### 4. Account Merging Strategy

**Decision**: Email-based automatic account merging with user confirmation

**Rationale**:

- FR-005 requires merging accounts when email matches
- Prevents duplicate accounts for same user
- Maintains data integrity during migration from password to OAuth
- User confirmation ensures security and transparency

**Implementation Flow**:

```typescript
// lib/auth/account-merging.ts

async function handleAccountMerge(
  googleEmail: string,
  googleProfile: GoogleProfile
): Promise<User> {
  // 1. Check if user with email exists (non-Google account)
  const existingUser = await prisma.user.findUnique({
    where: { email: googleEmail },
    include: { accounts: true },
  })

  if (!existingUser) {
    // No conflict, create new user
    return createNewGoogleUser(googleProfile)
  }

  // 2. Check if Google account already linked
  const hasGoogleAccount = existingUser.accounts.some(
    acc => acc.provider === 'google'
  )

  if (hasGoogleAccount) {
    // Already linked, just sign in
    return existingUser
  }

  // 3. Existing user without Google account - require confirmation
  // Store pending merge in session state
  // Redirect to confirmation page
  throw new AccountMergeRequiredError({
    existingUserId: existingUser.id,
    googleProfile,
  })
}
```

**User Confirmation Flow**:

1. User attempts Google login
2. System detects existing account with same email
3. Redirect to `/auth/merge-confirm` page
4. Display: "An account with {email} already exists. Link your Google account?"
5. User confirms → Link account and sign in
6. User cancels → Return to login with error message

**Security Considerations** (SR-013, SR-016):

- Email verification status check before merging
- Audit log entry for account merges
- Rate limiting on merge attempts
- CSRF token validation on confirmation

**Alternatives Considered**:

- **Manual linking only**: Doesn't meet FR-005 requirement for automatic detection
- **Always create new account**: Creates orphaned accounts, poor UX
- **Silent merge without confirmation**: Security risk, violates user consent

---

### 5. Rate Limiting for Authentication

**Decision**: IP-based rate limiting using Next.js middleware with in-memory LRU cache

**Rationale**:

- SR-006 requires 5 attempts per minute per IP
- Middleware runs before API route handlers (performance)
- LRU cache prevents memory bloat from IP tracking
- No external dependencies (Redis) needed for initial implementation

**Implementation Pattern**:

```typescript
// lib/auth/rate-limiter.ts
import { LRUCache } from 'lru-cache'

const rateLimitCache = new LRUCache<string, number[]>({
  max: 5000, // Track up to 5000 IPs
  ttl: 60 * 1000, // 1 minute TTL
})

export function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const attempts = rateLimitCache.get(ip) || []

  // Remove attempts older than 1 minute
  const recentAttempts = attempts.filter(
    timestamp => now - timestamp < 60 * 1000
  )

  if (recentAttempts.length >= 5) {
    return false // Rate limit exceeded
  }

  recentAttempts.push(now)
  rateLimitCache.set(ip, recentAttempts)
  return true
}

// middleware.ts
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/auth')) {
    const ip =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      'unknown'

    if (!checkRateLimit(ip)) {
      return new Response('Too many requests', { status: 429 })
    }
  }

  return NextResponse.next()
}
```

**Environment Considerations**:

- Vercel deployment: Use `x-forwarded-for` header
- Development: Use `x-real-ip` or connection remote address
- Production: Consider Vercel Edge Config or Upstash Redis for distributed rate limiting

**Monitoring**:

- Log rate limit violations (SR-019)
- Track per-IP metrics for abuse detection
- Alert on sustained high rate limit hits

**Alternatives Considered**:

- **Upstash Redis**: Better for distributed systems, adds cost and complexity
- **Vercel Edge Config**: Limited to Edge Runtime, not needed initially
- **Third-party service (Arcjet, Unkey)**: External dependency, added cost

---

### 6. CSRF Protection in NextAuth.js

**Decision**: Use built-in NextAuth.js CSRF protection (automatic)

**Rationale**:

- NextAuth.js automatically implements CSRF tokens for all OAuth flows (SR-007)
- Uses HTTP-only cookies with SameSite=Lax
- PKCE (Proof Key for Code Exchange) enabled by default for OAuth 2.0
- No additional implementation needed

**How It Works**:

1. NextAuth.js generates CSRF token on signin page load
2. Token stored in HTTP-only cookie (`__Host-next-auth.csrf-token`)
3. OAuth callback validates CSRF token from cookie matches state parameter
4. PKCE code_verifier/code_challenge provides additional protection

**Verification**:

- Check cookie flags: `HttpOnly; Secure; SameSite=Lax`
- Verify state parameter in OAuth callback URL
- Test CSRF attack scenarios in integration tests

**Additional Measures**:

- Ensure `NEXTAUTH_URL` environment variable matches production domain
- Use HTTPS in production (enforced by `Secure` cookie flag)
- Test with Cross-Origin requests to verify rejection

**Alternatives Considered**:

- **Custom CSRF implementation**: Unnecessary, NextAuth.js handles it
- **Double-submit cookie pattern**: Already implemented by NextAuth.js
- **Origin header validation**: Supplementary, not primary defense

---

### 7. Session Management and Token Refresh

**Decision**: JWT session strategy with automatic refresh via NextAuth.js callbacks

**Rationale**:

- JWT sessions avoid database lookups on every request (performance)
- NextAuth.js automatically refreshes access tokens when expired
- 24-hour session expiration meets SR-005 requirement
- Stateless authentication scales better

**Implementation**:

```typescript
// lib/auth/callbacks.ts
export const callbacks = {
  async jwt({ token, account, user }) {
    // Initial sign in
    if (account && user) {
      return {
        ...token,
        accessToken: account.access_token,
        refreshToken: account.refresh_token,
        accessTokenExpires: account.expires_at! * 1000,
        user,
      }
    }

    // Return previous token if not expired
    if (Date.now() < token.accessTokenExpires) {
      return token
    }

    // Access token expired, refresh it
    return refreshAccessToken(token)
  },

  async session({ session, token }) {
    session.user = token.user
    session.accessToken = token.accessToken
    session.error = token.error
    return session
  },
}

async function refreshAccessToken(token: any) {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      }),
    })

    const refreshedTokens = await response.json()

    if (!response.ok) throw refreshedTokens

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    }
  } catch (error) {
    return {
      ...token,
      error: 'RefreshAccessTokenError',
    }
  }
}
```

**Session Expiration Handling**:

- Frontend detects `session.error === "RefreshAccessTokenError"`
- Redirect to login page with message: "Session expired, please sign in again"
- Clear local session state

**Concurrent Session Limiting** (SR-015):

- Track active sessions in database
- On new login, check session count
- If ≥3 sessions, invalidate oldest session
- Implement via `signIn` callback

**Alternatives Considered**:

- **Database sessions**: Better for session invalidation, worse for performance
- **Redis sessions**: Adds infrastructure complexity
- **Short-lived JWTs without refresh**: Poor UX, frequent re-authentication

---

### 8. shadcn/ui OAuth Button Component

**Decision**: Use shadcn/ui Button component with custom Google branding

**Rationale**:

- shadcn/ui already installed and configured
- Radix UI primitives provide accessibility out of the box
- Customizable while maintaining design system consistency
- WCAG 2.1 AA compliant by default

**Component Pattern**:

```tsx
// components/auth/google-login-button.tsx
'use client'

import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Icons } from '@/components/ui/icons'

export function GoogleLoginButton() {
  return (
    <Button
      variant='outline'
      size='lg'
      onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
      className='w-full min-h-[44px] gap-2'
      aria-label='Sign in with Google'
    >
      <Icons.google className='h-5 w-5' />
      <span>Continue with Google</span>
    </Button>
  )
}
```

**Accessibility Requirements** (UX-036 to UX-040):

- Minimum touch target: 44px height (WCAG 2.1 AA)
- Keyboard navigable: Button component handles focus
- Screen reader friendly: aria-label describes action
- Color contrast: Ensure text passes WCAG AA (4.5:1 ratio)
- Focus visible: shadcn/ui provides focus ring

**Google Brand Guidelines**:

- Use official Google logo SVG
- Follow Google's button styling guidelines
- Display "Continue with Google" or "Sign in with Google"
- Maintain sufficient padding around logo

**Loading State**:

```tsx
const [isLoading, setIsLoading] = useState(false)

;<Button
  disabled={isLoading}
  onClick={async () => {
    setIsLoading(true)
    await signIn('google', { callbackUrl: '/dashboard' })
  }}
>
  {isLoading && <Icons.spinner className='mr-2 h-4 w-4 animate-spin' />}
  Continue with Google
</Button>
```

**Alternatives Considered**:

- **Third-party OAuth button library**: Unnecessary dependency
- **Custom styled button**: Loses shadcn/ui consistency
- **Unstyled HTML button**: Poor accessibility and UX

---

### 9. Error Handling Patterns for OAuth

**Decision**: Centralized error handling with user-friendly messages and retry mechanism

**Rationale**:

- SR-017 requires generic error messages (no sensitive info exposure)
- SR-018 requires exponential backoff for retries
- UX-015 requires user-friendly messaging with concrete examples

**Error Categorization**:

```typescript
// lib/auth/errors.ts
export enum OAuthErrorType {
  // User-actionable errors
  ACCESS_DENIED = 'access_denied', // User denied consent
  ACCOUNT_MERGE_REQUIRED = 'merge_required', // Existing account found

  // System errors
  GOOGLE_UNAVAILABLE = 'service_unavailable', // Google OAuth down
  CONFIGURATION_ERROR = 'configuration', // Missing env vars
  TOKEN_INVALID = 'token_invalid', // Token refresh failed
  RATE_LIMIT = 'rate_limit', // Too many attempts

  // Unknown
  UNKNOWN = 'unknown',
}

export const ERROR_MESSAGES: Record<OAuthErrorType, string> = {
  [OAuthErrorType.ACCESS_DENIED]:
    "You cancelled the sign-in process. Please try again if you'd like to continue.",
  [OAuthErrorType.ACCOUNT_MERGE_REQUIRED]:
    'An account with this email already exists. Would you like to link your Google account?',
  [OAuthErrorType.GOOGLE_UNAVAILABLE]:
    'Google sign-in is temporarily unavailable. Please try again in a moment.',
  [OAuthErrorType.CONFIGURATION_ERROR]:
    'Sign-in is not available right now. Please contact support.',
  [OAuthErrorType.TOKEN_INVALID]:
    'Your session has expired. Please sign in again.',
  [OAuthErrorType.RATE_LIMIT]:
    'Too many sign-in attempts. Please wait a moment and try again.',
  [OAuthErrorType.UNKNOWN]: 'Something went wrong. Please try again.',
}
```

**Error Display UI**:

```tsx
// app/api/auth/error/page.tsx
'use client'

import { useSearchParams } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

export default function AuthErrorPage() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error') as OAuthErrorType
  const message =
    ERROR_MESSAGES[error] || ERROR_MESSAGES[OAuthErrorType.UNKNOWN]

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <Alert variant='destructive' className='max-w-md'>
        <AlertCircle className='h-4 w-4' />
        <AlertTitle>Sign-in failed</AlertTitle>
        <AlertDescription className='mt-2'>{message}</AlertDescription>
        <Button
          variant='outline'
          className='mt-4'
          onClick={() => (window.location.href = '/login')}
        >
          Try again
        </Button>
      </Alert>
    </div>
  )
}
```

**Exponential Backoff Retry** (SR-018):

```typescript
// lib/auth/retry.ts
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1

      if (isLastAttempt) throw error

      const delay = Math.min(baseDelay * Math.pow(2, attempt), 16000)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw new Error('Max retries exceeded')
}
```

**Logging** (SR-019):

- Log timestamp, IP, user agent, error type (not sensitive details)
- Use structured logging (JSON format)
- Send to monitoring service (e.g., Vercel Analytics, Sentry)

**Alternatives Considered**:

- **Detailed error messages**: Violates SR-017, security risk
- **No retry mechanism**: Poor UX, doesn't meet SR-018
- **Automatic retry without user control**: Can cause infinite loops

---

### 10. WCAG 2.1 AA Compliance for Auth Flow

**Decision**: Implement comprehensive accessibility following WCAG 2.1 AA standards

**Rationale**:

- UX-012, UX-036-UX-040 mandate accessibility requirements
- Legal compliance (ADA, Section 508)
- Improves UX for all users, not just those with disabilities
- shadcn/ui provides accessible foundation

**Accessibility Checklist**:

**Keyboard Navigation** (UX-036):

- [x] All interactive elements reachable via Tab key
- [x] Focus visible indicator (outline/ring) on all focusable elements
- [x] Enter key activates buttons and links
- [x] Escape key closes dialogs and modals
- [x] Tab order follows logical reading order

**Screen Reader Support** (UX-037):

- [x] Semantic HTML elements (`<button>`, `<a>`, `<form>`)
- [x] ARIA labels for icon-only buttons
- [x] Live regions for dynamic error messages (`role="alert"`)
- [x] Form labels properly associated with inputs
- [x] Status announcements for loading states

**Color Contrast** (UX-038):

- [x] Text contrast ratio ≥ 4.5:1 (normal text)
- [x] Large text contrast ratio ≥ 3:1 (18pt+ or 14pt bold)
- [x] Focus indicators contrast ratio ≥ 3:1
- [x] Test with automated tools (axe, Lighthouse)
- [x] Verify in grayscale mode

**Touch Targets** (UX-039):

- [x] Minimum 44x44px touch target size
- [x] Adequate spacing between interactive elements (8px+)
- [x] Buttons sized appropriately: `size="lg"` for primary actions

**Error Handling**:

```tsx
// Accessible error display
<Alert role="alert" aria-live="assertive">
  <AlertTitle>Error</AlertTitle>
  <AlertDescription id="error-description">
    {errorMessage}
  </AlertDescription>
</Alert>

// Button with error association
<Button
  aria-describedby={error ? "error-description" : undefined}
  aria-invalid={error ? "true" : "false"}
>
  Sign in
</Button>
```

**Loading State Announcements**:

```tsx
<Button disabled={isLoading}>
  {isLoading && (
    <>
      <span className='sr-only'>Signing in, please wait</span>
      <Icons.spinner className='animate-spin' aria-hidden='true' />
    </>
  )}
  Continue with Google
</Button>
```

**Form Labels**:

```tsx
// Even though it's OAuth (no form fields), error recovery may need fields
<Label htmlFor="email">Email address</Label>
<Input
  id="email"
  type="email"
  aria-required="true"
  aria-describedby="email-error"
/>
{emailError && (
  <p id="email-error" className="text-destructive" role="alert">
    {emailError}
  </p>
)}
```

**Testing Tools**:

- **Automated**: axe DevTools, Lighthouse, WAVE
- **Manual**: Keyboard-only navigation, screen reader (NVDA/VoiceOver)
- **User testing**: Include users with disabilities in testing

**Alternatives Considered**:

- **Basic accessibility only**: Doesn't meet WCAG 2.1 AA requirement
- **AAA standard**: Exceeds current requirement, can iterate later
- **Third-party accessibility overlay**: Poor solution, doesn't fix underlying issues

---

## Technology Stack Summary

| Component        | Technology                   | Version  | Rationale                              |
| ---------------- | ---------------------------- | -------- | -------------------------------------- |
| Authentication   | NextAuth.js                  | 4.24.11  | Industry standard, Next.js integration |
| OAuth Provider   | Google OAuth 2.0             | -        | Required by feature spec               |
| Database ORM     | Prisma                       | 6.17.0   | Existing project standard, type safety |
| Database Adapter | @auth/prisma-adapter         | 2.10.0   | Official NextAuth.js adapter           |
| Encryption       | Node.js crypto               | Built-in | AES-256-GCM support, no dependencies   |
| UI Framework     | shadcn/ui                    | Latest   | Project standard, WCAG compliant       |
| Testing          | Jest + React Testing Library | 29.7.0   | Existing project standard              |
| Rate Limiting    | LRU Cache                    | Built-in | Simple, no infrastructure needed       |
| Session Storage  | JWT (HTTP-only cookies)      | -        | Stateless, scalable                    |

## Security Considerations Summary

| Requirement        | Implementation                       | Standard       |
| ------------------ | ------------------------------------ | -------------- |
| Token Encryption   | AES-256-GCM with Node.js crypto      | SR-001, SR-002 |
| HTTPS Enforcement  | TLS 1.3 minimum, Secure cookies      | SR-003         |
| OAuth Scopes       | openid, email, profile only          | SR-004         |
| Session Expiration | 24 hours with auto-refresh           | SR-005         |
| Rate Limiting      | 5 attempts/min/IP                    | SR-006         |
| CSRF Protection    | NextAuth.js built-in + PKCE          | SR-007         |
| Data Minimization  | Name, email, picture only            | SR-008         |
| Token Cleanup      | Auto-delete after 30 days inactivity | SR-009         |
| GDPR Compliance    | Data export (JSON) + deletion        | SR-010, SR-011 |
| Audit Logging      | Timestamp, IP, user agent, result    | SR-019         |

## Performance Targets

| Metric                      | Target      | Implementation                         |
| --------------------------- | ----------- | -------------------------------------- |
| OAuth Flow Completion       | <30 seconds | NextAuth.js optimized flow             |
| Page Load Time              | <2 seconds  | Next.js SSR/SSG, optimized assets      |
| Interaction Response        | <100ms      | Client-side state management           |
| Task Completion Rate        | >95%        | User-friendly error handling, clear UX |
| Authentication Success Rate | 95%+        | Robust error handling, retry logic     |

## Next Steps

This research phase is complete. Proceed to:

- **Phase 1**: Generate data-model.md and API contracts
- **Phase 1**: Update agent context with new technologies
- **Phase 2**: Generate tasks.md for implementation (via `/speckit.tasks`)

All NEEDS CLARIFICATION items from Technical Context have been resolved.
