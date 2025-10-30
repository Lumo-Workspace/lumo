## Why

We want to better tailor onboarding and defaults by asking the user's primary role right after Team Size. This enables role-focused product tours and sensible defaults.

## What Changes

- Add a third onboarding step "User Role" following Team Size
- Options (exact labels):
  - Product Manager
  - Engineer
  - Designer
  - Founder / Executive
  - Project Manager
- Allow Skip; selection is optional
- Persist role in team/workspace settings or a lightweight onboarding profile
- The question text shown to the user MUST be: "What’s your role?"

## Impact

- Affected specs: team-onboarding
- Affected code:
  - `app/onboarding/` add Role step UI
  - `app/api/teams/create` (optionally accept `userRole`) or new endpoint to update onboarding metadata
  - Persist selection in `Workspace.settings` (or dedicated field if later promoted)
