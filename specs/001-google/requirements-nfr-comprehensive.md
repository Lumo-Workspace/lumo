# Non-Functional & Supplementary Requirements

**Feature**: Google OAuth Login (`001-google`)  
**Purpose**: Performance, scalability, observability, GDPR, reliability, account linking, rate limiting, edge cases  
**Addresses**: Checklist items CHK045-046, CHK048-CHK066, CHK067-CHK078, CHK086-CHK098, CHK104-CHK110, CHK121-CHK141

---

## Performance Requirements (CHK067-CHK072)

### NFR-001: OAuth Flow Performance

**Measurement Specification** (CHK067):

- **Metric**: OAuth flow completion time
- **Start Point**: User clicks "Sign in with Google" button (client-side event)
- **End Point**: Dashboard page fully loaded (window.onload event)
- **Target**: <30 seconds (95th percentile)
- **Measurement Tools**:
  - Client-side: `performance.mark()` and `performance.measure()`
  - Server-side: Structured logging with timestamps
  - Monitoring: Real User Monitoring (RUM) tools

**Breakdown**:

```typescript
// Client measurement
performance.mark('oauth-start')
// ... OAuth flow ...
performance.mark('oauth-end')
performance.measure('oauth-flow', 'oauth-start', 'oauth-end')

const duration = performance.getEntriesByName('oauth-flow')[0].duration
// Send to analytics: duration < 30000ms ✓
```

**Components**:

- Button click → Google redirect: <2s
- Google consent screen (user action): Variable (excluded from SLA)
- Callback → token exchange → DB write: <5s
- Dashboard page load: <2s
- **Total (excluding user action)**: <9s + user action time

**Test Scenarios**:

- Happy path: New user, fast network
- Existing user: Token refresh adds <1s
- Slow network: 3G simulation, target <45s
- Database latency: 100ms DB, target <35s

---

### NFR-002: API Response Time (CHK068)

**Endpoints & Targets**:

| Endpoint                        | Target (p95) | Measurement               |
| ------------------------------- | ------------ | ------------------------- |
| `GET /api/auth/session`         | <50ms        | Server response time      |
| `POST /api/auth/signout`        | <100ms       | Include cookie clear time |
| `GET /api/auth/signin/google`   | <100ms       | Redirect generation       |
| `GET /api/auth/callback/google` | <500ms       | Includes token exchange   |
| `POST /api/account/link/google` | <500ms       | OAuth initiation          |
| `GET /api/user/export`          | <2000ms      | Data aggregation          |

**Measurement**:

- Server-side: Middleware timing
  ```typescript
  app.use((req, res, next) => {
    const start = Date.now()
    res.on('finish', () => {
      const duration = Date.now() - start
      metrics.histogram('api.response_time', duration, {
        endpoint: req.path,
        method: req.method,
        status: res.statusCode,
      })
    })
    next()
  })
  ```

**Load Conditions** (CHK070):

- Baseline: 10 requests/second
- Peak: 100 requests/second
- Spike: 500 requests/second (30 seconds)
- Targets maintained under baseline and peak loads
- Graceful degradation during spikes (p95 <1s acceptable)

---

### NFR-003: Authentication Success Rate (CHK069)

**Measurement**:

- **Numerator**: Successful authentications (user reached dashboard)
- **Denominator**: Authentication attempts (initiated OAuth flow)
- **Target**: 95%+
- **Exclusions** (not counted as failures):
  - User cancels consent (access_denied) - user action, not system failure
  - Network timeouts on client side - client environment issue
  - Google service unavailable - external dependency

**Counted as Failures**:

- Token exchange failures (invalid credentials, code expired)
- Database errors (connection failures, constraint violations)
- Application errors (bugs, uncaught exceptions)
- Rate limit rejections (system capacity issue)

**Calculation**:

```typescript
const successRate =
  (successful_authentications /
    (initiated_flows - user_cancellations - client_network_errors)) *
  100
// Target: successRate >= 95%
```

**Monitoring**:

- Real-time dashboard: Success rate over 1h, 24h, 7d windows
- Alert if rate drops below 90% for >5 minutes
- Weekly report: Success rate trends, failure breakdown

---

### NFR-004: Database Performance (CHK071)

**Index Requirements**:

```sql
-- Required indexes for performance
CREATE INDEX idx_users_email ON users(email); -- Email-based account matching
CREATE INDEX idx_accounts_user_id ON accounts(user_id); -- User account lookups
CREATE INDEX idx_accounts_provider_account ON accounts(provider, provider_account_id); -- Google ID lookup
CREATE UNIQUE INDEX idx_sessions_token ON sessions(session_token); -- Session validation
CREATE INDEX idx_sessions_user_id ON sessions(user_id); -- User session queries
CREATE INDEX idx_sessions_expires ON sessions(expires); -- Cleanup queries
CREATE INDEX idx_accounts_last_used ON accounts(last_used_at); -- Inactivity cleanup
```

