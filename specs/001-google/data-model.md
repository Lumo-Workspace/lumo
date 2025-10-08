# Data Model: Google OAuth Login

**Feature**: `001-google` | **Date**: 2025-01-27  
**Phase**: 1 - Design & Data Modeling

## Overview

This document defines the data entities, relationships, and state transitions for Google OAuth authentication. The data model extends the NextAuth.js standard schema with security and audit requirements.

## Entity Definitions

### User

**Purpose**: Represents a system user with authentication and profile information.

**Fields**:

| Field           | Type     | Constraints             | Description                                      |
| --------------- | -------- | ----------------------- | ------------------------------------------------ |
| `id`            | String   | PK, CUID, NOT NULL      | Unique user identifier                           |
| `name`          | String   | NULLABLE                | User's full name from Google profile             |
| `email`         | String   | UNIQUE, NULLABLE        | User's email address (used for account matching) |
| `emailVerified` | DateTime | NULLABLE                | Timestamp when email was verified by provider    |
| `image`         | String   | NULLABLE                | URL to user's profile picture from Google        |
| `createdAt`     | DateTime | NOT NULL, DEFAULT now() | User account creation timestamp                  |
| `updatedAt`     | DateTime | NOT NULL, AUTO-UPDATE   | Last profile update timestamp                    |

**Relationships**:

- `accounts`: One-to-Many with Account (user can link multiple OAuth providers)
- `sessions`: One-to-Many with Session (user can have multiple active sessions)

**Indexes**:

- PRIMARY: `id`
- UNIQUE: `email`

**Validation Rules**:

- Email must be valid email format (validated by Google OAuth)
- Name max length: 255 characters
- Image URL must be valid HTTPS URL

**Business Rules**:

- User can have maximum 3 concurrent active sessions (SR-015)
- User email is immutable once set from Google (prevents account hijacking)
- Account deletion must cascade to all related accounts and sessions

---

### Account

**Purpose**: Stores OAuth provider account information linked to a user. Supports multiple providers per user for account linking.

**Fields**:

| Field               | Type     | Constraints            | Description                                         |
| ------------------- | -------- | ---------------------- | --------------------------------------------------- |
| `id`                | String   | PK, CUID, NOT NULL     | Unique account identifier                           |
| `userId`            | String   | FK → User.id, NOT NULL | Reference to owning user                            |
| `type`              | String   | NOT NULL               | Account type (always "oauth" for Google)            |
| `provider`          | String   | NOT NULL               | OAuth provider name (always "google")               |
| `providerAccountId` | String   | NOT NULL               | Google user ID (sub claim from ID token)            |
| `refresh_token`     | String   | NULLABLE, TEXT         | **Encrypted** refresh token for long-term access    |
| `access_token`      | String   | NULLABLE, TEXT         | **Encrypted** access token (short-lived)            |
| `expires_at`        | Integer  | NULLABLE               | Unix timestamp when access token expires            |
| `token_type`        | String   | NULLABLE               | Token type (always "Bearer" for Google)             |
| `scope`             | String   | NULLABLE               | Granted OAuth scopes (e.g., "openid email profile") |
| `id_token`          | String   | NULLABLE, TEXT         | Google ID token (JWT with user claims)              |
| `session_state`     | String   | NULLABLE               | OAuth session state parameter                       |
| `lastUsedAt`        | DateTime | NOT NULL, AUTO-UPDATE  | Last time this account was used for authentication  |

**Relationships**:

- `user`: Many-to-One with User (account belongs to one user)

**Indexes**:

- PRIMARY: `id`
- UNIQUE: `(provider, providerAccountId)` - prevents duplicate Google accounts
- INDEX: `userId` - optimize user account lookups

**Validation Rules**:

- `refresh_token` and `access_token` must be encrypted with AES-256-GCM before storage (SR-001)
- Tokens automatically deleted if `lastUsedAt` > 30 days ago (SR-009)
- `providerAccountId` format validated (Google user ID format)

**Security Rules**:

- Tokens never exposed in API responses
- Tokens decrypted only in secure server context
- Token encryption uses rotating keys (CURRENT/PREVIOUS)
- Failed decryption triggers token refresh or re-authentication

**State Transitions**:

```
CREATED → ACTIVE (user signs in successfully)
ACTIVE → EXPIRED (30 days inactivity)
EXPIRED → DELETED (cleanup job runs)
ACTIVE → UNLINKED (user manually unlinks account, requires alternative auth - SR-014)
```

