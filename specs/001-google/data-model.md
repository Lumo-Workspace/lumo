# Data Model: Google OAuth Login Feature

**Created**: 2025-01-27  
**Feature**: [spec.md](/Users/chaoli/Projects/lumoai/lumo/specs/001-google/spec.md)  
**Database**: PostgreSQL with Prisma ORM

## Entity Definitions

### User Entity

Represents system users with profile information, authentication methods, and preferences.

```typescript
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  profileImage  String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // Authentication relationships
  accounts      Account[]
  sessions      Session[]

  // User data relationships
  profile       UserProfile?

  @@map("users")
}
```

**Attributes**:

- `id`: Unique identifier (CUID format)
- `email`: Primary email address (unique constraint)
- `name`: Display name from Google profile
- `profileImage`: URL to Google profile picture
- `createdAt`: Account creation timestamp
- `updatedAt`: Last modification timestamp

**Validation Rules**:

- Email must be valid format and unique across all users
- Name is optional (can be null for new accounts)
- Profile image URL must be valid HTTPS URL when present

### Account Entity (OAuth Providers)

Represents linked OAuth accounts for users.

```typescript
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String  // "oauth"
  provider          String  // "google"
  providerAccountId String  // Google user ID
  refresh_token     String? @db.Text // Encrypted
  access_token      String? @db.Text // Encrypted
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text // Encrypted
  session_state     String?

  // Relationships
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@map("accounts")
}
```

**Attributes**:

- `id`: Unique identifier
- `userId`: Foreign key to User entity
- `type`: OAuth type identifier
- `provider`: OAuth provider name ("google")
- `providerAccountId`: Google's unique user identifier
- `refresh_token`: Encrypted Google refresh token
- `access_token`: Encrypted Google access token
- `expires_at`: Token expiration timestamp
- `token_type`: Token type (Bearer)
- `scope`: Granted OAuth scopes
- `id_token`: Encrypted Google ID token
- `session_state`: OAuth session state

**Validation Rules**:

- Provider + providerAccountId must be unique
- Tokens must be encrypted before storage
- Expires_at must be future timestamp when present
- All token fields are optional (can be null during refresh)

### Session Entity

Represents user login sessions and authentication state.

```typescript
model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  // Relationships
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("sessions")
}
```

**Attributes**:

- `id`: Unique identifier
- `sessionToken`: Unique session token (JWT)
- `userId`: Foreign key to User entity
- `expires`: Session expiration timestamp

**Validation Rules**:

- SessionToken must be unique across all sessions
- Expires must be future timestamp
- Sessions are automatically cleaned up on user deletion

### UserProfile Entity

Represents extended user profile information and preferences.

```typescript
model UserProfile {
  id        String   @id @default(cuid())
  userId    String   @unique
  firstName String?
  lastName  String?
  locale    String?  @default("en")
  timezone  String?  @default("UTC")
  settings  Json?    // User preferences

  // Relationships
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_profiles")
}
```

**Attributes**:

- `id`: Unique identifier
- `userId`: One-to-one relationship with User
- `firstName`: User's first name
- `lastName`: User's last name
- `locale`: User's preferred language/locale
- `timezone`: User's timezone
- `settings`: JSON object for user preferences

**Validation Rules**:

- userId must be unique (one profile per user)
- Locale must be valid ISO language code
- Timezone must be valid IANA timezone identifier
- Settings JSON must be valid JSON structure

## Entity Relationships

### Primary Relationships

1. **User → Account**: One-to-many (user can have multiple OAuth providers)
2. **User → Session**: One-to-many (user can have multiple active sessions)
3. **User → UserProfile**: One-to-one (each user has one profile)

### Account Linking Logic

- When Google account is linked to existing user: `Account` record created with `userId`
- When accounts are merged: All data from secondary user transferred to primary user
- Account merging process:
  1. Create new `Account` record for Google provider
  2. Transfer all `UserProfile` data to primary user
  3. Update all foreign key references
  4. Delete secondary user and related records

## State Transitions

### User Creation Flow

1. **New User**: User record created with Google profile data
2. **Account Linking**: Account record created and linked to User
3. **Profile Creation**: UserProfile record created with default settings
4. **Session Creation**: Session record created for authentication

### Account Merging Flow

1. **Conflict Detection**: Google account already linked to different user
2. **Data Transfer**: UserProfile and related data transferred to primary user
3. **Account Linking**: New Account record created for primary user
4. **Cleanup**: Secondary user and orphaned records deleted

### Token Refresh Flow

1. **Token Expiry**: Access token expires, refresh required
2. **Refresh Request**: New tokens obtained from Google
3. **Token Update**: Encrypted tokens stored in Account record
4. **Session Extension**: Session expiry updated if needed

## Data Migration Strategy

### Account Merging Migrations

- Atomic database transactions for data consistency
- Foreign key constraint handling during user merging
- Audit trail creation for merge operations
- Rollback capability for failed merge operations

### Schema Evolution

- Prisma migrations for schema changes
- Backward compatibility for existing data
- Data transformation scripts for structural changes
- Zero-downtime deployment strategy

## Security Considerations

### Data Encryption

- OAuth tokens encrypted using AES-256-GCM
- Encryption keys stored in environment variables
- Key rotation capability for enhanced security
- Separate encryption for different token types

### Data Privacy

- Minimal data collection (name, email, profile picture)
- GDPR compliance for EU users
- Data retention policies for inactive accounts
- User data export and deletion capabilities

### Access Control

- Database-level access controls
- Application-level authorization checks
- Audit logging for sensitive operations
- Rate limiting for authentication endpoints
