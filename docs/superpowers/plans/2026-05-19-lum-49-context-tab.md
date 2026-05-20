# LUM-49: Unified "Context" Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Verify-before-execute:** The user's standing preference is to run a plan-verification pass against the codebase before any task. Re-read the key files referenced in each task and confirm signatures/paths still match before editing.

**Goal:** Replace the task drawer's "Slack Context" tab with a unified "Context" tab that contains collapsible sections (Slack, Pull Requests, Documents). Move the PR list out of the right sidebar into this new tab.

**Architecture:**

- One container component (`ContextTab`) lifts data for every section (Slack contexts via existing hook, PRs from props, Documents via a new hook) and computes which sections default-open (count > 0).
- A presentational `ContextSection` primitive (built on the existing Radix Accordion at `components/landing/ui/accordion.tsx`) renders a header (icon + label + count badge + optional Add slot) plus collapsible body.
- Three per-source section leaves (`SlackContextSection`, `PullRequestsSection`, `DocumentsSection`) are dumb — they receive their data and handlers as props.
- The current `SlackContextTab.tsx` content is absorbed into `SlackContextSection` and the file is deleted.
- The PR list is removed from `TaskDetailSidebar.tsx`. The link/unlink handlers (already defined in `TaskDetailPage.tsx`) are passed down through `TimelineTabs` → `ContextTab` → `PullRequestsSection`.

**Tech Stack:** Next.js 14 (App Router), TypeScript, react-intl, Radix UI Accordion, Tailwind, Jest + React Testing Library.

**Out of scope (this PR):** Emails, Web Links, Discord sections. New schema/API for those is a separate task per LUM-49 scoping discussion. Do NOT render placeholder cards for them.

---

## File Map

**New files:**

- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextTab.tsx` — top-level container
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextSection.tsx` — shared collapsible primitive
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/SlackContextSection.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/PullRequestsSection.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx`
- `app/workspace/[workspaceUrl]/hooks/useTaskDocuments.ts`
- Tests for each of the above (mirror path under `__tests__/`)

**Modified files:**

- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`
- `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`
- All 17 locale files under `lib/i18n/`

**Deleted files:**

- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SlackContextTab.tsx`
- `__tests__/components/TaskDetailTimeline/SlackContextTab.test.tsx`

---

### Task 1: Add i18n keys to all locales

**Files:**

- Modify: `lib/i18n/en.json`, `lib/i18n/en-AU.json`, `lib/i18n/en-GB.json`, `lib/i18n/zh-CN.json`, `lib/i18n/zh-TW.json`, `lib/i18n/de.json`, `lib/i18n/es.json`, `lib/i18n/es-419.json`, `lib/i18n/fr.json`, `lib/i18n/hi.json`, `lib/i18n/id.json`, `lib/i18n/ja.json`, `lib/i18n/ko.json`, `lib/i18n/ms.json`, `lib/i18n/ru.json`, `lib/i18n/vi.json`

New keys to add (4 keys per locale). Existing keys `task.pullRequests`, `task.noPullRequests`, `task.unlinkPr`, and the `slackContext.*` family are reused — do not remove them. The unused `slackContext.tab` key is removed.

- [ ] **Step 1: Open `lib/i18n/en.json`, remove the `"slackContext.tab"` line, and add the four new keys (alphabetically placed in the `task.context.*` cluster).**

In `en.json`, delete:

```json
  "slackContext.tab": "Slack Context",
```

Add (sort alphabetically within the file, around the existing `task.*` block):

```json
  "task.context.tab": "Context",
  "task.context.section.slack": "Slack",
  "task.context.section.documents": "Documents",
  "task.context.documents.empty": "No documents linked",
```

- [ ] **Step 2: Repeat for `en-AU.json` and `en-GB.json` with the same English strings.**

- [ ] **Step 3: Repeat for the 14 non-English locales using the translations below.**

| Locale | tab          | section.slack | section.documents | documents.empty                      |
| ------ | ------------ | ------------- | ----------------- | ------------------------------------ |
| zh-CN  | 上下文       | Slack         | 文档              | 暂无关联文档                         |
| zh-TW  | 上下文       | Slack         | 文件              | 尚無關聯文件                         |
| de     | Kontext      | Slack         | Dokumente         | Keine Dokumente verknüpft            |
| es     | Contexto     | Slack         | Documentos        | No hay documentos vinculados         |
| es-419 | Contexto     | Slack         | Documentos        | No hay documentos vinculados         |
| fr     | Contexte     | Slack         | Documents         | Aucun document lié                   |
| hi     | संदर्भ       | Slack         | दस्तावेज़         | कोई दस्तावेज़ लिंक नहीं              |
| id     | Konteks      | Slack         | Dokumen           | Tidak ada dokumen tertaut            |
| ja     | コンテキスト | Slack         | ドキュメント      | リンクされたドキュメントはありません |
| ko     | 컨텍스트     | Slack         | 문서              | 연결된 문서가 없습니다               |
| ms     | Konteks      | Slack         | Dokumen           | Tiada dokumen dikaitkan              |
| ru     | Контекст     | Slack         | Документы         | Связанных документов нет             |
| vi     | Ngữ cảnh     | Slack         | Tài liệu          | Chưa có tài liệu liên kết            |

For each locale: remove its existing `"slackContext.tab": "<translated>"` entry (the value already varies per locale) before adding the new keys.

- [ ] **Step 4: Verify the JSON in every file is still valid.**

Run: `node -e "for (const f of require('fs').readdirSync('lib/i18n').filter(x => x.endsWith('.json'))) JSON.parse(require('fs').readFileSync('lib/i18n/' + f, 'utf8'))"`
Expected: no output (silent success).

- [ ] **Step 5: Commit.**

```bash
git add lib/i18n/
git commit -m "feat: add i18n keys for unified Context tab [LUM-49]"
```

---

### Task 2: Add `useTaskDocuments` hook (TDD)

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useTaskDocuments.ts`
- Test: `__tests__/hooks/useTaskDocuments.test.tsx`