---

### Session

**Purpose**: Tracks active user sessions for authentication state management.

**Fields**:

| Field          | Type     | Constraints             | Description                                           |
| -------------- | -------- | ----------------------- | ----------------------------------------------------- |
| `id`           | String   | PK, CUID, NOT NULL      | Unique session identifier                             |
| `sessionToken` | String   | UNIQUE, NOT NULL        | Session token (JWT or random token)                   |
| `userId`       | String   | FK → User.id, NOT NULL  | Reference to authenticated user                       |
| `expires`      | DateTime | NOT NULL                | Session expiration timestamp (24 hours from creation) |
| `createdAt`    | DateTime | NOT NULL, DEFAULT now() | Session creation timestamp                            |

**Relationships**:

- `user`: Many-to-One with User (session belongs to one user)

**Indexes**:

- PRIMARY: `id`
- UNIQUE: `sessionToken` - fast session lookups
- INDEX: `userId` - user session queries

**Validation Rules**:

- `expires` must be exactly 24 hours from `createdAt` (SR-005)
- Maximum 3 concurrent sessions per user (SR-015)
- Session token must be cryptographically random (256-bit entropy)

**Business Rules**:

- Expired sessions automatically cleaned up (background job)
- New session creation checks concurrent session limit
- If limit exceeded, oldest session is invalidated before creating new one
- Session invalidation logs event to audit log

**State Transitions**:

```
CREATED → ACTIVE (user authenticated)
ACTIVE → EXPIRED (24 hours elapsed or user signs out)
EXPIRED → DELETED (cleanup job runs)
ACTIVE → INVALIDATED (security incident, password change, or concurrent session limit)
```

---

### VerificationToken

**Purpose**: Stores verification tokens for email verification and other one-time operations (NextAuth.js standard model).

**Fields**:

| Field        | Type     | Constraints      | Description                                   |
| ------------ | -------- | ---------------- | --------------------------------------------- |
| `identifier` | String   | NOT NULL         | Email address or other identifier             |
| `token`      | String   | UNIQUE, NOT NULL | Verification token (cryptographically random) |
| `expires`    | DateTime | NOT NULL         | Token expiration timestamp                    |

**Indexes**:

- UNIQUE: `(identifier, token)` - composite unique constraint
- UNIQUE: `token` - fast token lookups

**Validation Rules**:

- Token must be cryptographically random (256-bit entropy)
- Tokens expire after configurable period (default: 24 hours)
- One-time use only (deleted after successful verification)

**Business Rules**:

- Used for email verification during account linking
- Used for password reset flows (if traditional auth added later)
- Expired tokens cleaned up automatically

---

## Entity Relationships Diagram

```
┌─────────────────┐
│      User       │
│─────────────────│
│ id (PK)         │
│ name            │
│ email (UNIQUE)  │
│ emailVerified   │
│ image           │
│ createdAt       │
│ updatedAt       │
└────────┬────────┘
         │
         │ 1:N
         │
    ┌────┴────────────────────┐
    │                         │
    │                         │
┌───▼──────────┐      ┌───────▼──────┐
│   Account    │      │   Session    │
│──────────────│      │──────────────│
│ id (PK)      │      │ id (PK)      │
│ userId (FK)  │      │ sessionToken │
│ type         │      │ userId (FK)  │
│ provider     │      │ expires      │
│ providerAcct │      │ createdAt    │
│ refresh_token│      └──────────────┘
│ access_token │
│ expires_at   │
│ token_type   │
│ scope        │
│ id_token     │
│ session_state│
│ lastUsedAt   │
└──────────────┘

┌──────────────────────┐
│  VerificationToken   │
│──────────────────────│
│ identifier           │
│ token (UNIQUE)       │
│ expires              │
└──────────────────────┘
```

## State Transitions

### OAuth Authentication Flow