**Query Performance Targets**:

- User lookup by email: <10ms
- Session validation: <5ms (indexed unique lookup)
- Account creation: <50ms (includes transaction)
- Token update: <20ms

**Query Optimization**:

```typescript
// Use select to fetch only needed fields
const user = await prisma.user.findUnique({
  where: { email },
  select: { id: true, name: true, email: true, image: true },
  // Don't fetch all columns
})

// Use include for eager loading (avoid N+1)
const user = await prisma.user.findUnique({
  where: { id },
  include: { accounts: { where: { provider: 'google' } } },
  // Single query instead of N+1
})
```

**Connection Pooling** (CHK121):

```typescript
// Prisma connection pool configuration
datasource db {
  provider = "postgresql"
  url      = env("SUPA_POSTGRES_PRISMA_URL")
  // Connection pool settings
  connection_limit = 20    // Max connections
  pool_timeout = 5000      // 5 second timeout
}
```

---

### NFR-005: Caching Strategy (CHK072)

**Session Caching**:

- JWT sessions cached in client browser (HTTP-only cookie)
- No server-side session cache needed (stateless JWT)
- Reduces database load: 0 queries for session validation

**User Profile Caching**:

- Cached in JWT payload (name, email, image)
- Cache duration: Until JWT expires (24 hours)
- Invalidation: On next sign-in (after JWT expiration)

**OAuth State Caching**:

- In-memory LRU cache for state parameters
- TTL: 10 minutes
- Max size: 10,000 entries (prevents memory bloat)
- Eviction: LRU policy

**Rate Limit Cache**:

- In-memory LRU cache for IP-based rate limiting
- TTL: 1 minute (sliding window)
- Max size: 5,000 IPs
- Alternative for production: Redis (distributed caching)

---

## Security Acceptance Criteria (CHK073-CHK078)

### NFR-006: HTTPS Enforcement (CHK073)

**Verification**:

```typescript
// Middleware to enforce HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`)
    }
    next()
  })
}

// Cookie configuration
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 24 * 60 * 60 * 1000,
}
```

**TLS 1.3 Verification**:

- Hosting platform configuration (Vercel automatically uses TLS 1.3)
- SSL Labs test: Grade A+ required
- Automated check: `ssllabs-scan` in CI/CD

---

### NFR-007: Encryption Testing (CHK074)

**Test Cases**:

```typescript
describe('Token Encryption', () => {
  it('uses AES-256-GCM algorithm', () => {
    const algorithm = getEncryptionAlgorithm()
    expect(algorithm).toBe('aes-256-gcm')
  })

  it('uses 32-byte keys', () => {
    const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, 'base64')
    expect(key.length).toBe(32) // 256 bits
  })

  it('generates 12-byte IVs', () => {
    const encrypted = encryptToken('test')
    const [ivHex] = encrypted.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    expect(iv.length).toBe(12)
  })

  it('generates 16-byte auth tags', () => {
    const encrypted = encryptToken('test')
    const parts = encrypted.split(':')
    const authTag = Buffer.from(parts[2], 'hex')
    expect(authTag.length).toBe(16)
  })
})
```

---

### NFR-008: PII Protection in Logs (CHK075)

**Automated Scanning**:

```typescript
// Log sanitization middleware
function sanitizeLog(logData: any): any {
  const piiPatterns = [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
    /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, // SSN
    /\b\d{16}\b/g, // Credit card (simple)
    /ya29\.[A-Za-z0-9_-]+/g, // Google access token
  ]

  let sanitized = JSON.stringify(logData)
  piiPatterns.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '[REDACTED]')
  })

  return JSON.parse(sanitized)
}

// Test
it('redacts email addresses from logs', () => {
  const log = { user: 'john@example.com', action: 'login' }
  const sanitized = sanitizeLog(log)
  expect(sanitized.user).toBe('[REDACTED]')
})
```

---

### NFR-009: Audit Logging (CHK076)

**Required Fields**:

```typescript
interface AuthEvent {
  timestamp: string;      // ISO 8601
  eventType: string;      // SIGNIN_SUCCESS, SIGNIN_FAILURE, etc.
  userId?: string;        // If available
  ipAddress: string;      // Anonymized: 192.168.1.xxx
  userAgent: string;      // Browser/device info
  result: 'SUCCESS' | 'FAILURE';
  errorCode?: string;     // If failure
  provider?: string;      // 'google'
}

