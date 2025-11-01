## Why

New users currently need to manually create a team and workspace during onboarding, which adds friction. Many organizations want employees with company email addresses to automatically join the organization's workspace. Public email providers (gmail.com, outlook.com, etc.) should be excluded from this auto-join behavior.

## What Changes

- Auto-join new users to an existing workspace based on their email domain (when enabled)
- Team owners can control auto-join with `allowAutoJoin` flag (default: true)
- Exclude public email providers (gmail.com, outlook.com, yahoo.com, etc.) from auto-join
- Only join existing workspaces by domain; new domains proceed to manual onboarding
- Add domain-to-workspace mapping (via Team.domain and Team.allowAutoJoin fields)
- Trigger auto-join logic during NextAuth signIn callback when user has no team memberships

## Impact

- Affected specs: team-onboarding (MODIFIED), workspace-management (ADDED)
- Affected code:
  - `lib/auth/config.ts` - Add auto-join logic in signIn callback
  - `prisma/schema.prisma` - Add domain field to Team or create DomainWorkspace model
  - Utility: domain extraction, public email detection
  - Constants: public email domains list