The existing API route `GET /api/tasks/[id]/documents` already returns `{ documents: [{ id, title, emoji, updatedAt }] }`. The hook is a thin fetch wrapper, modeled on `useSlackContexts`.

- [ ] **Step 1: Write the failing test.**

Create `__tests__/hooks/useTaskDocuments.test.tsx`:

```tsx
jest.mock('@/lib/api-client/base', () => ({
  apiFetch: jest.fn(),
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { useTaskDocuments } from '@/app/workspace/[workspaceUrl]/hooks/useTaskDocuments'
import { apiFetch } from '@/lib/api-client/base'

const mockApiFetch = apiFetch as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('useTaskDocuments', () => {
  it('fetches documents on mount when enabled', async () => {
    mockApiFetch.mockResolvedValue({
      documents: [
        {
          id: 'd1',
          title: 'Doc',
          emoji: null,
          updatedAt: '2026-05-19T00:00:00Z',
        },
      ],
    })

    const { result } = renderHook(() => useTaskDocuments('tsk_1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockApiFetch).toHaveBeenCalledWith('/api/tasks/tsk_1/documents')
    expect(result.current.documents).toHaveLength(1)
    expect(result.current.documents[0].title).toBe('Doc')
  })

  it('skips fetch when enabled=false', async () => {
    renderHook(() => useTaskDocuments('tsk_1', false))
    await new Promise(r => setTimeout(r, 0))
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('captures error message on failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTaskDocuments('tsk_1'))
    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.documents).toEqual([])
  })

  it('refresh re-fetches on demand', async () => {
    mockApiFetch.mockResolvedValue({ documents: [] })
    const { result } = renderHook(() => useTaskDocuments('tsk_1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockApiFetch.mockClear()
    await act(async () => {
      await result.current.refresh()
    })
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx jest __tests__/hooks/useTaskDocuments.test.tsx`
Expected: FAIL with "Cannot find module '@/app/workspace/[workspaceUrl]/hooks/useTaskDocuments'".

- [ ] **Step 3: Write the hook.**

Create `app/workspace/[workspaceUrl]/hooks/useTaskDocuments.ts`:

```ts
'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client/base'

export interface TaskDocumentResource {
  id: string
  title: string
  emoji: string | null
  updatedAt: string
}

interface UseTaskDocumentsResult {
  documents: TaskDocumentResource[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useTaskDocuments(
  taskId: string,
  enabled = true
): UseTaskDocumentsResult {
  const [documents, setDocuments] = useState<TaskDocumentResource[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { documents } = await apiFetch<{
        documents: TaskDocumentResource[]
      }>(`/api/tasks/${taskId}/documents`)
      setDocuments(documents)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error')
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    if (!enabled) return
    void refresh()
  }, [enabled, refresh])

  return { documents, loading, error, refresh }
}
```

- [ ] **Step 4: Run test to verify pass.**

Run: `npx jest __tests__/hooks/useTaskDocuments.test.tsx`
Expected: PASS, all four tests green.

- [ ] **Step 5: Commit.**

```bash
git add app/workspace/\[workspaceUrl\]/hooks/useTaskDocuments.ts __tests__/hooks/useTaskDocuments.test.tsx
git commit -m "feat: add useTaskDocuments hook [LUM-49]"
```

---

