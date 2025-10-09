# Data Model: Account Management

**Date**: 2025-01-27  
**Feature**: Account Management  
**Branch**: 002-manage-account-1

## Database Schema Changes

### User Model Extensions

```prisma
model User {
  id            String    @id @default(cuid())
  name          String?   // Display name (editable by user)
  email         String?   @unique
  emailVerified DateTime?
  image         String?   // Profile picture URL (from Google or uploaded)

  // New fields for account management
  displayName   String?   // User's preferred display name
  avatarUrl     String?   // URL to uploaded avatar image
  avatarBlobId  String?   // Vercel Blob ID for avatar storage

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // Authentication relationships
  accounts Account[]
  sessions Session[]

  // User data relationships
  profile UserProfile?

  @@index([email])
  @@index([displayName]) // For team member list queries
  @@map("users")
}
```

### UserProfile Model Extensions

```prisma
model UserProfile {
  id        String   @id @default(cuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Avatar metadata
  avatarMetadata Json? // { originalSize, processedSize, format, dimensions }

  // Profile preferences
  preferences Json? // { theme, notifications, etc. }
  settings     Json? // { privacy, visibility, etc. }

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("user_profiles")
}
```

## Entity Relationships

### User Profile Entity

- **Primary Key**: `id` (String, cuid)
- **Foreign Key**: `userId` → User.id (one-to-one)
- **Core Fields**:
  - `displayName`: User's preferred display name (nullable, max 100 chars)
  - `avatarUrl`: URL to avatar image (nullable)
  - `avatarBlobId`: Vercel Blob storage ID (nullable)
- **Metadata Fields**:
  - `avatarMetadata`: JSON object with image processing details
  - `preferences`: User preferences and settings
  - `settings`: Privacy and visibility settings
- **Audit Fields**:
  - `createdAt`: Profile creation timestamp
  - `updatedAt`: Last profile update timestamp

### Avatar Image Entity (Virtual)

- **Storage**: Vercel Blob Storage
- **Constraints**:
  - Maximum file size: 5MB
  - Target dimensions: 200x200 pixels
  - Supported formats: JPG, PNG, GIF, WebP, SVG
- **Metadata**:
  - Original file size and dimensions
  - Processed file size and dimensions
  - File format and compression details
  - Upload timestamp and processing status

## Validation Rules

### Display Name Validation

- **Required**: No (can be null/empty)
- **Length**: 1-100 characters
- **Characters**: Unicode text (including emojis and special characters)
- **Uniqueness**: Not required (multiple users can have same display name)
- **Sanitization**: Trim whitespace, normalize Unicode

### Avatar Image Validation

- **File Size**: Maximum 5MB
- **Dimensions**: Auto-resized to 200x200 pixels
- **Formats**: JPG, PNG, GIF, WebP, SVG
- **Security**: Validate file headers, scan for malicious content
- **Processing**: Automatic resizing, format optimization, compression

## State Transitions

### Profile Update Flow

1. **Initiate Update**: User submits form with new display name or avatar
2. **Validation**: Server validates input data and file (if avatar)
3. **Processing**: For avatars, resize and optimize image
4. **Storage**: Save to database and blob storage
5. **Notification**: Trigger real-time update events
6. **Confirmation**: Return success response to client

### Avatar Processing States

- **Uploading**: File being uploaded to server
- **Processing**: Image being resized and optimized
- **Storing**: Saving to blob storage and database
- **Complete**: Avatar ready for display
- **Error**: Processing failed, user notified

## Query Patterns

### Team Member List Queries

```sql
-- Get team members with profile information
SELECT
  u.id,
  u.displayName,
  u.avatarUrl,
  u.updatedAt
FROM users u
WHERE u.id IN (team_member_ids)
ORDER BY u.displayName ASC;
```

### Profile Update Queries

```sql
-- Update user profile
UPDATE users
SET
  displayName = ?,
  avatarUrl = ?,
  avatarBlobId = ?,
  updatedAt = NOW()
WHERE id = ?;
```

### Real-time Update Queries

```sql
-- Get recent profile updates for real-time sync
SELECT
  u.id,
  u.displayName,
  u.avatarUrl,
  u.updatedAt
FROM users u
WHERE u.updatedAt > ? AND u.id IN (team_member_ids);
```

## Data Consistency

### Concurrent Update Handling

- Use database transactions for atomic updates
- Implement optimistic locking with `updatedAt` timestamps
- Handle conflicts gracefully with user-friendly error messages
- Ensure avatar uploads don't interfere with name updates

### Real-time Synchronization

- Track profile update timestamps for efficient sync
- Use Server-Sent Events for real-time notifications
- Implement conflict resolution for simultaneous updates
- Maintain eventual consistency across all views

## Migration Strategy

### Database Migration

1. Add new fields to existing User model
2. Extend UserProfile model with avatar metadata
3. Create indexes for performance optimization
4. Migrate existing data (Google profile images to new fields)
5. Update application code to use new schema

### Backward Compatibility

- Maintain existing `name` and `image` fields during transition
- Use `displayName` as primary display field, fallback to `name`
- Use `avatarUrl` as primary avatar field, fallback to `image`
- Gradual migration of existing user data
