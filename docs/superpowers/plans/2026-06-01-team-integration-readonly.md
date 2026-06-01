# Team-Level Integrations Read-Only for Non-Admins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For non-owner workspace members, show only connected TEAM integrations (hide unconnected cards and the empty TEAM section), keep them view-only, and hide the GitHub personal-account (`@login`) line for everyone.

**Architecture:** Two client components change. `IntegrationsPage` gains a presentational visibility gate driven by the existing `isOwner` prop + the `connectedMap` it already collects (cards keep mounting so they still fetch + report; visibility is applied via the `hidden` attribute on each card wrapper and on the section). `GitHubIntegrationCard` drops its `Connected as @login` line. Non-admin connect/disconnect gating already exists in all three TEAM cards — covered by regression tests only.

**Tech Stack:** Next.js 14 (App Router), TypeScript (strict), React, react-intl, Jest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-06-01-team-integration-readonly-design.md`

---

## File Structure

- **Modify** `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx` — add an `id → kind` map and a per-card visibility predicate; apply `hidden` to each card wrapper and to each `<section>`.
- **Modify** `app/workspace/[workspaceUrl]/components/GitHubIntegrationCard.tsx` — remove the `Connected as @{githubLogin}` paragraph.
- **Modify** `__tests__/components/IntegrationsPage.test.tsx` — add owner/non-owner visibility tests.
- **Create** `__tests__/components/GitHubIntegrationCard.test.tsx` — req ③ (no `@login` line) + req ② regression (no Connect / no ⋯ menu for non-owners).

No other layers change (no registry, schema, API, services, repositories, API clients, or PERSONAL cards).

---

## Task 1: Page-level visibility gate in IntegrationsPage (req ①)

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx`
- Test: `__tests__/components/IntegrationsPage.test.tsx`

Behavior to build: a TEAM card is visible to a non-owner only once it reports `connected`; owners and all PERSONAL cards are always visible. A `<section>` is hidden when none of its cards are visible. Cards always mount (so they still fetch and report into `connectedMap`); we only toggle the `hidden` attribute.

- [ ] **Step 1: Add a `wrapperOf` helper + failing visibility tests**

Append to `__tests__/components/IntegrationsPage.test.tsx`. Add this helper next to the existing `orderOf` helper (after line 77):

```tsx
function wrapperOf(testId: string): HTMLElement {
  return screen.getByTestId(testId).parentElement as HTMLElement
}
```

Then add these two `describe` blocks after the existing `describe('IntegrationsPage', …)` block (keep the existing `beforeEach` that clears `CONNECTED`; these blocks rely on the same module-level `CONNECTED` map and the same mocked cards):

```tsx
describe('IntegrationsPage — non-owner visibility', () => {
  beforeEach(() => {
    for (const k of Object.keys(CONNECTED)) delete CONNECTED[k]
  })

  it('hides unconnected TEAM cards but shows connected ones', () => {
    CONNECTED.github = true // only GitHub connected
    render(<IntegrationsPage isOwner={false} />)
    expect(wrapperOf('card-github').hidden).toBe(false)
    expect(wrapperOf('card-slack').hidden).toBe(true)
    expect(wrapperOf('card-sentry').hidden).toBe(true)
  })

  it('always shows PERSONAL cards to non-owners', () => {
    render(<IntegrationsPage isOwner={false} />)
    expect(wrapperOf('card-figma').hidden).toBe(false)
    expect(wrapperOf('card-googleDrive').hidden).toBe(false)
  })

  it('hides the TEAM section when no team integration is connected', () => {
    const { container } = render(<IntegrationsPage isOwner={false} />)
    const teamSection = container.querySelectorAll('section')[0] as HTMLElement
    expect(teamSection.hidden).toBe(true)
  })

  it('shows the TEAM section when at least one team integration is connected', () => {
    CONNECTED.slack = true
    const { container } = render(<IntegrationsPage isOwner={false} />)
    const teamSection = container.querySelectorAll('section')[0] as HTMLElement
    expect(teamSection.hidden).toBe(false)
  })
})

describe('IntegrationsPage — owner visibility', () => {
  beforeEach(() => {
    for (const k of Object.keys(CONNECTED)) delete CONNECTED[k]
  })

  it('shows every TEAM card and the TEAM section even when none are connected', () => {
    const { container } = render(<IntegrationsPage isOwner />)
    expect(wrapperOf('card-github').hidden).toBe(false)
    expect(wrapperOf('card-slack').hidden).toBe(false)
    expect(wrapperOf('card-sentry').hidden).toBe(false)
    const teamSection = container.querySelectorAll('section')[0] as HTMLElement
    expect(teamSection.hidden).toBe(false)
  })
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm test -- __tests__/components/IntegrationsPage.test.tsx`
Expected: the four non-owner tests FAIL (today every card wrapper renders visible, so `.hidden` is `false` for slack/sentry and the TEAM section is never hidden). The owner test and all pre-existing tests PASS.

