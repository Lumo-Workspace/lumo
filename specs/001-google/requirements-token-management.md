# Token Management Requirements - Detailed Specification

**Feature**: Google OAuth Login (`001-google`)  
**Purpose**: Complete token encryption, refresh, validation, and lifecycle requirements  
**Addresses**: Checklist items CHK017-CHK024, CHK085

---

## Token Encryption Specification (CHK017)

### SR-001: AES-256-GCM Encryption (Enhanced)

**Implementation Details**:

```typescript
// Token encryption specification
interface TokenEncryptionSpec {
  algorithm: 'aes-256-gcm'
  keyLength: 32 // bytes (256 bits)
  ivLength: 12 // bytes (96 bits, GCM standard)
  authTagLength: 16 // bytes (128 bits)
  encoding: 'hex' // for storage
}
```

**Encryption Process**:

1. **Key**: 32-byte key from `TOKEN_ENCRYPTION_KEY` environment variable (base64-encoded)
2. **IV (Initialization Vector)**: 12 bytes cryptographically random, generated per encryption
3. **Plaintext**: OAuth access_token or refresh_token string
4. **Encryption**: AES-256-GCM cipher
5. **Auth Tag**: 16-byte authentication tag for integrity verification
6. **Output Format**: `{iv}:{ciphertext}:{authTag}` (all hex-encoded)
   - Example: `a1b2c3d4e5f6g7h8i9j0:{encrypted_token}:{auth_tag}`

**Decryption Process**:

1. Parse format: Split by `:` delimiter
2. Extract IV (12 bytes), ciphertext, auth tag (16 bytes)
3. Create decipher with key and IV
4. Set auth tag for integrity verification
5. Decrypt ciphertext
6. Return plaintext token

**Key Derivation**:

- Base key from environment: `TOKEN_ENCRYPTION_KEY` (base64)
- Derive access token key: HKDF(base_key, salt="access_token", info="v1")
- Derive refresh token key: HKDF(base_key, salt="refresh_token", info="v1")
- Separate keys prevent related-key attacks

**Security Properties**:

- Confidentiality: AES-256 encryption
- Integrity: GCM authentication tag prevents tampering
- Uniqueness: Random IV per encryption prevents pattern analysis
- Forward secrecy: Key rotation supports

---

## Encryption Key Rotation (CHK018)

### SR-002: Encryption Key Rotation (Enhanced)

**Key Rotation Strategy**:

**Environment Variables**:

- `TOKEN_ENCRYPTION_KEY_CURRENT` - Active encryption key (required)
- `TOKEN_ENCRYPTION_KEY_PREVIOUS` - Previous key for transition period (optional)
- Format: Base64-encoded 32-byte keys

**Rotation Process**:

1. **Preparation**:
   - Generate new 32-byte key: `openssl rand -base64 32`
   - Set as `TOKEN_ENCRYPTION_KEY_CURRENT` in staging
   - Move current key to `TOKEN_ENCRYPTION_KEY_PREVIOUS`
   - Deploy with both keys active

2. **Encryption** (always use CURRENT):

   ```typescript
   function encryptToken(plaintext: string): string {
     const key = Buffer.from(
       process.env.TOKEN_ENCRYPTION_KEY_CURRENT!,
       'base64'
     )
     // ... encryption logic
   }
   ```

3. **Decryption** (try CURRENT, fallback to PREVIOUS):

   ```typescript
   function decryptToken(ciphertext: string): string {
     try {
       const key = Buffer.from(
         process.env.TOKEN_ENCRYPTION_KEY_CURRENT!,
         'base64'
       )
       return decrypt(ciphertext, key)
     } catch (err) {
       if (process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS) {
         const previousKey = Buffer.from(
           process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS,
           'base64'
         )
         return decrypt(ciphertext, previousKey)
       }
       throw err
     }
   }
   ```

