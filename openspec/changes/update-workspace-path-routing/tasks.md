## 1. Specs

- [ ] 1.1 Add/modify specs for app-routing and onboarding redirects
- [ ] 1.2 Validate with `openspec validate --strict`

## 2. Routing

- [ ] 2.1 Add dynamic segment route `app/app/[workspaceUrl]/page.tsx`
- [ ] 2.2 Redirect `/app` to `/app/{workspaceUrl}` when session has a default workspace
- [ ] 2.3 Handle unknown workspace slug with 404 or redirect to onboarding if user has no team

## 3. Middleware & Session

- [ ] 3.1 Middleware to extract `{workspaceUrl}` and verify access
- [ ] 3.2 Ensure session callback adds `workspaceUrl` for default team

## 4. Onboarding

- [ ] 4.1 Ensure post-creation redirect goes to `/app/{workspaceUrl}`
- [ ] 4.2 Add tests/checks for deep-linking into `/app/{workspaceUrl}`

## 5. QA

- [ ] 5.1 Verify redirects for unauthenticated → `/login`
- [ ] 5.2 Verify user without team → `/onboarding`
- [ ] 5.3 Verify invalid slug → 404/forbidden
- [ ] 5.4 Verify copy/paste sharing of workspace URLs