### Task 3: Build `ContextSection` shared primitive (TDD)

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextSection.tsx`
- Test: `__tests__/components/TaskDetailTimeline/ContextSection.test.tsx`

This is a pure presentational wrapper around Radix Accordion's `AccordionItem`. It does not own the Accordion `Root` (the parent `ContextTab` does, so it can control the `defaultValue` list).

- [ ] **Step 1: Write the failing test.**

Create `__tests__/components/TaskDetailTimeline/ContextSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { Accordion } from '@/components/landing/ui/accordion'
import { ContextSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextSection'

describe('ContextSection', () => {
  it('renders label and count', () => {
    render(
      <Accordion type='multiple'>
        <ContextSection value='slack' label='Slack' count={3}>
          <div>body</div>
        </ContextSection>
      </Accordion>
    )
    expect(screen.getByText('Slack')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders the addSlot when provided', () => {
    render(
      <Accordion type='multiple'>
        <ContextSection
          value='slack'
          label='Slack'
          count={0}
          addSlot={<button>Add</button>}
        >
          <div>body</div>
        </ContextSection>
      </Accordion>
    )
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('expands body when defaultValue includes section value', () => {
    render(
      <Accordion type='multiple' defaultValue={['slack']}>
        <ContextSection value='slack' label='Slack' count={1}>
          <div>body-content</div>
        </ContextSection>
      </Accordion>
    )
    expect(screen.getByText('body-content')).toBeVisible()
  })
})
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx jest __tests__/components/TaskDetailTimeline/ContextSection.test.tsx`
Expected: FAIL with "Cannot find module '.../ContextSection'".

- [ ] **Step 3: Write the component.**

Create `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextSection.tsx`:

```tsx
'use client'

import * as React from 'react'
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/landing/ui/accordion'

interface Props {
  value: string
  label: string
  count: number
  icon?: React.ReactNode
  addSlot?: React.ReactNode
  children: React.ReactNode
}

export function ContextSection({
  value,
  label,
  count,
  icon,
  addSlot,
  children,
}: Props): React.ReactElement {
  return (
    <AccordionItem
      value={value}
      className='border border-zinc-200 dark:border-zinc-800 rounded-md mb-2 last:mb-0'
    >
      <div className='flex items-center pr-2'>
        <AccordionTrigger className='flex-1 px-3 py-2 text-sm hover:no-underline'>
          <span className='flex items-center gap-2'>
            {icon}
            <span className='font-medium'>{label}</span>
            <span className='text-xs text-zinc-500 tabular-nums'>{count}</span>
          </span>
        </AccordionTrigger>
        {addSlot && <div className='shrink-0 ml-2'>{addSlot}</div>}
      </div>
      <AccordionContent className='px-3 pb-3'>{children}</AccordionContent>
    </AccordionItem>
  )
}
```

- [ ] **Step 4: Run test to verify pass.**

Run: `npx jest __tests__/components/TaskDetailTimeline/ContextSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/ContextSection.tsx __tests__/components/TaskDetailTimeline/ContextSection.test.tsx
git commit -m "feat: add ContextSection collapsible primitive [LUM-49]"
```

---

### Task 4: Build `SlackContextSection` (port from SlackContextTab body) (TDD)

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/SlackContextSection.tsx`
- Test: `__tests__/components/TaskDetailTimeline/sections/SlackContextSection.test.tsx`

The new section receives `contexts` + handlers as props (no longer calls the hook itself — the hook moves up to `ContextTab`). The not-connected guard becomes an empty-state inside the section.

- [ ] **Step 1: Write the failing test.**

Create `__tests__/components/TaskDetailTimeline/sections/SlackContextSection.test.tsx`:

```tsx
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { id?: string; defaultMessage?: string }) =>
      d.id ?? d.defaultMessage ?? '',
  }),
}))

import { render, screen } from '@testing-library/react'
import { Accordion } from '@/components/landing/ui/accordion'
import { SlackContextSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/SlackContextSection'

const noop = jest.fn()
const handlers = { onLink: noop, onRefreshOne: noop, onUnlink: noop }

describe('SlackContextSection', () => {
  it('shows not-connected empty state when slackConnected=false', () => {
    render(
      <Accordion type='multiple' defaultValue={['slack']}>
        <SlackContextSection
          contexts={[]}
          slackConnected={false}
          {...handlers}
        />
      </Accordion>
    )
    expect(
      screen.getByText('slackContext.empty.notConnected')
    ).toBeInTheDocument()
  })

  it('shows no-contexts empty state when connected and empty', () => {
    render(
      <Accordion type='multiple' defaultValue={['slack']}>
        <SlackContextSection contexts={[]} slackConnected {...handlers} />
      </Accordion>
    )
    expect(
      screen.getByText('slackContext.empty.noContexts')
    ).toBeInTheDocument()
  })

  it('renders count in the header', () => {
    render(
      <Accordion type='multiple'>
        <SlackContextSection
          contexts={[
            {
              id: 'c1',
              snapshot: {
                messages: [{ ts: '1', text: 't', userId: 'u', userName: 'U' }],
              },
              snapshotAt: new Date().toISOString(),
              isThread: false,
              permalink: '#',
              slackChannelName: 'general',
              refreshError: null,
            } as never,
          ]}
          slackConnected
          {...handlers}
        />
      </Accordion>
    )
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx jest __tests__/components/TaskDetailTimeline/sections/SlackContextSection.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the component.**

Create `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/SlackContextSection.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Plus } from 'lucide-react'
import type { SlackContextResource } from '@/lib/api-client/slack-contexts'
import { ContextSection } from '../ContextSection'
import { SlackContextCard } from '../SlackContextCard'
import { AddSlackContextDialog } from '../AddSlackContextDialog'

interface Props {
  contexts: SlackContextResource[]
  slackConnected: boolean
  onLink: (permalink: string) => Promise<void>
  onRefreshOne: (contextId: string) => Promise<void>
  onUnlink: (contextId: string) => Promise<void>
}

export function SlackContextSection({
  contexts,
  slackConnected,
  onLink,
  onRefreshOne,
  onUnlink,
}: Props): React.ReactElement {
  const intl = useIntl()
  const [dialogOpen, setDialogOpen] = useState(false)

  const addSlot = slackConnected ? (
    <button
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        setDialogOpen(true)
      }}
      className='inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
    >
      <Plus size={12} />
      {intl.formatMessage({
        id: 'slackContext.add',
        defaultMessage: 'Add Slack message',
      })}
    </button>
  ) : null

  return (
    <>
      <ContextSection
        value='slack'
        label={intl.formatMessage({
          id: 'task.context.section.slack',
          defaultMessage: 'Slack',
        })}
        count={contexts.length}
        addSlot={addSlot}
      >
        {!slackConnected ? (
          <div className='py-4 text-sm text-zinc-500'>
            {intl.formatMessage({
              id: 'slackContext.empty.notConnected',
              defaultMessage:
                'Connect Slack to attach messages as task context.',
            })}
          </div>
        ) : contexts.length === 0 ? (
          <div className='py-4 text-sm text-zinc-500 text-center'>
            {intl.formatMessage({
              id: 'slackContext.empty.noContexts',
              defaultMessage: 'No Slack messages attached yet.',
            })}
          </div>
        ) : (
          <div className='space-y-3'>
            {contexts.map(c => (
              <SlackContextCard
                key={c.id}
                context={c}
                onRefresh={() => onRefreshOne(c.id)}
                onUnlink={() => onUnlink(c.id)}
              />
            ))}
          </div>
        )}
      </ContextSection>

      <AddSlackContextDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={async permalink => {
          await onLink(permalink)
        }}
      />
    </>
  )
}
```

- [ ] **Step 4: Run test to verify pass.**

Run: `npx jest __tests__/components/TaskDetailTimeline/sections/SlackContextSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/sections/SlackContextSection.tsx __tests__/components/TaskDetailTimeline/sections/SlackContextSection.test.tsx
git commit -m "feat: add SlackContextSection [LUM-49]"
```

---

### Task 5: Build `PullRequestsSection` (extract from sidebar) (TDD)

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/PullRequestsSection.tsx`
- Test: `__tests__/components/TaskDetailTimeline/sections/PullRequestsSection.test.tsx`

The PR row markup is copied verbatim from `TaskDetailSidebar.tsx:326-355`. Dependencies kept: `CiIcon`, `PrStateBadge`, `LinkPrPopover`. Section reuses the existing `task.pullRequests`, `task.noPullRequests`, `task.unlinkPr` i18n keys.

- [ ] **Step 1: Inspect `TaskDetailSidebar.tsx:1-100` to confirm import paths for `CiIcon`, `PrStateBadge`, `LinkPrPopover` and the `PullRequestSummary` (or equivalent) type used in `task.pullRequests`.**

Run: `grep -n "CiIcon\|PrStateBadge\|LinkPrPopover\|pullRequests" app/workspace/\[workspaceUrl\]/components/TaskDetailSidebar.tsx | head -20`
Expected: confirm the three component imports and the type of each PR object.

- [ ] **Step 2: Write the failing test.**

Create `__tests__/components/TaskDetailTimeline/sections/PullRequestsSection.test.tsx`:

```tsx
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { id?: string; defaultMessage?: string }) =>
      d.id ?? d.defaultMessage ?? '',
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/components/LinkPrPopover', () => ({
  LinkPrPopover: () => <div data-testid='link-pr-popover' />,
}))

import { render, screen } from '@testing-library/react'
import { Accordion } from '@/components/landing/ui/accordion'
import { PullRequestsSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/PullRequestsSection'

const baseProps = {
  taskId: 'tsk_1',
  workspaceId: 'ws_1',
  onLinkPr: jest.fn(),
  onUnlinkPr: jest.fn(),
}

describe('PullRequestsSection', () => {
  it('shows empty state when no PRs', () => {
    render(
      <Accordion type='multiple' defaultValue={['pullRequests']}>
        <PullRequestsSection {...baseProps} pullRequests={[]} />
      </Accordion>
    )
    expect(screen.getByText('task.noPullRequests')).toBeInTheDocument()
  })

  it('lists each PR', () => {
    render(
      <Accordion type='multiple' defaultValue={['pullRequests']}>
        <PullRequestsSection
          {...baseProps}
          pullRequests={[
            {
              id: 'pr1',
              number: 42,
              title: 'Add stuff',
              url: 'https://github.com/x/y/pull/42',
              state: 'open',
              ciStatus: 'success',
            } as never,
          ]}
        />
      </Accordion>
    )
    expect(screen.getByText('#42 Add stuff')).toBeInTheDocument()
  })

  it('renders count in header', () => {
    render(
      <Accordion type='multiple'>
        <PullRequestsSection
          {...baseProps}
          pullRequests={[
            {
              id: 'pr1',
              number: 1,
              title: 't',
              url: '#',
              state: 'open',
              ciStatus: null,
            } as never,
            {
              id: 'pr2',
              number: 2,
              title: 't',
              url: '#',
              state: 'open',
              ciStatus: null,
            } as never,
          ]}
        />
      </Accordion>
    )
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails.**

Run: `npx jest __tests__/components/TaskDetailTimeline/sections/PullRequestsSection.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Write the component.**

Create `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/PullRequestsSection.tsx`. Use the same import paths the existing sidebar uses (verify in step 1 — `CiIcon` and `PrStateBadge` are colocated in the workspace components folder):

```tsx
'use client'

import { useIntl } from 'react-intl'
import { X } from 'lucide-react'
import { CiIcon } from '../../CiIcon'
import { PrStateBadge } from '../../PrStateBadge'
import { LinkPrPopover } from '../../LinkPrPopover'
import { ContextSection } from '../ContextSection'

interface PullRequestSummary {
  id: string
  number: number
  title: string
  url: string
  state: string
  ciStatus: string | null
}

interface Props {
  taskId: string
  workspaceId: string
  pullRequests: PullRequestSummary[]
  onLinkPr: () => void
  onUnlinkPr: (prId: string) => void
}

export function PullRequestsSection({
  taskId,
  workspaceId,
  pullRequests,
  onLinkPr,
  onUnlinkPr,
}: Props): React.ReactElement {
  const intl = useIntl()

  const addSlot = (
    <div onClick={e => e.stopPropagation()}>
      <LinkPrPopover
        taskId={taskId}
        workspaceId={workspaceId}
        onLinked={onLinkPr}
      />
    </div>
  )

  return (
    <ContextSection
      value='pullRequests'
      label={intl.formatMessage({ id: 'task.pullRequests' })}
      count={pullRequests.length}
      addSlot={addSlot}
    >
      {pullRequests.length === 0 ? (
        <div className='py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center'>
          {intl.formatMessage({ id: 'task.noPullRequests' })}
        </div>
      ) : (
        <ul className='space-y-2.5'>
          {pullRequests.map(pr => (
            <li key={pr.id} className='flex items-start gap-2 group'>
              <CiIcon status={pr.ciStatus} />
              <div className='min-w-0 flex-1'>
                <a
                  href={pr.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-xs text-zinc-700 dark:text-zinc-300 hover:underline font-medium leading-snug block'
                >
                  #{pr.number} {pr.title}
                </a>
                <div className='flex items-center gap-1.5 mt-1'>
                  <PrStateBadge state={pr.state} />
                </div>
              </div>
              <button
                onClick={() => onUnlinkPr(pr.id)}
                className='shrink-0 opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 transition-all'
                title={intl.formatMessage({ id: 'task.unlinkPr' })}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </ContextSection>
  )
}
```

If step 1 revealed different import paths for `CiIcon` or `PrStateBadge`, adjust accordingly.

- [ ] **Step 5: Run test to verify pass.**

Run: `npx jest __tests__/components/TaskDetailTimeline/sections/PullRequestsSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/sections/PullRequestsSection.tsx __tests__/components/TaskDetailTimeline/sections/PullRequestsSection.test.tsx
git commit -m "feat: add PullRequestsSection [LUM-49]"
```

---

### Task 6: Build `DocumentsSection` (TDD)

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx`
- Test: `__tests__/components/TaskDetailTimeline/sections/DocumentsSection.test.tsx`

Read-only section in this PR — the existing API doesn't support linking documents from this UI, so no Add button yet. Each row is a link to `/workspace/<slug>/docs/<id>`.

- [ ] **Step 1: Confirm the workspace doc URL convention.**

Run: `grep -rn "/docs/" app/workspace/\[workspaceUrl\]/components/document/ | head -5`
Expected: identify the canonical document detail route (e.g. `/workspace/<slug>/docs/<id>` or similar). Use whichever pattern the existing tree-nav uses.

- [ ] **Step 2: Write the failing test.**

Create `__tests__/components/TaskDetailTimeline/sections/DocumentsSection.test.tsx`:

```tsx
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { id?: string; defaultMessage?: string }) =>
      d.id ?? d.defaultMessage ?? '',
  }),
}))

