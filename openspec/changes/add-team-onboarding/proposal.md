## Why

After logging in with Google OAuth, users need a way to set up their workspace. Currently, users can authenticate but have no path to create their team and workspace, preventing them from using the application. This onboarding flow is essential for users to start using Lumo effectively.

## What Changes

- **BREAKING**: Add Team, Workspace, and TeamMember models to database schema
- Add onboarding detection middleware to check if user has a team
- Implement team creation flow with workspace URL validation
- Auto-generate workspace URL from team name (e.g., "hello world" → "hello-world")
- Allow manual workspace URL customization while enforcing URL format
- Add URL uniqueness and format validation rules
- Redirect users without teams to onboarding page
- Store user's default team in session after onboarding

## Impact

- **Affected specs**: New capability - team-onboarding
- **Affected code**:
  - `prisma/schema.prisma` - Add Team, Workspace, TeamMember models with relationships
  - `app/app/page.tsx` - Add team membership check and redirect
  - `app/onboarding/page.tsx` - New onboarding page with form
  - `lib/auth/config.ts` - Add team check to session callback
  - API routes: team creation, URL validation, workspace setup
  - New `components/features/onboarding/` directory with UI components
