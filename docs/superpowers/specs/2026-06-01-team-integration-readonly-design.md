# LUM-131 — Make team-level integrations read-only for non-admin members

**Date:** 2026-06-01
**Branch:** `lumo/LUM-131-team-integration-readonly`
**Task:** [LUM-131](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-131)

## Goal

For **non-admin** workspace members, tighten the integrations settings page so that
TEAM-level integrations (Slack, GitHub, Sentry) are **view-only**:

1. Only **connected** TEAM integrations are shown — unconnected TEAM cards are hidden.
2. Non-admins cannot connect or disconnect TEAM integrations (no Connect button, no
   reauthorize/disconnect menu, no inner management controls).
3. The **connected personal account name** is not shown on TEAM cards — for **everyone**.

PERSONAL integrations (Figma, Google Drive) are unaffected.

## Definitions

- **Admin** = workspace **OWNER**. The codebase has no team-level admin role:
  `WorkspaceRole { OWNER, MEMBER }` on `WorkspaceMember.role`; `TeamMember` has no role
  field. The integrations page already computes `isOwner = member.role === 'OWNER'` and
  threads it down to the cards. We reuse `isOwner` as the admin gate — no schema change.
- **TEAM vs PERSONAL** comes from `lib/integrations/registry.ts`:
  TEAM = `slack`, `sentry`, `github`; PERSONAL = `figma`, `googleDrive`.

## Current state (baseline)

- `app/workspace/[workspaceUrl]/settings/integrations/page.tsx` (server component) resolves
  `isOwner` and renders `<IntegrationsPage isOwner={...} />`.
- `IntegrationsPage.tsx` groups card ids by `kind`, renders every card regardless of
  connection state, and floats connected cards to the top via CSS `order`. Each card reports
  its own connection state up through `onConnectedChange` into a `connectedMap` (cards fetch
  their status asynchronously via per-integration react-query hooks).
- The three TEAM cards (`GitHubIntegrationCard`, `SlackIntegrationCard`, `SentryIntegrationCard`)
  already gate the Connect button (`isOwner ? <Button> : null`), the reauthorize/disconnect
  overflow menu (`connected && isOwner ? … : undefined` → menu hidden entirely for non-owners),
  and inner management (add repo, remove repo, manage mappings) on `isOwner`.

### Requirement-by-requirement gap analysis

| Req                                        | Status today                                                                | Work needed                     |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------- |
| ② non-admin can't connect/disconnect       | **Already implemented** in all three TEAM cards                             | Add a regression test only      |
| ① non-admin sees only connected TEAM cards | Not implemented — all cards render; non-owner sees a buttonless "dead card" | Page-level visibility gating    |
| ③ hide personal account name               | Not implemented                                                             | Remove the GitHub `@login` line |

## Design

### Requirement ① — hide unconnected TEAM cards from non-owners (page-level)

**Constraint:** connection state is fetched per-card (async, client-side) and reported up via
`onConnectedChange`. The page does not know connection state until a card mounts and reports.
Therefore cards must keep mounting; visibility is a presentational decision on the wrapper.

**Approach (chosen): centralize visibility in `IntegrationsPage`.**

- Cards always mount (so they fetch + report `connectedMap`).
- Per-card wrapper is **visually hidden** (`hidden` attribute) when
  `!isOwner && kind === 'TEAM' && connectedMap[id] !== true`.
- A TEAM **section** (its `<h2>` + description + grid) is hidden when, for a non-owner, no TEAM
  card is connected: `sectionVisible = isOwner || ids.some(id => connectedMap[id] === true)`.
  This generalizes to any kind but only matters for TEAM in practice.
- Needs an `id → kind` lookup (derive from `INTEGRATIONS` registry, single source of truth)
  alongside the existing `idsByKind`.

**Behavior:**

- Owner: unchanged — all cards + sections shown.
- Non-owner, load moment: TEAM section starts empty/hidden; connected TEAM cards appear once
  their fetch resolves. Unconnected TEAM cards **never appear** (no dead-card flicker).
- PERSONAL cards (Figma, Google Drive) always render — unaffected.

**Rejected alternatives:**

- _Card-level `null` render_ when `!isOwner && !connected`: duplicates logic across 3 cards and
  still needs page logic for the empty-section case. More files, no benefit.
- _Server-side prefetch_ of all connection states in `page.tsx`: diverges from the established
  per-card hook architecture and is a much larger change. Out of scope.

### Requirement ② — non-admin can't connect/disconnect

No logic change — already enforced. Add a jsdom regression test asserting that a non-owner does
**not** see the Connect button or the overflow (⋯) menu on a TEAM card, while an owner does.

### Requirement ③ — hide personal account name on TEAM cards (everyone)

Across the three TEAM cards, the only **personal account** identity line is GitHub's
`Connected as @{githubLogin}` ([GitHubIntegrationCard.tsx:91-101](../../../app/workspace/[workspaceUrl]/components/GitHubIntegrationCard.tsx)).
Slack's `slackTeamName` and Sentry's `orgSlug` are team-resource identifiers (workspace name /
org slug), not personal accounts — per the decision ("仅个人账号"), they **stay**.

**Change:** remove the GitHub "Connected as @login" `<p>` entirely (for all users). The
authorized-repos list and the add-repo control are untouched. No i18n key is added; the
`github.connectedAs` key becomes unused (leave it in locale files; removing it is out of scope
and risks churn).

> Note: this is a UI-level hide. `githubLogin` is still returned by the status API, so a member
> could read it via devtools. Server-side redaction for non-owners is a possible follow-up,
> **not** in this task's scope.

## Files touched

- `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx` — visibility gating
  (per-card `hidden`, per-section hide) using `isOwner` + `connectedMap` + an `id → kind` map.
- `app/workspace/[workspaceUrl]/components/GitHubIntegrationCard.tsx` — remove the
  `Connected as @login` identity line.
- Tests (new, `__tests__/`):
  - `IntegrationsPage` visibility: non-owner hides unconnected TEAM cards + empty TEAM section;
    owner shows everything; PERSONAL always shown.
  - `IntegrationsPage` / TEAM card: non-owner sees no Connect button and no ⋯ menu (req ②
    regression); owner does.
  - `GitHubIntegrationCard`: connected state no longer renders the `@login` line.

No changes to: registry, Prisma schema, API routes, services, repositories, API clients,
PERSONAL cards.

## Testing & verification

- jsdom component tests (per project note: the preview browser can't reach the local dev server,
  so UI is verified via tsc + jsdom component tests + token lint, not a running server).
- `npx tsc --noEmit` — no type errors.
- `npm test` — all tests pass.
- `npm run lint:tokens` — no new hardcoded color/token violations.

## Out of scope

- Any team-level admin role / `TeamMember.role` model.
- Server-side redaction of `githubLogin` (or other identities) for non-owners.
- Removing the now-unused `github.connectedAs` i18n key.
- Changes to PERSONAL integrations.