import { render, screen } from '@testing-library/react'
import { Accordion } from '@/components/landing/ui/accordion'
import { DocumentsSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection'

describe('DocumentsSection', () => {
  it('shows empty state when no documents', () => {
    render(
      <Accordion type='multiple' defaultValue={['documents']}>
        <DocumentsSection documents={[]} workspaceUrl='lumo' />
      </Accordion>
    )
    expect(screen.getByText('task.context.documents.empty')).toBeInTheDocument()
  })

  it('renders each document with title', () => {
    render(
      <Accordion type='multiple' defaultValue={['documents']}>
        <DocumentsSection
          workspaceUrl='lumo'
          documents={[
            {
              id: 'd1',
              title: 'Spec',
              emoji: null,
              updatedAt: '2026-05-19T00:00:00Z',
            },
            {
              id: 'd2',
              title: 'RFC',
              emoji: '📄',
              updatedAt: '2026-05-19T00:00:00Z',
            },
          ]}
        />
      </Accordion>
    )
    expect(screen.getByText('Spec')).toBeInTheDocument()
    expect(screen.getByText('RFC')).toBeInTheDocument()
    expect(screen.getByText('📄')).toBeInTheDocument()
  })

  it('renders count in header', () => {
    render(
      <Accordion type='multiple'>
        <DocumentsSection
          workspaceUrl='lumo'
          documents={[
            { id: 'd1', title: 'a', emoji: null, updatedAt: '' },
            { id: 'd2', title: 'b', emoji: null, updatedAt: '' },
            { id: 'd3', title: 'c', emoji: null, updatedAt: '' },
          ]}
        />
      </Accordion>
    )
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails.**

Run: `npx jest __tests__/components/TaskDetailTimeline/sections/DocumentsSection.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Write the component.**

Create `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import { FileText } from 'lucide-react'
import type { TaskDocumentResource } from '../../../hooks/useTaskDocuments'
import { ContextSection } from '../ContextSection'

interface Props {
  documents: TaskDocumentResource[]
  workspaceUrl: string
}

export function DocumentsSection({
  documents,
  workspaceUrl,
}: Props): React.ReactElement {
  const intl = useIntl()

  return (
    <ContextSection
      value='documents'
      label={intl.formatMessage({
        id: 'task.context.section.documents',
        defaultMessage: 'Documents',
      })}
      count={documents.length}
    >
      {documents.length === 0 ? (
        <div className='py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center'>
          {intl.formatMessage({
            id: 'task.context.documents.empty',
            defaultMessage: 'No documents linked',
          })}
        </div>
      ) : (
        <ul className='space-y-1.5'>
          {documents.map(doc => (
            <li key={doc.id} className='flex items-center gap-2 text-xs'>
              {doc.emoji ? (
                <span>{doc.emoji}</span>
              ) : (
                <FileText size={12} className='text-zinc-400' />
              )}
              <a
                href={`/workspace/${workspaceUrl}/docs/${doc.id}`}
                className='text-zinc-700 dark:text-zinc-300 hover:underline truncate'
              >
                {doc.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </ContextSection>
  )
}
```

If step 1 showed a different doc route, replace `/workspace/${workspaceUrl}/docs/${doc.id}` with the correct one.

- [ ] **Step 5: Run test to verify pass.**

Run: `npx jest __tests__/components/TaskDetailTimeline/sections/DocumentsSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/sections/DocumentsSection.tsx __tests__/components/TaskDetailTimeline/sections/DocumentsSection.test.tsx
git commit -m "feat: add DocumentsSection [LUM-49]"
```

---

### Task 7: Build `ContextTab` container (TDD)

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextTab.tsx`
- Test: `__tests__/components/TaskDetailTimeline/ContextTab.test.tsx`

Container responsibilities:

- Call `useSlackContexts(taskId, enabled)` and `useTaskDocuments(taskId, enabled)`
- Receive `pullRequests`, `onLinkPr`, `onUnlinkPr`, `taskId`, `workspaceId`, `workspaceUrl`, `slackConnected`, `enabled` as props
- Compute `defaultValue` for the Accordion = section IDs whose count > 0
- Render the three sections inside a single `<Accordion type="multiple">`

The `defaultValue` is computed from initial counts, not live counts. The Accordion is uncontrolled, so users can toggle freely after first render. This matches the "有数据展开、无数据折叠" spec for the initial view.

- [ ] **Step 1: Write the failing test.**

Create `__tests__/components/TaskDetailTimeline/ContextTab.test.tsx`:

```tsx
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { id?: string; defaultMessage?: string }) =>
      d.id ?? d.defaultMessage ?? '',
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSlackContexts', () => ({
  useSlackContexts: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskDocuments', () => ({
  useTaskDocuments: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/LinkPrPopover', () => ({
  LinkPrPopover: () => <div />,
}))

import { render, screen } from '@testing-library/react'
import { ContextTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextTab'
import { useSlackContexts } from '@/app/workspace/[workspaceUrl]/hooks/useSlackContexts'
import { useTaskDocuments } from '@/app/workspace/[workspaceUrl]/hooks/useTaskDocuments'

const mockSlack = useSlackContexts as jest.Mock
const mockDocs = useTaskDocuments as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockSlack.mockReturnValue({
    contexts: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
    link: jest.fn(),
    refreshOne: jest.fn(),
    unlink: jest.fn(),
  })
  mockDocs.mockReturnValue({
    documents: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
})

const baseProps = {
  taskId: 'tsk_1',
  workspaceId: 'ws_1',
  workspaceUrl: 'lumo',
  slackConnected: true,
  pullRequests: [],
  onLinkPr: jest.fn(),
  onUnlinkPr: jest.fn(),
  enabled: true,
}

describe('ContextTab', () => {
  it('renders all three section headers', () => {
    render(<ContextTab {...baseProps} />)
    expect(screen.getByText('task.context.section.slack')).toBeInTheDocument()
    expect(screen.getByText('task.pullRequests')).toBeInTheDocument()
    expect(
      screen.getByText('task.context.section.documents')
    ).toBeInTheDocument()
  })

  it('defaults a section open when its count is > 0', () => {
    mockSlack.mockReturnValue({
      contexts: [
        {
          id: 'c1',
          snapshot: {
            messages: [{ ts: '1', text: 't', userId: 'u', userName: null }],
          },
          snapshotAt: '',
          isThread: false,
          permalink: '#',
          slackChannelName: 'general',
          refreshError: null,
        },
      ],
      loading: false,
      error: null,
      refresh: jest.fn(),
      link: jest.fn(),
      refreshOne: jest.fn(),
      unlink: jest.fn(),
    })
    render(<ContextTab {...baseProps} />)
    // SlackContextCard text is visible when Slack section is open
    expect(screen.getByText('#general')).toBeInTheDocument()
  })

  it('defaults a section closed when its count is 0', () => {
    render(<ContextTab {...baseProps} />)
    expect(
      screen.queryByText('task.context.documents.empty')
    ).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx jest __tests__/components/TaskDetailTimeline/ContextTab.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the component.**

Create `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextTab.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import { Accordion } from '@/components/landing/ui/accordion'
import { useSlackContexts } from '../../hooks/useSlackContexts'
import { useTaskDocuments } from '../../hooks/useTaskDocuments'
import { SlackContextSection } from './sections/SlackContextSection'
import { PullRequestsSection } from './sections/PullRequestsSection'
import { DocumentsSection } from './sections/DocumentsSection'

interface PullRequestSummary {
  id: string
  number: number
  title: string
  url: string
  state: string
  ciStatus: string | null
}

interface Props {
  taskId: string
  workspaceId: string
  workspaceUrl: string
  slackConnected: boolean
  pullRequests: PullRequestSummary[]
  onLinkPr: () => void
  onUnlinkPr: (prId: string) => void
  enabled: boolean
}

export function ContextTab({
  taskId,
  workspaceId,
  workspaceUrl,
  slackConnected,
  pullRequests,
  onLinkPr,
  onUnlinkPr,
  enabled,
}: Props): React.ReactElement {
  const slack = useSlackContexts(taskId, enabled)
  const docs = useTaskDocuments(taskId, enabled)

  const defaultOpen = useMemo(() => {
    const open: string[] = []
    if (slack.contexts.length > 0) open.push('slack')
    if (pullRequests.length > 0) open.push('pullRequests')
    if (docs.documents.length > 0) open.push('documents')
    return open
    // Recompute when counts change between mount and first non-empty load
  }, [slack.contexts.length, pullRequests.length, docs.documents.length])

  return (
    <Accordion
      type='multiple'
      defaultValue={defaultOpen}
      key={defaultOpen.join(',')}
    >
      <SlackContextSection
        contexts={slack.contexts}
        slackConnected={slackConnected}
        onLink={slack.link}
        onRefreshOne={slack.refreshOne}
        onUnlink={slack.unlink}
      />
      <PullRequestsSection
        taskId={taskId}
        workspaceId={workspaceId}
        pullRequests={pullRequests}
        onLinkPr={onLinkPr}
        onUnlinkPr={onUnlinkPr}
      />
      <DocumentsSection
        documents={docs.documents}
        workspaceUrl={workspaceUrl}
      />
    </Accordion>
  )
}
```

The `key={defaultOpen.join(',')}` trick remounts the Accordion when the initial default set changes (e.g., when Slack contexts load after first render). Without it, `defaultValue` would only apply on first mount and sections that have data after fetch would stay closed.

- [ ] **Step 4: Run test to verify pass.**

Run: `npx jest __tests__/components/TaskDetailTimeline/ContextTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/ContextTab.tsx __tests__/components/TaskDetailTimeline/ContextTab.test.tsx
git commit -m "feat: add ContextTab container [LUM-49]"
```

---

### Task 8: Wire `ContextTab` into `TimelineTabs`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs.tsx`

Change the tab value `'slack'` → `'context'`, the tab label from `slackContext.tab` → `task.context.tab`, swap `<SlackContextTab>` for `<ContextTab>`. Add the PR-related props to the component's interface.

- [ ] **Step 1: Replace the file.**

Open `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs.tsx` and replace the entire content with:

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useTimeline } from '../../hooks/useTimeline'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { ActivityTimeline } from './ActivityTimeline'
import { TaskDetailComments } from '../TaskDetailComments'
import { AgentRunTab } from '../AgentRunTimeline/AgentRunTab'
import { ContextTab } from './ContextTab'

type TabValue = 'comments' | 'activity' | 'context' | 'agent'

interface PullRequestSummary {
  id: string
  number: number
  title: string
  url: string
  state: string
  ciStatus: string | null
}

interface TimelineTabsProps {
  taskId: string
  workspaceId: string
  workspaceUrl: string
  commentsProps: React.ComponentProps<typeof TaskDetailComments>
  slackConnected: boolean
  pullRequests: PullRequestSummary[]
  onLinkPr: () => void
  onUnlinkPr: (prId: string) => void
}

export function TimelineTabs({
  taskId,
  workspaceId,
  workspaceUrl,
  commentsProps,
  slackConnected,
  pullRequests,
  onLinkPr,
  onUnlinkPr,
}: TimelineTabsProps) {
  const intl = useIntl()
  const [activeTab, setActiveTab] = useState<TabValue>('comments')

  const timeline = useTimeline({
    taskId,
    enabled: activeTab === 'activity',
  })

  const agentRuns = useAgentRuns({ taskId, enabled: true })
  const unsyncedMemoryCount = agentRuns.data?.unsyncedMemoryCount ?? 0

  const tabClass = (active: boolean) =>
    `pb-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
      active
        ? 'text-zinc-800 dark:text-zinc-200 border-b-2 border-zinc-800 dark:border-zinc-200'
        : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600'
    }`

  return (
    <div className='mt-8'>
      {/* Tab bar */}
      <div className='flex gap-4 mb-4'>
        <button
          className={tabClass(activeTab === 'comments')}
          onClick={() => setActiveTab('comments')}
        >
          {intl.formatMessage({
            id: 'task.comments',
            defaultMessage: 'Comments',
          })}
        </button>
        <button
          className={tabClass(activeTab === 'activity')}
          onClick={() => setActiveTab('activity')}
        >
          {intl.formatMessage({
            id: 'task.activity',
            defaultMessage: 'Activity',
          })}
        </button>
        <button
          className={tabClass(activeTab === 'context')}
          onClick={() => setActiveTab('context')}
        >
          {intl.formatMessage({
            id: 'task.context.tab',
            defaultMessage: 'Context',
          })}
        </button>
        <button
          className={`flex items-center gap-1.5 ${tabClass(activeTab === 'agent')}`}
          onClick={() => setActiveTab('agent')}
        >
          {intl.formatMessage({
            id: 'task.agentRun',
            defaultMessage: 'Agent 运行',
          })}
          {unsyncedMemoryCount > 0 && (
            <span className='normal-case tracking-normal text-[10px] font-medium px-1.5 py-px rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400'>
              {intl.formatMessage(
                { id: 'agentRun.memoryBadge', defaultMessage: '+{n} 条新记忆' },
                { n: unsyncedMemoryCount }
              )}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'activity' && (
        <ActivityTimeline
          entries={timeline.entries}
          loading={timeline.loading}
          hasMore={timeline.hasMore}
          loadingMore={timeline.loadingMore}
          onLoadMore={timeline.loadMore}
          members={commentsProps.members}
          agentActors={commentsProps.agentActors}
        />
      )}
      {activeTab === 'comments' && <TaskDetailComments {...commentsProps} />}
      {activeTab === 'context' && (
        <ContextTab
          taskId={taskId}
          workspaceId={workspaceId}
          workspaceUrl={workspaceUrl}
          slackConnected={slackConnected}
          pullRequests={pullRequests}
          onLinkPr={onLinkPr}
          onUnlinkPr={onUnlinkPr}
          enabled={activeTab === 'context'}
        />
      )}
      {activeTab === 'agent' && (
        <AgentRunTab
          taskId={taskId}
          enabled={activeTab === 'agent'}
          memoryCount={unsyncedMemoryCount}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Confirm TS still compiles.**

Run: `npx tsc --noEmit 2>&1 | grep -E "TimelineTabs|ContextTab|SlackContextTab" | head -20`
Expected: errors only from `TaskDetailPage.tsx` (callers passing the old props) — those are fixed in Task 10.

- [ ] **Step 3: Commit.** (Defer until Task 10 fixes the caller — otherwise build is broken between commits.)

Skip the commit here; bundle with Task 10's commit.

---

### Task 9: Remove PR section from `TaskDetailSidebar`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`

- [ ] **Step 1: Delete the Pull Requests block (lines 313-361 today).**

Open `TaskDetailSidebar.tsx`, locate the comment `/* ── Pull Requests ───────────────────────────────────────────── */` and remove the entire `<div className='pt-3'>...</div>` block immediately under it (including the `LinkPrPopover` use).

- [ ] **Step 2: Remove now-unused imports.**

In the same file, remove these imports if they are no longer referenced anywhere else in the file:

- `GitPullRequest` from `lucide-react`
- `LinkPrPopover`
- `CiIcon`
- `PrStateBadge`

Re-grep the file after removing to confirm:
Run: `grep -cn "GitPullRequest\|LinkPrPopover\|CiIcon\|PrStateBadge" app/workspace/\[workspaceUrl\]/components/TaskDetailSidebar.tsx`
Expected: 0 for each removed symbol.

- [ ] **Step 3: Remove the now-unused props from the component signature.**

Inspect: `grep -n "onLinkPr\|onUnlinkPr" app/workspace/\[workspaceUrl\]/components/TaskDetailSidebar.tsx`
Remove the `onLinkPr` and `onUnlinkPr` parameters from the props interface and the destructured parameter list — they will be passed directly to `TimelineTabs` from `TaskDetailPage.tsx` in Task 10.

- [ ] **Step 4: TS check.**

Run: `npx tsc --noEmit 2>&1 | grep TaskDetailSidebar | head -20`
Expected: no errors from `TaskDetailSidebar.tsx` itself. Errors from `TaskDetailPage.tsx` (which still passes the removed props) are fixed in Task 10.

- [ ] **Step 5: Commit.** (Bundled with Task 10.)

Skip the commit here.

---

### Task 10: Update `TaskDetailPage` to feed PR props into `TimelineTabs`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`

The `onLinkPr` and `onUnlinkPr` callbacks (currently passed to `TaskDetailSidebar`) move to `TimelineTabs`. The `pullRequests`, `workspaceId`, and `workspaceUrl` also need to be threaded through.

- [ ] **Step 1: Locate the `<TimelineTabs>` call (around line 331-348) and extend its props.**

Replace the current `<TimelineTabs ... />` block with:

```tsx
<TimelineTabs
  taskId={task.id}
  workspaceId={task.project.workspaceId ?? ''}
  workspaceUrl={workspaceUrl}
  commentsProps={{
    workspaceUrl,
    projectName: task.project.name,
    teamIdentifier: task.teamIdentifier,
    taskNumber: task.number,
    members,
    agentActors,
    mentionableMembers,
    currentActorId: currentMember?.actorId,
    user,
    tc,
  }}
  slackConnected={
    true /* TODO LUM-44: derive from workspace.slackIntegration */
  }
  pullRequests={task.pullRequests ?? []}
  onLinkPr={async () => {
    const data = await tasksClient.getById<{ task: TaskDetail }>(task.id)
    if (data?.task) setTask(prev => ({ ...prev, ...data.task }))
  }}
  onUnlinkPr={async (prId: string) => {
    await tasksClient.unlinkPr(task.id, prId)
    const data = await tasksClient.getById<{ task: TaskDetail }>(task.id)
    if (data?.task) setTask(prev => ({ ...prev, ...data.task }))
  }}
/>
```

- [ ] **Step 2: Remove the `onLinkPr` and `onUnlinkPr` from the `<TaskDetailSidebar>` call.**

In the same file, locate `<TaskDetailSidebar ... />` (around line 352). Remove these two props:

```tsx
onUnlinkPr={async (prId: string) => { ... }}
onLinkPr={async () => { ... }}
```

Leave all other sidebar props unchanged.

- [ ] **Step 3: Run TypeScript check (whole project).**

Run: `npx tsc --noEmit`
Expected: no errors. If errors remain in `TaskDetailSidebar.tsx` or `TaskDetailPage.tsx`, fix until clean.

- [ ] **Step 4: Run all related tests.**

Run: `npx jest __tests__/components/TaskDetailTimeline/`
Expected: all PASS except the old `SlackContextTab.test.tsx` (which will be deleted in Task 11) — if it fails, that's OK, defer until next task.

- [ ] **Step 5: Commit (bundles Tasks 8, 9, 10).**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/TimelineTabs.tsx app/workspace/\[workspaceUrl\]/components/TaskDetailSidebar.tsx app/workspace/\[workspaceUrl\]/components/pages/TaskDetailPage.tsx
git commit -m "feat: wire Context tab into TimelineTabs, drop PR list from sidebar [LUM-49]"
```

---

### Task 11: Delete obsolete `SlackContextTab.tsx` and its test

**Files:**

- Delete: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SlackContextTab.tsx`
- Delete: `__tests__/components/TaskDetailTimeline/SlackContextTab.test.tsx`

The new `SlackContextSection` fully replaces both.

- [ ] **Step 1: Confirm no remaining imports of `SlackContextTab`.**

Run: `grep -rn "SlackContextTab" app/ lib/ components/ __tests__/ 2>/dev/null`
Expected: zero matches (besides the files we're about to delete).

- [ ] **Step 2: Delete the two files.**

```bash
rm app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/SlackContextTab.tsx
rm __tests__/components/TaskDetailTimeline/SlackContextTab.test.tsx
```

- [ ] **Step 3: Run full test suite.**

Run: `npm test -- --silent`
Expected: all PASS.

- [ ] **Step 4: Run TypeScript check.**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "chore: delete obsolete SlackContextTab in favor of SlackContextSection [LUM-49]"
```

---

### Task 12: Browser verification

The CLAUDE.md says: for UI changes, start the dev server and use the feature in a browser before reporting complete.

- [ ] **Step 1: Start the dev server with the preview tool.**

Use the `preview_start` tool (not Bash). Navigate to a workspace task detail page.

- [ ] **Step 2: Visual check — tab bar.**

Confirm the third tab now reads "Context" (in the active locale). Click it.

- [ ] **Step 3: Visual check — sections.**

Confirm three section cards render: Slack, Pull Requests, Documents. Each shows a count badge.

For a task with **no** linked items: all three sections should default closed.
For a task with **some** linked items: only the populated sections should default open.

- [ ] **Step 4: Visual check — sidebar.**

Confirm the right sidebar no longer shows the "Pull Requests" block.

- [ ] **Step 5: Interaction check — add a Slack message.**

Click the "Add Slack message" button in the Slack section header. Confirm the existing dialog opens and the flow still works. Cancel out.

- [ ] **Step 6: Interaction check — expand/collapse.**

Click each section header. Confirm the section toggles open/closed.

- [ ] **Step 7: Console check.**

Use `preview_console_logs` and `preview_logs` — confirm no new errors related to ContextTab/Section/Accordion.

- [ ] **Step 8: Take a screenshot of the final state and surface to the user.**

Use `preview_screenshot`.

- [ ] **Step 9: Stop the dev server.**

Use `preview_stop`.

---

## Self-Review Notes

- **Spec coverage**: tab rename ✓, collapsible sections ✓, Slack/PR/Docs wiring ✓, PR removed from sidebar ✓, default-open based on count ✓, scope-out of Emails/WebLinks/Discord ✓.
- **Type consistency**: `PullRequestSummary` interface duplicated in `TimelineTabs.tsx`, `ContextTab.tsx`, `PullRequestsSection.tsx`. This is intentional (small, local types — keeps cross-file coupling lighter); each file's shape matches.
- **i18n**: 17 locales × 4 new keys + 1 removed key. The translations are pragmatic, not professional — flag any locale you're not confident in to the user before committing if you want native-speaker review (the user has indicated they care about non-English translations being real, not English fallbacks).
- **No new dependencies.** Reuses Radix Accordion already in the repo.
- **PR description note**: explicitly call out (a) the tab value enum changed `'slack' → 'context'` (low-risk but observable), and (b) PR list moved from sidebar to Context tab.
