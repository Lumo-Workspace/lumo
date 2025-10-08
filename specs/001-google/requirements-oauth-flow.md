# OAuth Flow Requirements - Detailed Specification

**Feature**: Google OAuth Login (`001-google`)  
**Purpose**: Complete OAuth 2.0 flow state definitions and requirements  
**Addresses**: Checklist items CHK001-CHK008, CHK044-CHK047, CHK079-CHK080

---

## OAuth 2.0 Flow States (CHK001)

### FR-019: OAuth Flow State Machine

The system MUST implement the following OAuth 2.0 authorization code flow states:

1. **INITIATION** (`/api/auth/signin/google` GET request)
   - Generate CSRF token (32 bytes cryptographically random)
   - Generate PKCE code_verifier (43-128 characters, URL-safe base64)
   - Calculate PKCE code_challenge: SHA256(code_verifier), base64url encoded
   - Store state parameter with 10-minute TTL
   - Set CSRF cookie: `__Host-next-auth.csrf-token`
   - Redirect to Google OAuth authorization endpoint

2. **REDIRECT** (User at Google consent screen)
   - URL format: `https://accounts.google.com/o/oauth2/v2/auth`
   - Parameters: client_id, redirect_uri, response_type=code, scope, state, code_challenge, code_challenge_method=S256
   - User action: Grant or deny permission
   - Session timeout: 10 minutes (configurable via OAUTH_CONSENT_TIMEOUT_MS)

3. **CALLBACK** (`/api/auth/callback/google` GET request with code or error)
   - Validate state parameter matches stored value
   - Validate CSRF token from cookie
   - Extract authorization code from query parameter
   - Authorization code expiration: 10 minutes from issuance (Google standard)

4. **TOKEN EXCHANGE** (Backend server-to-server call to Google)
   - POST to `https://oauth2.googleapis.com/token`
   - Parameters: code, client_id, client_secret, redirect_uri, grant_type=authorization_code, code_verifier (PKCE)
   - Receive: access_token, refresh_token, expires_in, token_type, id_token
   - Timeout: 5 seconds with 3 retries (exponential backoff: 1s, 2s, 4s)

5. **SESSION CREATION** (After successful token exchange)
   - Decrypt and validate ID token JWT
   - Extract user profile from ID token claims
   - Create or update User record in database
   - Create Account record with encrypted tokens
   - Generate session token (JWT or database session)
   - Set session cookie: `__Secure-next-auth.session-token`
   - Redirect to callbackUrl (default: `/dashboard`)

### State Transition Diagram

```
[User] → Click "Sign in with Google"
    ↓
[INITIATION] Generate CSRF + PKCE
    ↓
[REDIRECT] → Google consent screen
    ↓ (user grants)
[CALLBACK] ← Authorization code
    ↓
[TOKEN EXCHANGE] ← Access + Refresh tokens
    ↓
[SESSION CREATION] → Dashboard
```

---

## PKCE Requirements (CHK002)

### SR-025: PKCE Implementation

**MUST** implement Proof Key for Code Exchange (PKCE) per RFC 7636:

- **Code Verifier**:
  - Length: 43-128 characters
  - Character set: [A-Z] [a-z] [0-9] - \_ . ~
  - Generation: Cryptographically random using `crypto.randomBytes(32).toString('base64url')`
  - Storage: In-memory cache with 10-minute TTL, keyed by state parameter

- **Code Challenge**:
  - Method: S256 (SHA-256)
  - Calculation: Base64URL(SHA256(ASCII(code_verifier)))
  - Sent in authorization request: `code_challenge` and `code_challenge_method=S256`

- **Verification**:
  - Google validates code_challenge matches code_verifier during token exchange
  - Prevents authorization code interception attacks

- **NextAuth.js Integration**:
  - NextAuth.js v4.24.11+ includes automatic PKCE support
  - Verify `pkce: true` in Google provider configuration

---

## OAuth Scope Requirements (CHK003)

### SR-004: OAuth Scope Limitation (Enhanced)

**Scopes MUST be limited to**:

- `openid` - Required for OpenID Connect
- `email` - User's email address
- `profile` - Basic profile info (name, picture)

**Scope string format**: `"openid email profile"` (space-separated)

**Verification**:

