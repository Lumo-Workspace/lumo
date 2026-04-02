# Preferences Page Design

## Overview

Add a **Preferences** page under Settings → Personal, containing theme selection (Light/Dark/System), language (中文/English), timezone, and granular notification controls per event type × channel.

## UI Layout

Follow existing Settings Card-row pattern (see `ProfilePage.tsx`). Three cards on a single scrollable page.

### Card 1: Appearance

| Row      | Icon    | Label    | Control                                                |
| -------- | ------- | -------- | ------------------------------------------------------ |
| Theme    | `Sun`   | Theme    | `SegmentedControl` — Light / Dark / System             |
| Language | `Globe` | Language | `Select` — 中文 / English                              |
| Timezone | `Clock` | Timezone | `Select` — searchable list, default = browser detected |

**Theme behavior:**

- Light → force light
- Dark → force dark
- System → follow `prefers-color-scheme` media query

### Card 2: In-App Notifications

| Row                            | Label    | Control |
| ------------------------------ | -------- | ------- |
| Task assigned to me            | `Switch` | on/off  |
| New comment on my tasks        | `Switch` | on/off  |
| Agent completed / needs review | `Switch` | on/off  |
| Agent waiting for input        | `Switch` | on/off  |
| Mentioned in a comment         | `Switch` | on/off  |

### Card 3: Slack Notifications

Same 5 event rows, each with an independent `Switch`.

If Slack is not integrated for the workspace, show a disabled state with a hint: "Connect Slack in Integrations to enable."

## Data Model

New Prisma model storing per-member preferences:

```prisma
model UserPreference {
  id        String @id @default(cuid())
  memberId  String @unique    // FK → WorkspaceMember.id
  member    WorkspaceMember @relation(fields: [memberId], references: [id], onDelete: Cascade)

  // Appearance
  theme     String @default("system")   // "light" | "dark" | "system"
  locale    String @default("en")       // "en" | "zh"
  timezone  String @default("auto")     // IANA tz string or "auto"

  // In-app notification toggles (default all on)
  notifyInAppAssigned      Boolean @default(true)
  notifyInAppComment       Boolean @default(true)
  notifyInAppAgentDone     Boolean @default(true)
  notifyInAppAgentInput    Boolean @default(true)
  notifyInAppMention       Boolean @default(true)

  // Slack notification toggles (default all on)
  notifySlackAssigned      Boolean @default(true)
  notifySlackComment       Boolean @default(true)
  notifySlackAgentDone     Boolean @default(true)
  notifySlackAgentInput    Boolean @default(true)
  notifySlackMention       Boolean @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("user_preferences")
}
```

Add reverse relation on `WorkspaceMember`:

```prisma
preference UserPreference?
```

**FK choice:** Uses `memberId` (WorkspaceMember.id) per project convention — never clerkId as FK.

## API

### `GET /api/users/preferences`

- Auth: `requireAuth()` → resolve memberId from clerkId + workspace
- Returns: full `UserPreference` object (create with defaults if not exists)
- Cache: client caches in localStorage (`lumo:preferences`), API as source of truth

### `PATCH /api/users/preferences`

- Auth: same
- Body: partial `UserPreference` fields (only send changed fields)
- Validates enum values (theme, locale, timezone)
- Returns: updated `UserPreference`

## Theme Implementation

Replace custom `useDarkMode()` hook with `next-themes` (already installed v0.4.6):

1. Wrap app in `<ThemeProvider attribute="class" defaultTheme="system">` inside `Providers.tsx`
2. New `useThemePreference()` hook:
   - Reads theme from preferences API (cached in localStorage)
   - Calls `setTheme()` from `next-themes` to apply
   - On preference change → PATCH API + update localStorage + `setTheme()`
3. Delete `useDarkMode.ts`
4. Remove dark-mode toggle from `Sidebar.tsx` footer
5. Remove manual dark-mode restoration in `SettingsShell.tsx`

## Client Caching Strategy

Per project convention (cache-first, optimistic loading):

1. On app load → read `lumo:preferences` from localStorage → apply immediately
2. Fetch `GET /api/users/preferences` in background → update localStorage if different
3. On preference change → update localStorage + UI immediately → PATCH API in background
4. If API fails → toast error, revert localStorage + UI

## Locale Handling

Phase 1 (this spec): locale preference stored in DB, exposed via `usePreferences()` hook. UI labels remain hardcoded English. Date/time formatting uses `Intl.DateTimeFormat` with the stored locale.

Phase 2 (future): full i18n with translation files. Out of scope.

## Navigation

Add to `SettingsShell.tsx` personalItems:

```typescript
{
  label: 'Preferences',
  href: `/workspace/${workspaceUrl}/settings/preferences`,
  icon: Settings2,  // from lucide-react
}
```

Position: between Profile and API Keys.

## Files to Create/Modify

**New files:**

- `prisma/migrations/YYYYMMDD_add_user_preferences/migration.sql`
- `app/api/users/preferences/route.ts` — GET + PATCH
- `app/workspace/[workspaceUrl]/settings/preferences/page.tsx` — thin route wrapper
- `app/workspace/[workspaceUrl]/components/pages/PreferencesPage.tsx` — main UI
- `app/workspace/[workspaceUrl]/hooks/usePreferences.ts` — preferences hook (fetch + cache + mutate)
- `app/workspace/[workspaceUrl]/hooks/useThemePreference.ts` — theme sync with next-themes
- `__tests__/api/users/preferences.test.ts`

**Modified files:**

- `prisma/schema.prisma` — add `UserPreference` model + relation on `WorkspaceMember`
- `app/workspace/[workspaceUrl]/components/Providers.tsx` — wrap with `<ThemeProvider>`
- `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx` — add Preferences nav item, remove dark-mode restoration
- `app/workspace/[workspaceUrl]/components/Sidebar.tsx` — remove dark-mode toggle button
- `app/workspace/[workspaceUrl]/components/WorkspaceApp.tsx` — remove `useDarkMode()` usage

**Deleted files:**

- `app/workspace/[workspaceUrl]/hooks/useDarkMode.ts`