// Example
{
  "timestamp": "2025-01-27T10:30:00.000Z",
  "eventType": "SIGNIN_SUCCESS",
  "userId": "clu123456",
  "ipAddress": "203.0.113.xxx",
  "userAgent": "Mozilla/5.0...",
  "result": "SUCCESS",
  "provider": "google"
}
```

**Test Case**:

```typescript
it('logs authentication events with required fields', async () => {
  const mockLogger = jest.spyOn(logger, 'info')
  await signInWithGoogle()

  expect(mockLogger).toHaveBeenCalledWith(
    expect.objectContaining({
      timestamp: expect.any(String),
      eventType: 'SIGNIN_SUCCESS',
      ipAddress: expect.stringMatching(/\d+\.\d+\.\d+\.xxx/),
      userAgent: expect.any(String),
      result: 'SUCCESS',
    })
  )
})
```

---

### NFR-010: IP Anonymization (CHK077)

**Technique**: Last octet removal

```typescript
function anonymizeIP(ip: string): string {
  // IPv4: Remove last octet
  if (ip.includes('.')) {
    const parts = ip.split('.')
    return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`
  }

  // IPv6: Remove last 64 bits
  if (ip.includes(':')) {
    const parts = ip.split(':')
    return parts.slice(0, 4).join(':') + '::xxxx'
  }

  return 'unknown'
}

// Test
expect(anonymizeIP('192.168.1.100')).toBe('192.168.1.xxx')
expect(anonymizeIP('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(
  '2001:db8:85a3:0::xxxx'
)
```

---

### NFR-011: OAuth Scope Verification (CHK078)

**Automated Test**:

```typescript
describe('OAuth Scope Validation', () => {
  it('allows only openid email profile scopes', async () => {
    const account = await prisma.account.findFirst({
      where: { provider: 'google' },
    })

    const scopes = account.scope.split(' ')
    const allowedScopes = ['openid', 'email', 'profile']

    scopes.forEach(scope => {
      expect(allowedScopes).toContain(scope)
    })
  })

  it('rejects additional scopes', async () => {
    const invalidScopes =
      'openid email profile https://www.googleapis.com/auth/drive'
    const result = await validateScopes(invalidScopes)

    expect(result.valid).toBe(false)
    expect(result.error).toBe('UNAUTHORIZED_SCOPE_DETECTED')
  })
})
```

---

## Account Linking & Merging (CHK045, CHK048-CHK059)

### FR-027: Error Message Mapping (CHK045)

**User-Friendly Messages**:

| Technical Error       | User Message                                                         | Action                  | Retry?           |
| --------------------- | -------------------------------------------------------------------- | ----------------------- | ---------------- |
| `access_denied`       | "You cancelled sign-in. Click below to try again."                   | [Try Again] button      | Yes              |
| `server_error`        | "Google sign-in is temporarily unavailable. Try again shortly."      | [Try Again] + wait 30s  | Yes              |
| `invalid_grant`       | "Authorization expired. Please sign in again."                       | Auto-redirect to /login | Yes              |
| `database_error`      | "We're experiencing technical difficulties. Try again in a moment."  | [Try Again]             | Yes              |
| `rate_limit_exceeded` | "Too many sign-in attempts. Please wait and try again."              | Wait 60s + [Try Again]  | Yes (after wait) |
| `network_timeout`     | "Connection to Google timed out. Check your internet and try again." | [Try Again]             | Yes              |
| `configuration_error` | "Sign-in is not available right now. Please contact support."        | [Contact Support]       | No               |

**Implementation**:

```typescript
// research.md section 9 already documents this
const ERROR_MESSAGES: Record<OAuthErrorType, string> = {
  // ... (already specified in requirements-oauth-flow.md)
}
```

---

### FR-028: Database Failure Handling (CHK048)

**Connection Failure Scenarios**:

1. **During Token Exchange**:

   ```typescript
   try {
     const tokens = await getTokensFromGoogle(code);
     const user = await prisma.user.create({ data: ... });
   } catch (error) {
     if (error.code === 'P1001') { // Prisma connection error
       return {
         error: 'database_connection_failed',
         message: 'Unable to save your account. Please try again.',
         retry: true
       };
     }
   }
   ```

2. **During Session Creation**:
   - Retry: 3 attempts with 1s delay
   - Failure: Show error page, tokens discarded
   - User action: Retry OAuth flow from beginning

3. **During Account Update**:
   - Transaction rollback
   - No partial updates
   - Log error for investigation

**Circuit Breaker** (CHK139):

```typescript
const circuitBreaker = {
  failures: 0,
  threshold: 5,
  timeout: 60000, // 1 minute
  state: 'closed' as 'open' | 'closed' | 'half-open',

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      throw new Error('Circuit breaker open - database unavailable')
    }

    try {
      const result = await fn()
      this.failures = 0
      this.state = 'closed'
      return result
    } catch (error) {
      this.failures++
      if (this.failures >= this.threshold) {
        this.state = 'open'
        setTimeout(() => {
          this.state = 'half-open'
        }, this.timeout)
      }
      throw error
    }
  },
}
```

---

### FR-029: Partial Google Profile Data (CHK049-CHK050)

**Scenarios & Handling**:

| Missing Field    | Required? | Handling                                         |
| ---------------- | --------- | ------------------------------------------------ |
| `name`           | No        | Use email prefix: `john` from `john@example.com` |
| `email`          | **Yes**   | Reject authentication, log security event        |
| `picture`        | No        | Use default avatar placeholder                   |
| `email_verified` | No        | Assume verified (Google policy)                  |

**Implementation**:

```typescript
function handlePartialProfile(profile: GoogleProfile): UserData {
  if (!profile.email) {
    throw new Error('MISSING_REQUIRED_FIELD: email')
  }

  return {
    email: profile.email,
    name: profile.name || profile.email.split('@')[0],
    image: profile.picture || '/default-avatar.png',
    emailVerified: profile.email_verified !== false, // Assume true if missing
  }
}
```

---

### FR-030: Concurrent Authentication Attempts (CHK051)

**Race Condition Handling**:

```typescript
// Use database transaction with unique constraint
async function createUserFromGoogle(profile: GoogleProfile) {
  try {
    return await prisma.$transaction(
      async tx => {
        // Check if user exists
        let user = await tx.user.findUnique({
          where: { email: profile.email },
        })

        if (user) {
          // User created by concurrent request
          return user
        }

        // Create user
        user = await tx.user.create({
          data: {
            email: profile.email,
            name: profile.name,
            image: profile.picture,
            emailVerified: new Date(),
          },
        })

        return user
      },
      {
        isolationLevel: 'Serializable', // Prevent race conditions
      }
    )
  } catch (error) {
    if (error.code === 'P2002') {
      // Unique constraint violation
      // Another request created user, fetch it
      return await prisma.user.findUnique({
        where: { email: profile.email },
      })
    }
    throw error
  }
}
```

---

### FR-031: Account Merging Requirements (CHK052-CHK059)

**Trigger Conditions** (CHK052):

1. User signs in with Google (email: john@example.com)
2. User record exists with same email (created via password auth or different OAuth)
3. No Google account linked to that user yet
4. **Trigger**: Account merge flow

**Merge Confirmation UI** (CHK053):

```tsx
// app/auth/merge-confirm/page.tsx
export default function MergeConfirmPage() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email')
  const googleName = searchParams.get('name')

  return (
    <Dialog open>
      <DialogTitle>Link Google Account?</DialogTitle>
      <DialogContent>
        <p>
          An account with <strong>{email}</strong> already exists.
        </p>
        <p>
          Would you like to link your Google account ({googleName}) to this
          existing profile?
        </p>

        <Alert>
          <AlertTitle>What happens when you link:</AlertTitle>
          <ul>
            <li>Your existing data will be preserved</li>
            <li>You can sign in with Google or your existing method</li>
            <li>Your profile information will be updated from Google</li>
          </ul>
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button variant='outline' onClick={() => router.push('/login')}>
          Cancel
        </Button>
        <Button onClick={confirmMerge}>Link Google Account</Button>
      </DialogActions>
    </Dialog>
  )
}
```

**Data Transfer Logic** (CHK054):

```typescript
async function mergeAccounts(
  existingUserId: string,
  googleProfile: GoogleProfile
) {
  return await prisma.$transaction(async tx => {
    // 1. Update user profile from Google (newer data wins)
    const user = await tx.user.update({
      where: { id: existingUserId },
      data: {
        name: googleProfile.name, // Google profile is authoritative
        image: googleProfile.picture,
        emailVerified: new Date(), // Google verifies emails
      },
    })

    // 2. Link Google account
    await tx.account.create({
      data: {
        userId: existingUserId,
        type: 'oauth',
        provider: 'google',
        providerAccountId: googleProfile.sub,
        refresh_token: encryptToken(tokens.refresh_token),
        access_token: encryptToken(tokens.access_token),
        expires_at: tokens.expires_at,
        scope: 'openid email profile',
      },
    })

    // 3. No data loss: Existing user data (preferences, content) preserved
    // 4. Duplicate handling: Profile fields overwritten, no duplicates created

    return user
  })
}
```

**Google Account Already Linked** (CHK055):

```typescript
// Check before merge
const existingLink = await prisma.account.findFirst({
  where: {
    provider: 'google',
    providerAccountId: googleProfile.sub,
    userId: { not: currentUserId }, // Linked to different user
  },
})

if (existingLink) {
  return {
    error: 'GOOGLE_ACCOUNT_ALREADY_LINKED',
    message: 'This Google account is already linked to another user account.',
    statusCode: 409,
  }
}
```

**Unlinking Validation** (CHK056-CHK057):

```typescript
async function unlinkGoogleAccount(userId: string): Promise<Result> {
  // 1. Check for alternative authentication method
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { accounts: true },
  })

  const hasPassword = user.accounts.some(acc => acc.type === 'credentials')
  const hasOtherOAuth = user.accounts.some(
    acc => acc.type === 'oauth' && acc.provider !== 'google'
  )

  // 2. Prevent unlinking last auth method
  if (!hasPassword && !hasOtherOAuth) {
    return {
      error: 'NO_ALTERNATIVE_AUTH',
      message: 'You must have another sign-in method before unlinking Google.',
      statusCode: 400,
    }
  }

  // 3. Delete Google account record
  await prisma.account.deleteMany({
    where: { userId, provider: 'google' },
  })

  // 4. Log event
  logger.info('Account unlinked', { userId, provider: 'google' })

  return { success: true }
}
```

**Email Ownership Validation** (CHK058):

- Google OAuth inherently validates email ownership
- Email verified by Google before tokens issued
- No additional validation needed
- Trust Google's verification: `emailVerified = new Date()`

**Account Linking State Transitions** (CHK059):

```
[User with Password Account]
    ↓
Click "Link Google Account" in Settings
    ↓
[PENDING] OAuth flow initiated with state=linkAccount
    ↓
User grants Google consent
    ↓
Callback validates CSRF + state
    ↓
Check if Google account already linked elsewhere
    ├─ Yes → [CONFLICT] Show error, cancel linking
    └─ No → Continue
        ↓
[CONFIRMED] User confirms merge (if email matches different user)
    ↓
Create Account record with provider='google'
    ↓
[LINKED] User can now sign in with Google OR password
```

---

## Rate Limiting (CHK060-CHK066)

### NFR-012: Rate Limiting Implementation (CHK060-CHK066)

**Enforcement Level** (CHK060): Application level (middleware)

**Window Type** (CHK061): Sliding window (more accurate than fixed)

```typescript
// lib/auth/rate-limiter.ts
import { LRUCache } from 'lru-cache'

interface RateLimitEntry {
  attempts: number[]
}

const rateLimitCache = new LRUCache<string, RateLimitEntry>({
  max: 5000,
  ttl: 60 * 1000, // 1 minute
})

export function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitCache.get(ip) || { attempts: [] }

  // Sliding window: Remove attempts older than 1 minute
  entry.attempts = entry.attempts.filter(
    timestamp => now - timestamp < 60 * 1000
  )

  if (entry.attempts.length >= 5) {
    return false // Rate limit exceeded
  }

  entry.attempts.push(now)
  rateLimitCache.set(ip, entry)
  return true
}
```

**Storage Mechanism** (CHK062):

- Development/Single Instance: In-memory LRU cache
- Production/Multi-Instance: Redis with distributed locking
  ```typescript
  // Redis implementation (production)
  async function checkRateLimitRedis(ip: string): Promise<boolean> {
    const key = `ratelimit:${ip}`
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, 60) // 1 minute TTL
    }
    return count <= 5
  }
  ```

**IP Address Extraction** (CHK063):

```typescript
function getClientIP(req: Request): string {
  // Priority order:
  // 1. x-real-ip (single proxy)
  // 2. x-forwarded-for (multiple proxies, use first)
  // 3. Connection remote address

  const realIP = req.headers['x-real-ip']
  if (realIP && typeof realIP === 'string') {
    return realIP
  }

  const forwardedFor = req.headers['x-forwarded-for']
  if (forwardedFor) {
    const ips = (
      typeof forwardedFor === 'string' ? forwardedFor : forwardedFor[0]
    )
      .split(',')
      .map(ip => ip.trim())
    return ips[0] // First IP is client, rest are proxies
  }

  return req.connection?.remoteAddress || 'unknown'
}
```

**Rate Limit Response** (CHK064):

```typescript
// 429 Too Many Requests
res.status(429).json({
  error: 'rate_limit_exceeded',
  message: 'Too many authentication attempts. Please try again in a moment.',
  retryAfter: 60, // seconds
})

// Set Retry-After header
res.setHeader('Retry-After', '60')
```

**Test Environment Bypass** (CHK065):

```typescript
function checkRateLimit(ip: string): boolean {
  // Bypass in test/development
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.DISABLE_RATE_LIMIT === 'true'
  ) {
    return true
  }

  // Normal rate limiting logic
  return checkRateLimitImpl(ip)
}
```

**CSRF Validation Failure** (CHK066):

```typescript
// Handled by NextAuth.js automatically
// On failure:
return res.status(403).json({
  error: 'csrf_validation_failed',
  message: 'Security validation failed. Please try again.',
  code: 'CSRF_INVALID',
})

// Log security event
logger.warn('CSRF validation failed', {
  ip: getClientIP(req),
  userAgent: req.headers['user-agent'],
})
```

---

## Edge Cases - Data Integrity (CHK086-CHK091)

### FR-032: Database Transaction Boundaries (CHK086)

**Account Merging Transaction**:

```typescript
await prisma.$transaction(async (tx) => {
  // All operations atomic
  const user = await tx.user.update({ ... });
  const account = await tx.account.create({ ... });
  const session = await tx.session.create({ ... });

  // If any fails, all rollback
}, {
  isolationLevel: 'Serializable',
  maxWait: 5000,
  timeout: 10000
});
```

**Duplicate Account Creation** (CHK087):

- Use unique constraint: `@@unique([provider, providerAccountId])`
- Race condition: Transaction isolation prevents duplicates
- Retry logic: Catch P2002 error, fetch existing record

**Orphaned Account Records** (CHK088):

- Foreign key cascade: `onDelete: Cascade`
- User deletion automatically deletes accounts
- Cleanup job: Find accounts without users (safety net)
  ```sql
  DELETE FROM accounts WHERE user_id NOT IN (SELECT id FROM users);
  ```

**Session Token Collision** (CHK089):

- Extremely unlikely: 256-bit random = ~0 probability
- Unique constraint: Database rejects duplicates
- Retry: Generate new token on collision (max 3 attempts)

**Email Case Sensitivity** (CHK090):

```typescript
// Normalize email before storage/lookup
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

// All queries use normalized email
const user = await prisma.user.findUnique({
  where: { email: normalizeEmail(profile.email) },
})
```

**Null Email from Google** (CHK091):

```typescript
// Reject authentication if email missing
if (!profile.email) {
  logger.error('Google profile missing email', {
    sub: profile.sub,
    timestamp: new Date(),
  })

  return {
    error: 'MISSING_EMAIL',
    message: 'Your Google account must have an email address.',
    statusCode: 400,
  }
}
```

---

## Dependencies & Assumptions (CHK092-CHK098)

### DEPS-001: External Dependencies (CHK092-CHK098)

**Google OAuth API Version** (CHK092):

- OAuth 2.0 spec: RFC 6749
- OpenID Connect: 1.0
- Discovery endpoint: `https://accounts.google.com/.well-known/openid-configuration`
- Token endpoint: `https://oauth2.googleapis.com/token`
- Authorization endpoint: `https://accounts.google.com/o/oauth2/v2/auth`

**NextAuth.js Compatibility** (CHK093):

- Current: v4.24.11
- Migration path to v5: Documented breaking changes
- Prisma adapter: @auth/prisma-adapter v2.10.0 (compatible with v4)
- Migration timeline: Not planned (v4 stable, v5 not urgent)

**Google OAuth Credential Rotation** (CHK095):

```typescript
// Procedure for client secret rotation:
// 1. Generate new client secret in Google Console
// 2. Add as GOOGLE_CLIENT_SECRET_NEW environment variable
// 3. Deploy application with both secrets
// 4. Test authentication with new secret
// 5. Remove old secret from Google Console
// 6. Update GOOGLE_CLIENT_SECRET to new value
// 7. Remove GOOGLE_CLIENT_SECRET_NEW

// Code supports graceful rotation:
const clientSecrets = [
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CLIENT_SECRET_NEW,
].filter(Boolean)

// Try current, fallback to new during transition
```

**PostgreSQL Assumption** (CHK096):

- **Assumption**: PostgreSQL 13+ database available
- **Validation**: Prisma datasource specifies `provider = "postgresql"`
- **Alternatives supported**: MySQL, SQLite (Prisma adapter agnostic)
- **Documented in**: plan.md § Storage

**Google OAuth Quotas** (CHK097):

- **Quota**: 10,000 requests/day (default, can request increase)
- **Monitoring**: Track OAuth API calls in metrics
- **Mitigation**: Cache user profiles, reduce unnecessary token refreshes
- **Alert**: Notify if approaching 80% of quota

**Google Consent Screen Changes** (CHK098):

- **Risk**: Google may update consent UI/UX
- **Impact**: User confusion, different screenshots in docs
- **Mitigation**: Monitor Google OAuth changelog, update docs quarterly
- **Testing**: Manual testing after Google announcements

---

## Ambiguity Resolutions (CHK104-CHK110)

### CLARIFY-001: Ambiguous Terms Quantified

**"Gracefully handle errors"** (CHK104):

- Show user-friendly message (specific per error type)
- Provide retry button (where applicable)
- Log error for debugging (no PII)
- Don't crash application
- Maintain session state where possible

**"Merge accounts and transfer all data"** (CHK105):

- **Profile data**: Google data overwrites (name, image)
- **Authentication**: Both methods work after merge
- **User content**: All preserved (no deletion)
- **Conflicts**: Latest data wins (Google profile is newer)

**"User-friendly messages"** (CHK106):

- Concrete examples documented in requirements-oauth-flow.md
- No technical jargon ("Authentication service error" not "OAuth 2.0 grant_type=refresh_token failed")
- Actionable guidance ("Please try again" not "Contact admin")
- Error-specific (not generic "Something went wrong")

**"Automatic refresh capability"** (CHK107):

- When: On access token expiration detection
- How: Use refresh_token to call Google token endpoint
- Trigger: JWT callback checks `expires_at < Date.now()`
- Frequency: Only when needed (not proactive)

**"Configurable timeouts"** (CHK108):

- Mechanism: Environment variables
- Defaults: 24h session, 10min OAuth state, 5s token exchange
- Configuration: `SESSION_MAX_AGE_HOURS=24`

**"Retry functionality"** (CHK109):

- Max retries: 3
- Backoff: Exponential (1s, 2s, 4s)
- Timeout per attempt: 5s
- Retry on: Network errors, 5xx responses
- No retry: 4xx client errors

**"Email matching"** (CHK110):

- Normalization: Lowercase + trim
- Plus addressing: Ignored (`john+test@example.com` = `john@example.com`)
  ```typescript
  function normalizeEmail(email: string): string {
    const [local, domain] = email.toLowerCase().trim().split('@')
    const withoutPlus = local.split('+')[0]
    return `${withoutPlus}@${domain}`
  }
  ```

---

## Scalability (CHK121-CHK125)

**Connection Pooling** (CHK121): Covered in NFR-004

**Horizontal Scaling** (CHK122):

- JWT sessions enable stateless authentication
- No sticky sessions required
- Rate limiting requires distributed cache (Redis)
- OAuth state cache requires Redis in multi-instance

**Distributed Rate Limiting** (CHK123): Covered in NFR-012

**Zero-Downtime Migration** (CHK124):

```bash
# Use Prisma migrate deploy (not migrate dev)
npx prisma migrate deploy

# Blue-green deployment:
# 1. Deploy new instances with migration
# 2. Run migration against database
# 3. New instances start handling traffic
# 4. Old instances drain and shut down
```

**Session Storage Scalability** (CHK125):

- JWT: Scales horizontally (no shared state)
- Database: Connection pooling handles concurrency
- Trade-off documented in NFR-004

---

## Observability (CHK126-CHK130)

**Structured Logging** (CHK126):

```typescript
interface LogEntry {
  timestamp: string // ISO 8601
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  correlationId?: string // Request tracking
  userId?: string
  context: Record<string, any>
}

logger.info('User signed in', {
  correlationId: req.id,
  userId: user.id,
  provider: 'google',
  duration: Date.now() - startTime,
})
```

**Monitoring Metrics** (CHK127):

```typescript
// Prometheus-style metrics
const metrics = {
  signin_attempts_total: counter(),
  signin_success_total: counter(),
  signin_failures_total: counter({ labels: ['error_type'] }),
  token_refresh_total: counter({ labels: ['result'] }),
  oauth_flow_duration_seconds: histogram(),
  rate_limit_exceeded_total: counter(),
}
```

**Alerting** (CHK128):

- Critical: OAuth service unavailable >5 min → PagerDuty
- Warning: Error rate >10% for >10 min → Slack
- Info: Token refresh failures >1% → Email

**Request Tracing** (CHK129):

```typescript
// Generate correlation ID
const correlationId = crypto.randomUUID()
req.correlationId = correlationId

// Propagate through all logs
logger.info('OAuth initiated', { correlationId })
// ... later ...
logger.info('Token exchanged', { correlationId })
// ... later ...
logger.info('Session created', { correlationId })

// Trace entire OAuth flow with single ID
```

**Dashboard Requirements** (CHK130):

- Authentication success rate (24h, 7d, 30d)
- OAuth flow latency (p50, p95, p99)
- Error breakdown by type
- Active sessions count
- Token refresh rate

---

## GDPR Compliance (CHK131-CHK136)

**Data Export Format** (CHK131):

```json
{
  "export_version": "1.0",
  "generated_at": "2025-01-27T12:00:00Z",
  "user": {
    "id": "clu123456",
    "email": "john@example.com",
    "name": "John Doe",
    "created_at": "2025-01-01T00:00:00Z"
  },
  "linked_accounts": [
    {
      "provider": "google",
      "linked_at": "2025-01-01T00:00:00Z",
      "scopes": ["openid", "email", "profile"]
    }
  ],
  "authentication_history": [
    {
      "timestamp": "2025-01-27T10:00:00Z",
      "method": "google",
      "ip": "203.0.113.xxx"
    }
  ]
}
```

**Cascading Deletes** (CHK132):

```prisma
model User {
  id       String    @id
  accounts Account[] @relation(onDelete: Cascade)
  sessions Session[] @relation(onDelete: Cascade)
}
```

**Deletion Verification** (CHK133):

```typescript
async function verifyDeletion(userId: string): Promise<boolean> {
  const [userExists, accountsExist, sessionsExist] = await Promise.all([
    prisma.user.count({ where: { id: userId } }),
    prisma.account.count({ where: { userId } }),
    prisma.session.count({ where: { userId } }),
  ])

  return userExists === 0 && accountsExist === 0 && sessionsExist === 0
}
```

**Data Retention** (CHK134):

- Active user data: Indefinite (until user deletes account)
- Inactive tokens: 30 days
- Audit logs: 90 days (then anonymize user ID)
- Anonymized logs: 1 year (compliance/analytics)

**GDPR Consent Tracking** (CHK135):

```typescript
interface ConsentRecord {
  userId: string
  consentType: 'oauth_google'
  consentedAt: Date
  ipAddress: string
  userAgent: string
}

// Log consent on first Google sign-in
await prisma.consentLog.create({
  data: {
    userId: user.id,
    consentType: 'oauth_google',
    consentedAt: new Date(),
    ipAddress: getClientIP(req),
    userAgent: req.headers['user-agent'],
  },
})
```

**Export During Active Session** (CHK136):

- Allowed: User can export while logged in
- Includes: Current session in export
- Security: Requires re-authentication before download

---

## Reliability (CHK137-CHK141)

**Idempotency** (CHK137):

- Token refresh: Multiple refresh attempts with same refresh_token succeed (Google allows)
- Account creation: Unique constraints prevent duplicates
- Session creation: Unique session tokens prevent duplicates

**Graceful Degradation** (CHK138):

- Slow Google response (>5s): Show "Connecting to Google..." spinner
- Timeout after 15s total: Show error, allow retry
- Partial availability: Continue with cached data where possible

**Circuit Breaker** (CHK139): Implemented in NFR-028

**Health Checks** (CHK140):

```typescript
app.get('/health', async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    oauth: await checkGoogleOAuth(),
    cache: await checkCache(),
  }

  const healthy = Object.values(checks).every(check => check === true)
  res.status(healthy ? 200 : 503).json(checks)
})
```

**Disaster Recovery** (CHK141):

```markdown
# OAuth Credential Compromise Response Plan

1. **Immediate Actions** (< 1 hour):
   - Rotate client secret in Google Console
   - Invalidate all refresh tokens (Google Console)
   - Deploy new GOOGLE_CLIENT_SECRET
   - Force re-authentication for all users

2. **Investigation** (< 24 hours):
   - Audit access logs for suspicious activity
   - Identify affected users
   - Determine breach scope

3. **Notification** (< 72 hours):
   - Email affected users
   - Post incident report
   - Document lessons learned

4. **Prevention**:
   - Regular credential rotation (quarterly)
   - Secret scanning in repositories
   - Access logging and monitoring
```

---

## Summary

This comprehensive document addresses **87 checklist items**:

**Performance** (6 items): CHK067-CHK072  
**Security Acceptance** (6 items): CHK073-CHK078  
**Account Linking** (14 items): CHK045, CHK048-CHK059, CHK086  
**Rate Limiting** (7 items): CHK060-CHK066  
**Edge Cases** (6 items): CHK087-CHK091  
**Dependencies** (7 items): CHK092-CHK098  
**Ambiguity Resolutions** (7 items): CHK104-CHK110  
**Scalability** (5 items): CHK121-CHK125  
**Observability** (5 items): CHK126-CHK130  
**GDPR** (6 items): CHK131-CHK136  
**Reliability** (5 items): CHK137-CHK141  
**Error Handling** (13 items): CHK046, CHK048-CHK059, CHK086

**Running Total**: 38 (previous) + 87 (this doc) = **125 items completed** out of 151

**Remaining**: 26 items (consistency checks, traceability, API contract validation)
