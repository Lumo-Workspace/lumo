# Research: Google OAuth Login Feature

**Created**: 2025-01-27  
**Feature**: [spec.md](/Users/chaoli/Projects/lumoai/lumo/specs/001-google/spec.md)  
**Purpose**: Resolve technical unknowns identified in implementation planning

## Database Choice for User Profiles and OAuth Tokens

### Research Question

What database solution should be used for storing user profiles, OAuth tokens, and supporting account merging functionality?

### Decision: PostgreSQL with Prisma ORM

**Rationale**:

- PostgreSQL provides ACID compliance required for account merging operations
- JSON column support for flexible OAuth token storage
- Strong consistency guarantees for user profile data
- Excellent TypeScript integration with Prisma ORM
- Built-in encryption capabilities for sensitive token data
- Mature ecosystem with proven scalability

**Alternatives Considered**:

- **MongoDB**: Good for flexible schemas but lacks ACID guarantees needed for account merging
- **SQLite**: Simple but not suitable for production scale (1000+ concurrent users)
- **MySQL**: Viable alternative but PostgreSQL has better JSON support and encryption features
- **Firebase**: Good OAuth integration but vendor lock-in and limited control over data structure

### Implementation Details

- Use Prisma ORM for type-safe database operations
- PostgreSQL JSON columns for OAuth token storage (access_token, refresh_token, id_token)
- Encrypted storage for sensitive token data using application-level encryption
- Database migrations for schema evolution
- Connection pooling for performance optimization

## NextAuth.js Configuration

### Research Question

How should NextAuth.js be configured for Google OAuth integration with custom user management?

### Decision: NextAuth.js v5 with Google Provider

**Rationale**:

- NextAuth.js v5 provides modern TypeScript-first approach
- Built-in Google OAuth 2.0 provider with proper token handling
- Custom user management hooks for account creation and linking
- Session management with JWT and database adapters
- Built-in CSRF protection and security best practices

**Alternatives Considered**:

- **Custom OAuth implementation**: Too complex, reinventing security best practices
- **Auth0**: External dependency, additional cost, limited customization
- **Firebase Auth**: Vendor lock-in, limited control over user data flow

### Implementation Details

- Google OAuth 2.0 provider with required scopes: openid, email, profile
- Custom callbacks for user creation and account linking
- JWT tokens for session management with database persistence
- Secure cookie configuration with HTTP-only and SameSite attributes

## Token Encryption Strategy

### Research Question

How should OAuth tokens be encrypted at rest for security compliance?

### Decision: AES-256-GCM encryption with rotating keys

**Rationale**:

- AES-256-GCM provides authenticated encryption (confidentiality + integrity)
- Industry standard for sensitive data protection
- Supports key rotation for enhanced security
- Minimal performance overhead for read/write operations

**Alternatives Considered**:

- **Database-level encryption**: Limited control, vendor-specific implementations
- **Application-level encryption**: Full control, standard algorithms, portable
- **Hardware security modules**: Overkill for this scale, additional complexity

### Implementation Details

- Node.js crypto module for AES-256-GCM encryption
- Environment-based encryption keys with rotation capability
- Separate keys for different token types (access vs refresh)
- Encrypted storage in PostgreSQL JSON columns

## Account Merging Implementation

### Research Question

How should account merging be implemented when linking Google accounts to existing users?

### Decision: Database transaction with atomic operations

**Rationale**:

- ACID transactions ensure data consistency during merging
- Atomic operations prevent partial merges and data corruption
- Rollback capability for failed merge operations
- Clear audit trail for merge operations

**Alternatives Considered**:

- **Eventual consistency**: Too complex, potential data loss scenarios
- **Manual merge process**: User experience friction, support overhead
- **Separate accounts**: Contradicts user expectation of unified identity

### Implementation Details

- Database transactions for atomic merge operations
- Data migration scripts for transferring user data
- Conflict resolution for duplicate profile information
- Audit logging for merge operations and data changes
- User notification system for merge confirmations

## Performance Optimization

### Research Question

How should OAuth token refresh and validation be optimized for performance?

### Decision: Background token refresh with caching

**Rationale**:

- Proactive token refresh prevents authentication failures
- Caching reduces database queries for token validation
- Background processing minimizes user-facing latency
- Graceful degradation when refresh fails

**Alternatives Considered**:

- **On-demand refresh**: Higher latency, potential authentication failures
- **No caching**: Excessive database queries, poor performance
- **Client-side refresh**: Security risks, token exposure

### Implementation Details

- Background job queue for token refresh operations
- Redis caching for frequently accessed tokens
- Exponential backoff for failed refresh attempts
- Token validation middleware with caching layer