- Programmatic check: Parse `Account.scope` field after authentication
- Test: Assert scope string contains only allowed values
- Monitoring: Alert if additional scopes detected in audit logs

**Rejection criteria**:

- Any scope not in allowlist MUST cause authentication failure
- Log security event: "UNAUTHORIZED_SCOPE_DETECTED"

---

## State Parameter & CSRF Protection (CHK004)

### FR-016: CSRF Protection (Enhanced)

**State Parameter**:

- **Generation**: 32 bytes cryptographically random, base64url encoded
- **Format**: `{random_value}.{timestamp}`
- **Storage**: Server-side cache (Redis or in-memory) with 10-minute TTL
- **Validation**:
  1. Extract state from callback URL query parameter
  2. Lookup stored state by value
  3. Verify not expired (timestamp within 10 minutes)
  4. Delete state after successful validation (single-use)
  5. Return 400 Bad Request if validation fails

**CSRF Token (NextAuth.js built-in)**:

- **Cookie name**: `__Host-next-auth.csrf-token`
- **Flags**: HttpOnly, Secure, SameSite=Lax, Path=/api/auth
- **Format**: `{token}|{hash}` where hash = HMAC-SHA256(token, secret)
- **Validation**: Automatic by NextAuth.js middleware
- **Failure handling**: 403 Forbidden with error message "CSRF validation failed"

---

## Authorization Code Expiration (CHK005)

### FR-007: Token Validation (Enhanced - Authorization Code)

**Authorization Code Lifecycle**:

- **Expiration**: 10 minutes from issuance (Google standard, not configurable)
- **Single-use**: Code invalidated after first token exchange attempt
- **Validation**:
  - Check code is not empty string
  - Attempt token exchange within 10-minute window
  - Handle "invalid_grant" error from Google if code expired

**Error Scenarios**:

- `invalid_grant` - Code expired or already used
  - User message: "Authorization expired. Please sign in again."
  - Action: Redirect to /login with error parameter
- `authorization_pending` - User hasn't completed consent
  - Timeout: 10 minutes, then expire state parameter
  - User message: "Sign-in timed out. Please try again."

---

## Google OAuth Service Unavailability (CHK006)

### FR-009: Error Handling (Enhanced - Service Unavailability)

**Detection**:

- HTTP 5xx responses from Google OAuth endpoints
- Network timeouts (>5 seconds)
- DNS resolution failures for accounts.google.com

**Handling Requirements**:

1. **Retry Logic**:
   - Max retries: 3
   - Backoff: Exponential (1s, 2s, 4s)
   - Timeout per attempt: 5 seconds
   - Total max time: 15 seconds

2. **User Experience**:
   - Show error page: `/api/auth/error?error=ServiceUnavailable`
   - Message: "Google sign-in is temporarily unavailable. Please try again in a few moments."
   - Provide: [Try Again] button (re-initiates OAuth flow)
   - Provide: [Back to Login] link

3. **Monitoring**:
   - Log event: "GOOGLE_OAUTH_UNAVAILABLE" with timestamp
   - Increment metric: `google_oauth_failures_total{reason="service_unavailable"}`
   - Alert if failure rate >10% over 5-minute window

4. **Fallback**:
   - No automatic fallback to password auth (out of scope for P1)
   - Display service status: "Checking Google services..." with spinner during retries

---

## OAuth Consent Screen Redirect (CHK007)

### FR-006: OAuth Consent Screen Handling (Enhanced)

**Redirect Requirements**:

- **URL Validation**:
  - Redirect URI MUST match exactly: `${NEXTAUTH_URL}/api/auth/callback/google`
  - Scheme: HTTPS in production, HTTP allowed in development
  - Domain: Must match Google Cloud Console authorized redirect URI
  - No query parameters in redirect URI (all params in OAuth response)

- **Consent Screen Configuration** (Google Cloud Console):
  - App name: "Lumo AI"
  - Support email: Required, displayed to users
  - Scopes: openid, email, profile (non-sensitive, no consent screen for verified users)
  - Logo: Optional, 120x120px PNG
  - Privacy policy URL: Required for production
  - Terms of service URL: Optional

- **User Actions**:
  - **Grant**: Redirects to callback with `code` and `state` parameters
  - **Deny**: Redirects to callback with `error=access_denied` and `state` parameters
