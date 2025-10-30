## 1. Specs

- [ ] 1.1 Add spec deltas (team-onboarding) for Role step and options
- [ ] 1.2 Validate change with `openspec validate --strict`

## 2. UI Flow

- [ ] 2.1 Add Role step after Team Size with options (exact labels)
- [ ] 2.2 Use shadcn Select or segmented choices; include Skip
- [ ] 2.3 Carry previous state (team name, URL, size) to this step

## 3. API & Persistence

- [ ] 3.1 Extend team creation to accept optional `userRole`, or add separate endpoint `/api/onboarding/role`
- [ ] 3.2 Persist role into `Workspace.settings.userRole`
- [ ] 3.3 Validate allowed values server-side

## 4. QA / Testing

- [ ] 4.1 Verify step transition and skip behaviour
- [ ] 4.2 Verify persistence and retrieval of `userRole`
- [ ] 4.3 Accessibility and keyboard navigation