4. **Migration** (background job):
   - Query all Account records with encrypted tokens
   - For each account: Decrypt with PREVIOUS → Re-encrypt with CURRENT
   - Update database record
   - Track migration progress

5. **Completion**:
   - After 30 days (token inactivity threshold), all active tokens migrated
   - Remove `TOKEN_ENCRYPTION_KEY_PREVIOUS` from environment
   - Old tokens become undecryptable (acceptable, user re-authenticates)

**Rotation Schedule**:

- Regular rotation: Every 90 days
- Emergency rotation: Immediately if key compromised
- Notification: 7 days before scheduled rotation

**Verification**:

- Test: Encrypt with CURRENT, decrypt with CURRENT ✓
- Test: Encrypt with PREVIOUS, decrypt with PREVIOUS (fallback) ✓
- Test: Decrypt fails with invalid key ✓

---

## Token Expiration & Inactivity (CHK019)

### SR-009: Automatic Token Deletion (Enhanced)

**Inactivity Definition**:

- **lastUsedAt Timestamp**: Updated on every successful authentication with Google account
- **Inactivity Threshold**: 30 days (configurable via `TOKEN_INACTIVITY_DAYS`)
- **Calculation**: `Date.now() - lastUsedAt > 30 * 24 * 60 * 60 * 1000`

**Cleanup Process**:

1. **Background Job** (runs hourly):

   ```sql
   -- Identify inactive tokens
   SELECT id, userId, provider, lastUsedAt
   FROM accounts
   WHERE provider = 'google'
     AND lastUsedAt < NOW() - INTERVAL '30 days'
     AND (refresh_token IS NOT NULL OR access_token IS NOT NULL);
   ```

2. **Deletion**:

   ```sql
   -- Delete tokens (keep account record)
   UPDATE accounts
   SET refresh_token = NULL,
       access_token = NULL,
       expires_at = NULL
   WHERE id IN (SELECT id FROM inactive_accounts);
   ```

3. **Logging**:

   ```typescript
   logger.info('Inactive tokens deleted', {
     count: deletedCount,
     threshold: '30 days',
     timestamp: new Date().toISOString(),
   })
   ```

4. **User Impact**:
   - Next login attempt: Must complete full OAuth flow (no refresh token)
   - User experience: Seamless (just re-authenticates with Google)
   - No data loss: Account record and user profile preserved

**Configuration**:

- `TOKEN_INACTIVITY_DAYS` - Inactivity threshold (default: 30)
- `TOKEN_CLEANUP_INTERVAL_HOURS` - Cleanup job frequency (default: 1)
- `TOKEN_CLEANUP_BATCH_SIZE` - Max accounts per cleanup run (default: 1000)

---

## Access Token Refresh (CHK020)

### FR-007: Token Refresh Flow (Enhanced)

**Refresh Requirements**:

**Trigger Conditions**:

1. Access token expired (`expires_at` timestamp < current time)
2. Proactive refresh: 5 minutes before expiration
3. API call fails with 401 Unauthorized from Google

**Refresh Process**:

1. **Check Expiration**:

   ```typescript
   function needsRefresh(expiresAt: number): boolean {
     const now = Date.now()
     const expiryTime = expiresAt * 1000 // Convert to ms
     const bufferTime = 5 * 60 * 1000 // 5 minutes
     return now >= expiryTime - bufferTime
   }
   ```

2. **Retrieve Refresh Token**:
   - Query Account table by userId and provider='google'
   - Decrypt refresh_token using `decryptToken()`
   - Handle missing refresh token: Force user re-authentication

3. **Call Google Token Endpoint**:

   ```typescript
   const response = await fetch('https://oauth2.googleapis.com/token', {
     method: 'POST',
     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
     body: new URLSearchParams({
       client_id: process.env.GOOGLE_CLIENT_ID!,
       client_secret: process.env.GOOGLE_CLIENT_SECRET!,
       grant_type: 'refresh_token',
       refresh_token: decryptedRefreshToken,
     }),
     signal: AbortSignal.timeout(5000), // 5 second timeout
   })
   ```