- **Testability**:
  - Integration test: Mock Google consent screen response
  - E2E test: Use test Google account to complete real OAuth flow
  - Measurement: Time from redirect to callback <2 seconds (network dependent)

---

## OAuth Flow Timeout Scenarios (CHK008)

### FR-020: OAuth Flow Timeout Handling

**Timeout Points**:

1. **Consent Screen Timeout** (10 minutes):
   - State parameter expires after 10 minutes
   - User returns to callback after expiration
   - Error: "State parameter expired"
   - User message: "Sign-in session expired. Please start over."
   - Action: Redirect to /login

2. **Token Exchange Timeout** (5 seconds per attempt, 15s total):
   - Network timeout during POST to Google token endpoint
   - Retry 3 times with exponential backoff
   - Final failure: "Token exchange timed out"
   - User message: "Connection to Google timed out. Please try again."

3. **Database Operation Timeout** (5 seconds):
   - User creation or session creation takes >5 seconds
   - Error: "Database timeout during authentication"
   - User message: "Authentication successful, but system is slow. Refreshing..."
   - Action: Retry once, then show error page

**Configuration**:

- Environment variables:
  - `OAUTH_STATE_TTL_MS` - State parameter TTL (default: 600000 = 10 min)
  - `OAUTH_TOKEN_TIMEOUT_MS` - Token exchange timeout (default: 5000 = 5s)
  - `OAUTH_RETRY_COUNT` - Max retries (default: 3)
  - `DB_OPERATION_TIMEOUT_MS` - Database query timeout (default: 5000)

---

## Error Handling - OAuth Error Codes (CHK044)

### FR-009: OAuth Error Handling (Complete Error Code Mapping)

**Google OAuth Error Codes** (from OAuth 2.0 spec):

| Error Code                | Scenario                    | User Message                                             | HTTP Status      | Recovery              |
| ------------------------- | --------------------------- | -------------------------------------------------------- | ---------------- | --------------------- |
| `access_denied`           | User denied consent         | "You cancelled sign-in. Click below to try again."       | 200 (error page) | [Try Again] button    |
| `invalid_request`         | Malformed auth request      | "Authentication request failed. Please try again."       | 400              | Redirect to /login    |
| `unauthorized_client`     | Client ID mismatch          | "App configuration error. Please contact support."       | 400              | Contact support       |
| `invalid_scope`           | Requested scope not allowed | "Invalid permissions requested. Please contact support." | 400              | Contact support       |
| `server_error`            | Google temporary error      | "Google authentication unavailable. Try again shortly."  | 503              | [Try Again] button    |
| `temporarily_unavailable` | Google service degraded     | "Google sign-in busy. Please wait and try again."        | 503              | [Try Again] + backoff |
| `invalid_grant`           | Code expired/used           | "Authorization expired. Please sign in again."           | 400              | Redirect to /login    |
| `unsupported_grant_type`  | Wrong grant type            | "Authentication method not supported."                   | 400              | Contact support       |

**Error Response Format** (consistent across all endpoints):

```json
{
  "error": "access_denied",
  "message": "You cancelled sign-in. Click below to try again.",
  "details": {
    "code": "OAUTH_ACCESS_DENIED",
    "canRetry": true,
    "retryUrl": "/login"
  }
}
```

---

## Token Exchange Failure Scenarios (CHK047)

### FR-021: Token Exchange Error Handling

**Failure Scenarios**:

1. **Invalid Authorization Code**:
   - Google response: `{"error": "invalid_grant"}`
   - Cause: Code expired (>10 min), already used, or tampered
   - User action: Redirect to /login with message "Sign-in expired"
   - Log: "TOKEN_EXCHANGE_INVALID_CODE"

2. **Expired Authorization Code**:
   - Google response: `{"error": "invalid_grant", "error_description": "Code expired"}`
   - User action: Same as invalid code
   - Metrics: Track code expiration rate

3. **Network Timeout**:
   - No response from Google after 5 seconds
   - Retry: 3 attempts with exponential backoff (1s, 2s, 4s)
   - User message: "Connection to Google timed out. Retrying..."
   - Final failure: Error page with [Try Again]

4. **Invalid Client Credentials**:
   - Google response: `{"error": "unauthorized_client"}`
   - Cause: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET incorrect
   - User message: "App configuration error. Please contact support."
   - Alert: Critical - send alert to ops team
   - Log: "TOKEN_EXCHANGE_INVALID_CREDENTIALS"

