## Why

Team onboarding currently collects only the team name. We want to improve personalization and future defaults by asking for company size in the next step, and make the first step CTA read "Continue" instead of implying immediate creation.

## What Changes

- Add a second onboarding step to capture Team Size (company size) after Team Name
- Update the Team Name step primary CTA label from "Create Team" to "Continue"
- Persist the chosen Team Size with the Team (or in Workspace settings) during creation/finish
- Keep URL behaviour unchanged (auto-sync with name, overridable)

Team Size options (exact): "1 (Just me)", "2–5", "6–20", "21–50", "51–200", "200+"

## Impact

- Affected specs: team-onboarding
- Affected code:
  - `app/onboarding/` multi-step flow (new Team Size step UI)
  - `app/api/teams/create` (accept optional `teamSize`)
  - Validation and navigation between steps
  - Minor copy change on CTA text from "Create Team" → "Continue"
