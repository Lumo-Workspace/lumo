## Context

Users authenticate via Google OAuth, but there's no mechanism for users to create their workspace. Each user needs to belong to a team, which has a workspace with a unique URL on the uselumo.ai domain. This is a foundational feature for multi-tenancy.

## Goals / Non-Goals

**Goals:**

- Allow users to create a team after first login
- Auto-generate workspace URL from team name
- Allow customization of workspace URL while maintaining uniqueness
- Enforce URL format restrictions (lowercase, alphanumeric, hyphens)
- Ensure users without teams are guided to onboarding

**Non-Goals:**

- Multiple workspace URLs per team (1:1 relationship)
- Team renaming (out of scope for initial implementation)
- Workspace deletion (handled separately)

## Decisions

### Data Model

**Team**: Core entity representing an organization/workspace

- `name`: User-friendly team name
- `workspaceUrl`: Unique identifier used in URL (e.g., "hello-world")
- `slug`: Auto-generated URL-safe identifier

**TeamMember**: Junction table for user-team relationships

- Links users to teams with role-based access
- Enables future multi-user support
- Every user must belong to at least one team

**Workspace**: Linked entity to Team

- Stores workspace-specific settings
- Extensible for future features

### URL Format Rules

**Format**: Lowercase, alphanumeric characters and hyphens only
**Length**: 2-50 characters
**Uniqueness**: Must be unique across all teams
**Reserved**: Block certain reserved words (admin, api, www, etc.)

### Default URL Generation

**Rule**: Convert team name to URL-safe slug

- Lowercase
- Replace spaces with hyphens
- Remove special characters
- Trim consecutive hyphens
- Truncate to 50 characters

**Example**: "Hello World!" → "hello-world"

### Onboarding Flow

1. User logs in via Google OAuth
2. System checks if user has team membership
3. If no team: redirect to `/onboarding`
4. User enters team name; workspace URL auto-syncs to the team name and can be manually overridden (input always visible)
5. System validates and creates team + membership
6. Redirect to `/app` with team context

## Risks / Trade-offs

**Risk**: URL conflicts if team name generates existing URL
**Mitigation**: Check uniqueness in real-time and suggest alternatives

**Risk**: Users might choose poor team names
**Mitigation**: URL is auto-generated from name but always editable as override

**Risk**: Special characters in team names could break URL generation
**Mitigation**: Sanitization rules handle all edge cases

**Trade-off**: Removing a dedicated toggle simplifies UI; user intent tracked via manual edits (dirty flag)
**Decision**: Allow manual override while keeping name↔URL linkage until overridden

## Migration Plan

1. Deploy database schema changes
2. Deploy API routes with validation
3. Deploy onboarding UI
4. Deploy session/middleware updates
5. Monitor for existing users without teams (will redirect to onboarding)

**Rollback**: Can disable onboarding redirect in middleware if issues arise

## Open Questions

None - design is self-contained and well-scoped.