```
START
  │
  ├─> User clicks "Sign in with Google"
  │
  ├─> NextAuth.js generates CSRF token + PKCE code
  │
  ├─> Redirect to Google OAuth consent screen
  │
  ├─> User grants/denies permission
  │
  ├─┬─> GRANT → Google redirects with auth code
  │ │
  │ ├─> NextAuth.js validates CSRF + PKCE
  │ │
  │ ├─> Exchange auth code for tokens
  │ │
  │ ├─> Check if User exists (by email)
  │ │
  │ ├─┬─> User EXISTS
  │ │ │
  │ │ ├─> Check if Google account linked
  │ │ │
  │ │ ├─┬─> Already linked → Sign in (update lastUsedAt)
  │ │ │ │
  │ │ │ └─> Not linked → Show merge confirmation
  │ │ │     │
  │ │ │     ├─> User confirms → Link account + Sign in
  │ │ │     │
  │ │ │     └─> User cancels → Return to login
  │ │ │
  │ │ └─> User DOES NOT EXIST
  │ │     │
  │ │     ├─> Create new User record
  │ │     │
  │ │     ├─> Create new Account record (encrypt tokens)
  │ │     │
  │ │     └─> Sign in
  │ │
  │ ├─> Create Session record (JWT or database)
  │ │
  │ ├─> Redirect to callbackUrl (/dashboard)
  │ │
  │ └─> SUCCESS
  │
  └─┬─> DENY → Redirect to error page
    │
    └─> Display "Access denied" message with retry button
```

### Account Linking Flow

```
START (user already authenticated with password)
  │
  ├─> User navigates to Settings → Account Linking
  │
  ├─> Click "Link Google Account"
  │
  ├─> Redirect to Google OAuth (with state=linkAccount)
  │
  ├─> User grants permission
  │
  ├─> Callback validates CSRF + state
  │
  ├─> Check if Google account already linked to another user
  │
  ├─┬─> Already linked → ERROR "This Google account is already in use"
  │ │
  │ └─> Not linked
  │     │
  │     ├─> Create Account record linked to current user
  │     │
  │     ├─> Encrypt and store tokens
  │     │
  │     └─> SUCCESS → Show "Google account linked" confirmation
  │
  └─> User can now sign in with Google OR password
```

### Token Refresh Flow

```
START (user makes authenticated request)
  │
  ├─> Check JWT access token expiration
  │
  ├─┬─> Token valid → Process request
  │ │
  │ └─> Token expired
  │     │
  │     ├─> Retrieve refresh_token from Account table
  │     │
  │     ├─> Decrypt refresh_token
  │     │
  │     ├─> Call Google token endpoint with refresh_token
  │     │
  │     ├─┬─> Refresh successful
  │     │ │
  │     │ ├─> Encrypt new access_token
  │     │ │
  │     │ ├─> Update Account record
  │     │ │
  │     │ ├─> Update JWT
  │     │ │
  │     │ └─> Process request
  │     │ │
  │     │ └─> Refresh failed
  │     │     │
  │     │     ├─> Invalidate session
  │     │     │
  │     │     └─> Redirect to login with "Session expired" message
  │     │
  │     └─> END
```

### Session Cleanup Flow

```
Background job runs every 1 hour
  │
  ├─> Query expired sessions (expires < NOW)
  │
  ├─> Delete expired sessions
  │
  ├─> Query inactive accounts (lastUsedAt > 30 days)
  │
  ├─> Delete refresh_token and access_token
  │
  ├─> Log cleanup metrics
  │
  └─> END
```

## Data Constraints & Validation

### Email Validation

- **Format**: Standard email regex (validated by Google OAuth)
- **Uniqueness**: Enforced at database level
- **Verification**: Email verified by Google (emailVerified timestamp)

### Token Security

- **Encryption Algorithm**: AES-256-GCM
- **Key Storage**: Environment variables (TOKEN_ENCRYPTION_KEY)
- **Key Rotation**: Support for CURRENT and PREVIOUS keys
- **Format**: `{iv}:{encrypted}:{authTag}` (all hex-encoded)

### Session Constraints

- **Max Concurrent Sessions**: 3 per user
- **Expiration**: 24 hours from creation
- **Token Entropy**: 256-bit random token

### Rate Limiting Data

- **Implementation**: In-memory LRU cache (not persisted)
- **Key**: Client IP address
- **Value**: Array of attempt timestamps
- **TTL**: 1 minute
- **Limit**: 5 attempts per minute

## Data Migration Strategy

### Existing Users Table