- [ ] **Step 3: Add the `id → kind` map and visibility predicate**

In `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx`, the registry imports already include `IntegrationKind`. Right after the existing `idsByKind` `useMemo` (currently ending at line 101), add:

```tsx
// Flat id → kind lookup (registry is the single source of truth).
const kindById = useMemo(() => {
  const m = {} as Record<IntegrationId, IntegrationKind>
  for (const { id, kind } of Object.values(INTEGRATIONS)) m[id] = kind
  return m
}, [])

// TEAM cards are view-only and hidden from non-owners until they report
// connected; owners and PERSONAL cards are always visible. Recomputed each
// render because it reads the live connectedMap.
const isCardVisible = (id: IntegrationId) =>
  isOwner || kindById[id] !== 'TEAM' || connectedMap[id] === true
```

- [ ] **Step 4: Apply `hidden` to the section and each card wrapper**

In the same file, replace the section/card render block. The current block is:

```tsx
{
  KIND_ORDER.map(kind => {
    const ids = idsByKind[kind]
    if (ids.length === 0) return null
    const section = SECTION_KEY[kind]
    return (
      <section key={kind}>
        <h2 className='text-sm font-medium text-foreground mb-1'>
          {intl.formatMessage({ id: `integrations.${section}.title` })}
        </h2>
        <p className='text-sm text-muted-foreground mb-4'>
          {intl.formatMessage({
            id: `integrations.${section}.description`,
          })}
        </p>
        <div className='flex flex-col gap-4'>
          {ids.map((id, index) => (
            <div
              key={id}
              style={{ order: (connectedMap[id] ? 0 : 100) + index }}
            >
              {cards[id]}
            </div>
          ))}
        </div>
      </section>
    )
  })
}
```

Replace it with (adds `const sectionVisible`, `hidden={!sectionVisible}` on `<section>`, and `hidden={!isCardVisible(id)}` on the wrapper):

```tsx
{
  KIND_ORDER.map(kind => {
    const ids = idsByKind[kind]
    if (ids.length === 0) return null
    const section = SECTION_KEY[kind]
    const sectionVisible = ids.some(id => isCardVisible(id))
    return (
      <section key={kind} hidden={!sectionVisible}>
        <h2 className='text-sm font-medium text-foreground mb-1'>
          {intl.formatMessage({ id: `integrations.${section}.title` })}
        </h2>
        <p className='text-sm text-muted-foreground mb-4'>
          {intl.formatMessage({
            id: `integrations.${section}.description`,
          })}
        </p>
        <div className='flex flex-col gap-4'>
          {ids.map((id, index) => (
            <div
              key={id}
              hidden={!isCardVisible(id)}
              style={{ order: (connectedMap[id] ? 0 : 100) + index }}
            >
              {cards[id]}
            </div>
          ))}
        </div>
      </section>
    )
  })
}
```

- [ ] **Step 5: Run the full IntegrationsPage test file to verify it passes**

