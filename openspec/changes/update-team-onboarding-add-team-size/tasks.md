## 1. Specs

- [ ] 1.1 Add spec deltas (team-onboarding) for Team Size step and CTA change
- [ ] 1.2 Validate change with `openspec validate --strict`

## 2. UI Flow

- [ ] 2.1 Update Team Name step CTA to "Continue"
- [ ] 2.2 Create Team Size step page/component under `app/onboarding/`
- [ ] 2.3 Add select input with predefined ranges (exact):
      "1 (Just me)", "2–5", "6–20", "21–50", "51–200", "200+"
- [ ] 2.4 Add navigation: Team Name → Team Size (Continue), with ability to Skip
- [ ] 2.5 Preserve name/URL state across steps

## 3. API & Persistence

- [ ] 3.1 Extend `/api/teams/create` to accept optional `teamSize`
- [ ] 3.2 Store `teamSize` on `Team` or `Workspace.settings`
- [ ] 3.3 Validate allowed values server-side (must match exact options)

## 4. Middleware / Session

- [ ] 4.1 Ensure session reflects team context post-onboarding (unchanged)

## 5. QA / Testing

- [ ] 5.1 Verify step transition and back/skip behaviour
- [ ] 5.2 Verify `teamSize` persists when provided
- [ ] 5.3 Verify CTA text changed on Team Name step
- [ ] 5.4 Accessibility pass for keyboard-only users