4. **Handle Response**:
   - **Success** (200 OK):

     ```json
     {
       "access_token": "new_access_token",
       "expires_in": 3600,
       "scope": "openid email profile",
       "token_type": "Bearer"
     }
     ```

     - Encrypt new access_token
     - Update Account: `access_token`, `expires_at`, `lastUsedAt`
     - Return new token

   - **Failure** (400/401):
     - Delete refresh_token from database
     - Set JWT error flag: `token.error = "RefreshAccessTokenError"`
     - Force user re-authentication on next request

5. **Retry Logic** (CHK046):
   - Max retries: 3
   - Backoff: Exponential (1s, 2s, 4s)
   - Timeout per attempt: 5 seconds
   - Retry on: Network errors, 5xx responses
   - No retry on: 4xx client errors

**Expiration Detection**:

- Access token lifetime: 1 hour (Google standard)
- Refresh token lifetime: No expiration (until revoked or 6 months inactive per Google)
- Track last refresh timestamp to detect refresh failures

---

## Token Refresh Failure Handling (CHK021)

### FR-024: Token Refresh Error Scenarios

**Failure Scenarios**:

1. **Refresh Token Expired/Revoked**:
   - Google response: `{"error": "invalid_grant"}`
   - Cause: Refresh token revoked by user, expired (6 months inactive), or Google policy
   - Action:
     ```typescript
     - Delete refresh_token from Account table
     - Set session error: token.error = "RefreshAccessTokenError"
     - On next request: Redirect to /login
     - User message: "Your session has expired. Please sign in again."
     - Log: "REFRESH_TOKEN_INVALID" with userId
     ```

2. **Invalid Client Credentials**:
   - Google response: `{"error": "unauthorized_client"}`
   - Cause: GOOGLE_CLIENT_SECRET changed or incorrect
   - Action:
     - Critical alert: "Google OAuth credentials invalid"
     - User message: "Authentication service error. Please contact support."
     - No user action can fix this
     - Log: "REFRESH_TOKEN_INVALID_CREDENTIALS"

3. **Network Timeout**:
   - No response after 5 seconds
   - Retry: 3 attempts with exponential backoff
   - Final failure:
     - Keep existing expired token
     - Set temporary error flag
     - Next request: Retry refresh
     - After 3 failures: Force re-authentication
   - User message: "Connection issue. Retrying..."

4. **Rate Limit Exceeded** (Google quota):
   - Google response: `{"error": "temporarily_unavailable"}`
   - Retry: Exponential backoff up to 32 seconds
   - User message: "Service temporarily busy. Please wait..."
   - Metric: Track refresh rate limit hits

5. **Database Update Failure** (CHK085):
   - Token refreshed successfully from Google
   - Database update fails (connection error, constraint violation)
   - Action:
     - Rollback: Don't use new token
     - Keep old (expired) token in database
     - Next request: Retry entire refresh process
     - If repeated failure: Log error, alert ops
   - Idempotency: Google doesn't invalidate old token on refresh

**User Re-authentication Triggers**:

- `RefreshAccessTokenError` detected in session
- Refresh token deleted from database
- Repeated refresh failures (>3 attempts)
- User action: Automatically redirect to /login with message

---

## Token Validation Requirements (CHK022)

### FR-007: Token Validation (Complete Specification)

**Validation Points**:

1. **On Token Receipt** (after OAuth callback):
   - **ID Token (JWT) Validation**:

     ```typescript
     import { jwtVerify } from 'jose'

     const { payload } = await jwtVerify(
       idToken,
       getGoogleJWKS(), // Fetch Google's public keys
       {
         issuer: 'https://accounts.google.com',
         audience: process.env.GOOGLE_CLIENT_ID,
         maxTokenAge: '1 hour',
       }
     )
     ```

   - Verify: Signature, issuer, audience, expiration, nonce
   - Extract claims: sub (user ID), email, name, picture

   - **Access Token Validation**:
     - Opaque token (not JWT) - no client-side validation
     - Validate on first use by calling Google UserInfo endpoint
     - Store expiration time from `expires_in` response