Run: `npm test -- __tests__/components/IntegrationsPage.test.tsx`
Expected: PASS — all pre-existing tests plus the new owner/non-owner tests. (The pre-existing tests render with `isOwner`, so every card stays visible and `style.order` is untouched.)

- [ ] **Step 6: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/IntegrationsPage.tsx __tests__/components/IntegrationsPage.test.tsx
git commit -m "feat: hide unconnected team integrations from non-owners [LUM-131]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Remove GitHub `@login` line (req ③) + non-admin regression locks (req ②)

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/GitHubIntegrationCard.tsx:89-101`
- Test: `__tests__/components/GitHubIntegrationCard.test.tsx` (new)

Req ② (non-owner cannot connect/disconnect) is already implemented in the card; its tests below should pass immediately and exist to lock the behavior. The req ③ test (`@login` absent) is the red→green driver for the code change.

- [ ] **Step 1: Create the GitHub card test file**

Create `__tests__/components/GitHubIntegrationCard.test.tsx`:

```tsx
/** @jest-environment jsdom */

/**
 * GitHubIntegrationCard is a TEAM integration card.
 * - req ③: the connected personal account (@login) line is never rendered.
 * - req ②: non-owners get no Connect button and no overflow (⋯) menu.
 * react-intl and the network hook are mocked so the test exercises only the
 * card's owner-gating and connected-body markup.
 */
