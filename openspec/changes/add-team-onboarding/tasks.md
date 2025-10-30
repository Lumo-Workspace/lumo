## 1. Database Schema

- [x] 1.1 Add Team model with name, workspaceUrl, and slug fields
- [x] 1.2 Add Workspace model linked to Team
- [x] 1.3 Add TeamMember model for user-team relationship with role field
- [x] 1.4 Add indexes for workspace URL uniqueness and team lookups
- [x] 1.5 Create and run Prisma migration

## 2. Team Creation API

- [x] 2.1 Create API route for team creation (`/api/teams/create`)
- [x] 2.2 Implement team name validation (length, characters)
- [x] 2.3 Implement workspace URL generation from team name
- [x] 2.4 Implement workspace URL validation (format, uniqueness)
- [x] 2.5 Implement database transaction for Team + TeamMember creation
- [x] 2.6 Add error handling and user-friendly messages

## 3. URL Validation Logic

- [x] 3.1 Create utility function to generate URL-safe slug from team name
- [x] 3.2 Implement URL format validation (lowercase, alphanumeric, hyphens)
- [x] 3.3 Implement uniqueness check against existing workspaces
- [x] 3.4 Create API endpoint for URL availability check (`/api/teams/check-url`)
- [x] 3.5 Add real-time URL validation in frontend

## 4. Onboarding UI

- [x] 4.1 Create onboarding page component (`app/onboarding/page.tsx`)
- [x] 4.2 Build team name input with validation feedback
- [x] 4.3 Build workspace URL input with auto-generation toggle
- [x] 4.4 Add URL preview showing full workspace URL
- [x] 4.5 Implement form submission with loading states
- [x] 4.6 Add success handling and redirect to app

## 5. Session and Middleware Updates

- [x] 5.1 Update session callback to include user's team membership
- [x] 5.2 Create middleware to check team membership on app routes
- [x] 5.3 Add redirect logic for users without teams (to onboarding)
- [x] 5.4 Update app page to verify team membership before rendering
- [x] 5.5 Add team context to session data

## 6. Testing

- [ ] 6.1 Test team creation with various team names
- [ ] 6.2 Test URL generation with special characters
- [ ] 6.3 Test URL validation and uniqueness checks
- [ ] 6.4 Test onboarding flow from login to app access
- [ ] 6.5 Test error cases (duplicate URL, invalid format)