```prisma
// Before migration - hypothetical existing User model
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String   // Hashed password
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Migration Steps

1. **Add new fields** to User model:
   - `emailVerified: DateTime?`
   - `image: String?`

2. **Create new tables**:
   - Account
   - Session
   - VerificationToken

3. **Data preservation**:
   - Existing users keep their password authentication
   - No data loss during migration
   - Users can link Google accounts after migration

4. **Backward compatibility**:
   - Password authentication continues to work
   - OAuth adds as additional authentication method
   - Account linking enables seamless transition

### Migration Script

```sql
-- Add new fields to users table
ALTER TABLE users
  ADD COLUMN "emailVerified" TIMESTAMP,
  ADD COLUMN "image" TEXT;

-- Create accounts table (Prisma will generate this)
-- Create sessions table (Prisma will generate this)
-- Create verification_tokens table (Prisma will generate this)

-- No data transformation needed
-- Existing users continue with password auth
-- New users can use Google OAuth
```

## Audit Logging Requirements

### Authentication Events Log

**Purpose**: Track authentication events for security monitoring (SR-019, SR-022)

**Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | DateTime | Event timestamp (UTC) |
| `eventType` | String | Event type (SIGNIN_SUCCESS, SIGNIN_FAILURE, etc.) |
| `userId` | String | User ID (if available) |
| `ipAddress` | String | Client IP (anonymized last octet for privacy) |
| `userAgent` | String | Browser user agent string |
| `provider` | String | Auth provider (google, password, etc.) |
| `result` | String | SUCCESS or FAILURE |
| `errorType` | String | Error type if failure (no sensitive details) |

**Retention**: 90 days minimum (SR-024)

**Privacy**: No PII in logs - anonymize IP addresses, no email addresses (SR-012)

**Event Types**:

- `SIGNIN_SUCCESS` - Successful authentication
- `SIGNIN_FAILURE` - Failed authentication attempt
- `ACCOUNT_LINKED` - Google account linked to existing user
- `ACCOUNT_UNLINKED` - Google account unlinked
- `SESSION_EXPIRED` - Session expiration event
- `TOKEN_REFRESH_SUCCESS` - Token refresh succeeded
- `TOKEN_REFRESH_FAILURE` - Token refresh failed
- `RATE_LIMIT_EXCEEDED` - Rate limit violation

## GDPR Compliance Data Operations

### Data Export (SR-010)

**Endpoint**: `GET /api/user/export`
**Format**: JSON
**Contents**:

```json
{
  "user": {
    "id": "user_123",
    "name": "John Doe",
    "email": "john@example.com",
    "emailVerified": "2025-01-27T10:00:00Z",
    "image": "https://...",
    "createdAt": "2025-01-27T09:00:00Z"
  },
  "accounts": [
    {
      "provider": "google",
      "providerAccountId": "google_user_id",
      "linkedAt": "2025-01-27T09:00:00Z",
      "lastUsedAt": "2025-01-27T10:30:00Z"
      // Note: tokens NOT included in export (security)
    }
  ],
  "sessions": [
    {
      "createdAt": "2025-01-27T10:00:00Z",
      "expires": "2025-01-28T10:00:00Z"
    }
  ]
}
```

### Data Deletion (SR-011)

**Endpoint**: `DELETE /api/user/account`
**Process**:

1. Require re-authentication before deletion
2. Delete all Account records (cascade)
3. Delete all Session records (cascade)
4. Delete User record
5. Anonymize audit logs (replace userId with "DELETED_USER")
6. Confirm deletion to user via email

**Confirmation Required**: Yes (prevent accidental deletion)

## Performance Optimization

### Database Indexes

- User.email: Unique index for fast email lookups during account merging
- Account.userId: Index for user account queries
- Account.(provider, providerAccountId): Unique composite index
- Session.sessionToken: Unique index for fast session lookups
- Session.userId: Index for user session queries

### Caching Strategy

- JWT sessions reduce database queries (stateless authentication)
- User profile cached in JWT payload (name, email, image)
- No database hit for authenticated requests (only token validation)

### Query Optimization

- Use Prisma select to fetch only needed fields
- Eager load relationships where needed (include: { accounts: true })
- Avoid N+1 queries with proper includes

## Summary

This data model provides:

- ✅ Secure OAuth token storage with encryption
- ✅ Account linking and merging capabilities
- ✅ Session management with expiration
- ✅ GDPR compliance (data export/deletion)
- ✅ Audit logging for security monitoring
- ✅ Performance optimization with indexes and caching
- ✅ Backward compatibility with existing users
- ✅ Scalable design for future auth providers

Next: Generate API contracts in `/contracts/` directory.