const messages: Record<string, string> = {
  'github.title': 'GitHub',
  'github.description': 'desc',
  'github.connected': 'Connected',
  'github.connectedAs': 'Connected as',
  'github.authorizedRepos': 'Authorized repositories',
  'github.noRepos': 'No repositories',
  'github.addRepo': 'Add repository',
  'github.addRepoDesc': 'Pick a repo',
  'github.removeRepo': 'Remove',
  'github.disconnectTitle': 'Disconnect GitHub',
  'github.disconnectDesc': 'Are you sure?',
  'common.connect': 'Connect',
  'common.reauthorize': 'Reauthorize',
  'common.disconnect': 'Disconnect',
  'common.cancel': 'Cancel',
  'common.moreOptions': 'More options',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

// Mutable hook return; tests set `.status` before rendering.
const mockHook = {
  status: null as null | {
    connected: boolean
    githubLogin?: string
    repositories?: string[]
  },
  loading: false,
  disconnectOpen: false,
  setDisconnectOpen: jest.fn(),
  disconnecting: false,
  addRepoOpen: false,
  setAddRepoOpen: jest.fn(),
  availableRepos: [] as { fullName: string; name: string; private: boolean }[],
  loadingRepos: false,
  handleConnect: jest.fn(),
  handleDisconnect: jest.fn(),
  handleRemoveRepo: jest.fn(),
  openAddRepo: jest.fn(),
  handleAddRepo: jest.fn(),
}

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useGitHubIntegration', () => ({
  useGitHubIntegration: () => mockHook,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { GitHubIntegrationCard } from '@/app/workspace/[workspaceUrl]/components/GitHubIntegrationCard'

describe('GitHubIntegrationCard', () => {
  beforeEach(() => {
    mockHook.status = null
    mockHook.loading = false
  })

  it('never renders the connected personal account (@login) line', () => {
    mockHook.status = {
      connected: true,
      githubLogin: 'octocat',
      repositories: ['acme/web'],
    }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

    // Expand the collapsible connected body.
    fireEvent.click(screen.getByRole('button', { expanded: false }))

    // Body is open (repos header is visible) ...
    expect(screen.getByText('Authorized repositories')).toBeInTheDocument()
    // ... but the personal account identity line is gone.
    expect(screen.queryByText('Connected as')).not.toBeInTheDocument()
    expect(screen.queryByText(/octocat/)).not.toBeInTheDocument()
  })

  it('shows no Connect button to non-owners when disconnected', () => {
    mockHook.status = { connected: false }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner={false} />)
    expect(
      screen.queryByRole('button', { name: 'Connect' })
    ).not.toBeInTheDocument()
  })

  it('shows a Connect button to owners when disconnected', () => {
    mockHook.status = { connected: false }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('shows no overflow (⋯) menu to non-owners when connected', () => {
    mockHook.status = {
      connected: true,
      githubLogin: 'octocat',
      repositories: [],
    }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner={false} />)
    expect(
      screen.queryByRole('button', { name: 'More options' })
    ).not.toBeInTheDocument()
  })

  it('shows the overflow (⋯) menu to owners when connected', () => {
    mockHook.status = {
      connected: true,
      githubLogin: 'octocat',
      repositories: [],
    }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)
    expect(
      screen.getByRole('button', { name: 'More options' })
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test file to verify the req ③ test fails**

Run: `npm test -- __tests__/components/GitHubIntegrationCard.test.tsx`
Expected: `never renders the connected personal account (@login) line` FAILS (today the card renders `Connected as` + `@octocat`). The four req ② regression tests PASS (gating already exists).

- [ ] **Step 3: Remove the `@login` identity line from the card**

In `app/workspace/[workspaceUrl]/components/GitHubIntegrationCard.tsx`, the connected body currently opens like this (lines 89-103):

```tsx
        {status?.connected ? (
          <>
            <p className='text-xs text-zinc-500 dark:text-zinc-400'>
              {intl.formatMessage({ id: 'github.connectedAs' })}{' '}
              <a
                href={`https://github.com/${status.githubLogin}`}
                target='_blank'
                rel='noopener noreferrer'
                className='font-medium text-zinc-700 dark:text-zinc-300 hover:underline'
              >
                @{status.githubLogin}
              </a>
            </p>

            {/* Authorized repos */}
```

Replace that span with the identity paragraph removed (keep the fragment and the repos block):

```tsx
        {status?.connected ? (
          <>
            {/* Authorized repos */}
```

(Net effect: delete the `<p>…@{status.githubLogin}…</p>` element and the blank line that follows it. Leave everything from `{/* Authorized repos */}` onward unchanged. `intl` is still used elsewhere in the card, so no import becomes unused.)

- [ ] **Step 4: Run the test file to verify all pass**

Run: `npm test -- __tests__/components/GitHubIntegrationCard.test.tsx`
Expected: PASS — all five tests.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/GitHubIntegrationCard.tsx __tests__/components/GitHubIntegrationCard.test.tsx
git commit -m "feat: hide GitHub account name on team integration card [LUM-131]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: no errors. (If you see "TaskArtifact not exported"-style noise, run `npx prisma generate` first — that's a stale generated client, not this change.)

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS, including `__tests__/components/IntegrationsPage.test.tsx` and `__tests__/components/GitHubIntegrationCard.test.tsx`.

- [ ] **Step 3: Token lint**

Run: `npm run lint:tokens`
Expected: no new violations (this change only removes markup and toggles `hidden`; it adds no colors).

- [ ] **Step 4: Final review of the diff**

Run: `git diff main --stat`
Expected: only the two component files, two test files, and the two `docs/superpowers/` markdown files changed.

---

## Self-Review

**Spec coverage:**

- Req ① (non-owner sees only connected TEAM cards; empty TEAM section hidden) → Task 1.
- Req ② (non-owner cannot connect/disconnect) → already implemented; locked by Task 2 regression tests.
- Req ③ (hide personal account name for everyone) → Task 2, GitHub `@login` line removed.
- PERSONAL integrations unaffected → asserted by Task 1 "always shows PERSONAL cards" test and unchanged Figma/Drive cards.
- Definitions (admin = workspace OWNER, reuse `isOwner`) → no schema change; both tasks use the existing `isOwner` prop.

**Type consistency:** `isCardVisible(id: IntegrationId)`, `kindById: Record<IntegrationId, IntegrationKind>`, and `connectedMap: Record<string, boolean>` align with the existing `idsByKind` typing and the registry exports (`IntegrationId`, `IntegrationKind`, `INTEGRATIONS`). The GitHub test's `mockHook` shape matches `UseGitHubIntegrationReturn` fields consumed by the card.

**Placeholder scan:** none — every step shows exact code/commands.
