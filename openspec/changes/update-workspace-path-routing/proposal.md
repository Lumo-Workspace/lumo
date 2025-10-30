## Why

We need first-class, path-based workspace routing so users land on and share URLs scoped to their team, e.g. `/app/{workspaceUrl}`. This improves clarity, deep-linking, and multi-tenancy isolation.

## What Changes

- Introduce path-based workspace routing under `/app/{workspaceUrl}`
- Redirect `/app` → `/app/{workspaceUrl}` when a default workspace is known
- Guard access: unknown or unauthorized `{workspaceUrl}` redirects to onboarding or shows 404/forbidden per access
- Ensure onboarding completion redirects directly to `/app/{workspaceUrl}`

## Impact

- Affected specs: team-onboarding, app-routing
- Affected code:
  - App routes under `app/app/` (dynamic segment addition)
  - Middleware to resolve workspace context from path and session
  - Session callback ensures `workspaceUrl` present for default workspace
  - Onboarding submit redirect to `/app/{workspaceUrl}`