5. **PKCE Validation Failure**:
   - Google response: `{"error": "invalid_grant", "error_description": "Code challenge mismatch"}`
   - Cause: code_verifier doesn't match code_challenge
   - Security alert: Potential MITM attack
   - User message: "Security validation failed. Please try again."
   - Log: "TOKEN_EXCHANGE_PKCE_FAILED" with IP address

---

## State Parameter Mismatch (CHK079)

### FR-022: State Parameter Validation

**Mismatch Scenarios**:

1. **Missing State Parameter**:
   - Callback URL has no `state` query parameter
   - Error: 400 Bad Request
   - Message: "Invalid authentication response. Please sign in again."
   - Cause: Direct access to callback URL, or Google error

2. **State Not Found in Storage**:
   - State parameter present but not in server cache
   - Error: 400 Bad Request
   - Message: "Authentication session not found. Please sign in again."
   - Cause: State expired (>10 min), server restart, or cache eviction

3. **State Value Mismatch**:
   - State parameter doesn't match stored value
   - Error: 400 Bad Request
   - Security alert: "STATE_MISMATCH_DETECTED" - potential CSRF attack
   - Message: "Security validation failed. Please sign in again."
   - Action: Block IP if repeated (>3 attempts in 1 minute)

4. **Expired State**:
   - State older than 10 minutes (timestamp validation)
   - Error: 400 Bad Request
   - Message: "Sign-in session expired. Please try again."
   - Action: Delete expired state from cache

**Implementation**:

```typescript
function validateState(callbackState: string): boolean {
  const stored = stateCache.get(callbackState)
  if (!stored) return false

  const [value, timestamp] = stored.split('.')
  const age = Date.now() - parseInt(timestamp)

  if (age > 600000) {
    // 10 minutes
    stateCache.delete(callbackState)
    return false
  }

  stateCache.delete(callbackState) // Single-use
  return value === callbackState
}
```

---

## Expired CSRF Token (CHK080)

### FR-023: CSRF Token Lifecycle

**CSRF Token Expiration**:

- **Lifetime**: 15 minutes (NextAuth.js default)
- **Cookie**: `__Host-next-auth.csrf-token`
- **Format**: `{token}|{hash}|{expires}`

**Expiration Scenarios**:

1. **Token Expired Before OAuth Callback**:
   - User takes >15 minutes on Google consent screen
   - Callback validation fails: CSRF token expired
   - Error: 403 Forbidden
   - Message: "Security token expired. Please sign in again."
   - Action: Redirect to /login, clear all auth cookies

2. **Token Missing**:
   - Cookie not sent with callback request
   - Cause: Cookie blocked, privacy mode, or domain mismatch
   - Error: 403 Forbidden
   - Message: "Security validation failed. Ensure cookies are enabled."
   - Log: "CSRF_TOKEN_MISSING"

3. **Token Hash Mismatch**:
   - Cookie tampered or secret key rotated
   - Error: 403 Forbidden
   - Security alert: "CSRF_TOKEN_TAMPERED"
   - Message: "Security validation failed. Please try again."
   - Action: Clear all auth cookies, potential rate limit

**Prevention**:

- Set CSRF token expiration > OAuth flow max time (15 min > 10 min state timeout)
- Refresh CSRF token on signin initiation
- Clear expired CSRF tokens from cookies

---

## Summary

This document addresses checklist items:

- ✅ CHK001: OAuth flow states explicitly defined
- ✅ CHK002: PKCE requirements documented
- ✅ CHK003: OAuth scopes exhaustively specified
- ✅ CHK004: State parameter and CSRF requirements defined
- ✅ CHK005: Authorization code expiration specified
- ✅ CHK006: Google service unavailability handling defined
- ✅ CHK007: OAuth consent screen redirect requirements clarified
- ✅ CHK008: OAuth flow timeout scenarios specified
- ✅ CHK044: All Google OAuth error codes mapped
- ✅ CHK047: Token exchange failure scenarios defined
- ✅ CHK079: State parameter mismatch scenarios addressed
- ✅ CHK080: CSRF token expiration handling specified

**Next**: Create token management and session requirements documents to address remaining checklist items.