2. **On Refresh**:
   - Validate refresh token is not null
   - Decrypt successfully
   - Check lastUsedAt < 30 days

3. **Before Use**:
   - Check `expires_at` > current time
   - Trigger refresh if expired or expiring soon (<5 min)

4. **Scope Validation**:
   - Parse `scope` field from token response
   - Split by space: `scope.split(' ')`
   - Verify contains only: `['openid', 'email', 'profile']`
   - Reject if additional scopes present
   - Log security event if scope mismatch

**Validation Failures**:

- Invalid signature → Force re-authentication
- Expired token → Trigger refresh flow
- Invalid scope → Reject authentication, log security alert
- Missing required claims (email) → Show error page

---

## Encrypted Token Storage Format (CHK023)

### Data-Model: Account Table (Enhanced)

**Database Schema**:

```sql
CREATE TABLE accounts (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              TEXT NOT NULL, -- 'oauth'
  provider          TEXT NOT NULL, -- 'google'
  provider_account_id TEXT NOT NULL, -- Google user ID (sub claim)

  -- Encrypted tokens (TEXT to support large encrypted strings)
  refresh_token     TEXT, -- Format: {iv}:{ciphertext}:{authTag}
  access_token      TEXT, -- Format: {iv}:{ciphertext}:{authTag}

  -- Token metadata
  expires_at        INTEGER, -- Unix timestamp (seconds)
  token_type        TEXT,    -- 'Bearer'
  scope             TEXT,    -- 'openid email profile'

  -- OpenID Connect
  id_token          TEXT,    -- JWT (not encrypted, short-lived)
  session_state     TEXT,    -- Optional OIDC session state

  -- Audit
  last_used_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(provider, provider_account_id),
  INDEX idx_accounts_user_id (user_id),
  INDEX idx_accounts_last_used (last_used_at) -- For cleanup queries
);
```

**Storage Format**:

- Column type: TEXT (not BYTEA)
- Encoding: Hexadecimal string
- Max length: ~500 characters (IV:24 + cipher:~400 + tag:32 + delimiters)
- Example: `a1b2c3d4...:{long_encrypted_string}:f9e8d7c6...`

**Why TEXT vs BLOB**:

- Portability: Works across all databases (PostgreSQL, MySQL, SQLite)
- Debugging: Hex strings are inspectable
- Storage: Minimal overhead vs binary
- NextAuth.js adapter: Expects TEXT for token fields

**Encryption Overhead**:

- Original token: ~200 bytes (Google access token)
- IV: 12 bytes → 24 hex chars
- Auth tag: 16 bytes → 32 hex chars
- Ciphertext: ~200 bytes → 400 hex chars
- Delimiters: 2 chars
- Total: ~458 characters (fits comfortably in TEXT)

---

## Token Cleanup on Account Deletion (CHK024)

### SR-011: Data Deletion (Enhanced - Token Cleanup)

**Account Deletion Process**:

1. **User Initiates Deletion** (`DELETE /api/user/delete`):
   - Requires re-authentication
   - Requires confirmation: User types "DELETE"

2. **Token Cleanup**:

   ```typescript
   // Before deleting user, explicitly clear tokens
   await prisma.account.updateMany({
     where: { userId: user.id },
     data: {
       refresh_token: null,
       access_token: null,
       id_token: null,
       expires_at: null,
     },
   })
   ```

3. **Cascade Delete**:

   ```typescript
   // Foreign key constraint handles cascade
   await prisma.user.delete({
     where: { id: user.id },
     // Automatically deletes:
     // - All Account records (including token columns)
     // - All Session records
   })
   ```

4. **Audit Log Anonymization**:

   ```sql
   -- Anonymize user references in audit logs
   UPDATE auth_events
   SET user_id = 'DELETED_USER',
       email = 'deleted@anonymized.local'
   WHERE user_id = ${deletedUserId};
   ```

5. **Verification**:
   - Query accounts table: No records for deleted user
   - Query sessions table: No records for deleted user
   - Audit logs: User ID anonymized
   - No orphaned tokens remain

**Cascading Delete Rules**:

```prisma
model User {
  id       String    @id
  accounts Account[]
  sessions Session[]

  // Cascade delete when user deleted
}

model Account {
  id      String @id
  userId  String
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

**Token Revocation at Google**:

- Optional: Call Google token revocation endpoint
- POST to `https://oauth2.googleapis.com/revoke?token={refresh_token}`
- Best effort: Continues even if revocation fails
- Purpose: Invalidates tokens at Google side

---

## Partial Token Refresh Failure (CHK085)

### FR-025: Partial Failure Handling in Token Refresh

**Scenario**: Access token refreshed from Google successfully, but database update fails

**Atomicity Requirements**:

```typescript
async function refreshAccessToken(
  account: Account
): Promise<TokenRefreshResult> {
  let newTokens: GoogleTokenResponse

  // Step 1: Call Google (external, irreversible)
  try {
    newTokens = await fetchNewTokensFromGoogle(account.refresh_token)
  } catch (error) {
    return { success: false, error: 'GOOGLE_API_FAILURE' }
  }

  // Step 2: Update database (transactional)
  try {
    await prisma.$transaction(async tx => {
      // Encrypt new access token
      const encryptedAccessToken = encryptToken(newTokens.access_token)

      // Update account with new tokens
      await tx.account.update({
        where: { id: account.id },
        data: {
          access_token: encryptedAccessToken,
          expires_at: Math.floor(Date.now() / 1000) + newTokens.expires_in,
          lastUsedAt: new Date(),
        },
      })
    })

    return { success: true, accessToken: newTokens.access_token }
  } catch (dbError) {
    // Database update failed, but Google already issued new token
    // Strategy: Discard new token, keep old one, retry refresh on next request

    logger.error('Token refresh DB update failed', {
      userId: account.userId,
      error: dbError,
      timestamp: new Date().toISOString(),
    })

    // Don't return new token to client
    // Old (expired) token remains in database
    // Next request will retry refresh

    return { success: false, error: 'DATABASE_UPDATE_FAILURE' }
  }
}
```

**Handling Strategy**:

- **Option 1 (Implemented)**: Discard new token, retry refresh on next request
  - Pros: Simple, idempotent (Google doesn't invalidate old token)
  - Cons: One extra API call to Google

- **Option 2 (Alternative)**: Store new token in cache, retry database update
  - Pros: Fewer Google API calls
  - Cons: Complex, cache invalidation issues

**Idempotency Guarantee**:

- Google OAuth refresh tokens are reusable
- Refreshing doesn't invalidate the refresh token itself
- Multiple refresh attempts with same refresh token succeed
- Safe to retry after database failure

**Monitoring**:

- Track partial failure rate: `token_refresh_db_failures_total`
- Alert if >1% of refresh attempts fail at database step
- Investigate database connection pool, constraints, deadlocks

---

## Summary

This document addresses checklist items:

- ✅ CHK017: AES-256-GCM encryption implementation details specified
- ✅ CHK018: Encryption key rotation requirements quantified
- ✅ CHK019: Token inactivity and expiration criteria defined
- ✅ CHK020: Access token refresh requirements specified
- ✅ CHK021: Token refresh failure handling explicit
- ✅ CHK022: Token validation requirements defined
- ✅ CHK023: Encrypted token storage format specified
- ✅ CHK024: Token cleanup on account deletion defined
- ✅ CHK085: Partial token refresh failure handling specified

**Next**: Create session management, environment configuration, and non-functional requirements documents.
