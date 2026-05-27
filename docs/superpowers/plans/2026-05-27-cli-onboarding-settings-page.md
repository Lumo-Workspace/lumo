# CLI Onboarding Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/workspace/<slug>/settings/cli` — a Personal-section page with three numbered steps (Install · Log in · Stay up to date), copyable command blocks, and an embedded create-API-key form. The form reuses the existing `useApiKeys` hook and a newly-extracted `NewApiKeyDialog` (which `ApiKeysPage` adopts at the same time so the two pages can't drift).

**Architecture:** All new files live under `app/workspace/[workspaceUrl]/`. Tests live at the repo root `__tests__/` directory (project convention — confirmed by reading existing tests). i18n keys are added to every file under `lib/i18n/` (16 locales). No new routes other than the page; no API changes.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, Tailwind, react-intl, `@tanstack/react-query` (transitively via `useApiKeys`), Jest + `@testing-library/react`, lucide-react icons.

**Spec reference:** [docs/superpowers/specs/2026-05-27-cli-onboarding-settings-page-design.md](../specs/2026-05-27-cli-onboarding-settings-page-design.md)

**Linear task:** [LUM-99](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-99)

---

## File Structure

### Create

| Path                                                                   | Responsibility                                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `app/workspace/[workspaceUrl]/settings/cli/page.tsx`                   | Thin route file — exports default that renders `<CliPage />`.                                                     |
| `app/workspace/[workspaceUrl]/components/pages/CliPage.tsx`            | Top-level page. Renders title + subtitle + three `CliStep`s.                                                      |
| `app/workspace/[workspaceUrl]/components/cli/CliStep.tsx`              | Numbered badge + title + description + slot. Pure presentational.                                                 |
| `app/workspace/[workspaceUrl]/components/cli/CodeBlock.tsx`            | Mono-spaced command block with per-line copy buttons. Clipboard write + icon flip.                                |
| `app/workspace/[workspaceUrl]/components/cli/CliCreateKeyForm.tsx`     | Label input + Create button. Wraps `useApiKeys` `handleCreate` + opens `NewApiKeyDialog` when `newKey` populates. |
| `app/workspace/[workspaceUrl]/components/api-keys/NewApiKeyDialog.tsx` | Extracted from the inline modal inside `ApiKeysPage`. Reusable one-time-key dialog with copy.                     |
| `__tests__/components/cli/CodeBlock.test.tsx`                          | Render + copy-click + icon flip.                                                                                  |
| `__tests__/components/cli/CliStep.test.tsx`                            | Renders badge, title, description, children.                                                                      |
| `__tests__/components/cli/CliCreateKeyForm.test.tsx`                   | Submit calls `useApiKeys.handleCreate`; disabled when label empty.                                                |
| `__tests__/components/cli/CliPage.test.tsx`                            | Smoke test — three step titles + three commands appear.                                                           |
| `__tests__/components/api-keys/NewApiKeyDialog.test.tsx`               | Renders the one-time key value; wires copy + close callbacks.                                                     |

### Modify

| Path                                                            | Change                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx`       | Import `Terminal` from lucide-react; insert one entry into `personalItems` between Notifications and API Keys. |
| `app/workspace/[workspaceUrl]/components/pages/ApiKeysPage.tsx` | Replace the inline "new key" `AlertDialog` block with `<NewApiKeyDialog />`.                                   |
| `lib/i18n/en.json` + 15 sibling locale files                    | Add 12 new keys per file (`settings.cli`, `cli.subtitle`, `cli.step.install.title`, …, `cli.copied`).          |

### Conventions noted from existing code

- Tests live in `<repo>/__tests__/` (not co-located).
- Components using `react-intl` are tested by **mocking react-intl per test file** with a local en dictionary (see `__tests__/components/LinkDocPopover.test.tsx`).
- `useApiKeys.handleCopy` uses a 2000 ms reset timer. New `CodeBlock` copy state will also use **2000 ms** for consistency (the spec's "1.5s" was illustrative).
- `personalItems` array order in `SettingsShell.tsx` today: Profile → Preferences → Notifications → API Keys. CLI is inserted **between Notifications and API Keys** (index 3).
- Toast: `sonner` is the project-wide toast lib (`import { toast } from 'sonner'`).

---

## Task 1: Extract `NewApiKeyDialog` from `ApiKeysPage`

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/api-keys/NewApiKeyDialog.tsx`
- Create: `__tests__/components/api-keys/NewApiKeyDialog.test.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/pages/ApiKeysPage.tsx` (lines 119–153 — the inline `AlertDialog` block)

### Step 1.1: Write the failing test

- [ ] Create `__tests__/components/api-keys/NewApiKeyDialog.test.tsx`:

```tsx
/**
 * Mock react-intl per LinkDocPopover.test.tsx pattern — formatMessage
 * returns the en string when known, otherwise falls back to the key id.
 */
const en: Record<string, string> = {
  'apiKeys.newKeyTitle': 'API key created',
  'apiKeys.newKeyDesc': "Copy this key now — it won't be shown again.",
  'common.close': 'Close',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { NewApiKeyDialog } from '@/app/workspace/[workspaceUrl]/components/api-keys/NewApiKeyDialog'

describe('NewApiKeyDialog', () => {
  function renderDialog(
    overrides: Partial<React.ComponentProps<typeof NewApiKeyDialog>> = {}
  ) {
    const props: React.ComponentProps<typeof NewApiKeyDialog> = {
      open: true,
      keyValue: 'lum_test_123',
      copied: false,
      onCopy: jest.fn(),
      onClose: jest.fn(),
      ...overrides,
    }
    render(<NewApiKeyDialog {...props} />)
    return props
  }

  it('renders the one-time key value when open', () => {
    renderDialog({ keyValue: 'lum_abc_def' })
    expect(screen.getByText('lum_abc_def')).toBeInTheDocument()
  })

  it('renders the title and description from i18n', () => {
    renderDialog()
    expect(screen.getByText('API key created')).toBeInTheDocument()
    expect(
      screen.getByText("Copy this key now — it won't be shown again.")
    ).toBeInTheDocument()
  })

  it('invokes onCopy when the copy button is clicked', () => {
    const onCopy = jest.fn()
    renderDialog({ onCopy })
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(onCopy).toHaveBeenCalledTimes(1)
  })

  it('invokes onClose when the close action is clicked', () => {
    const onClose = jest.fn()
    renderDialog({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not render the dialog content when closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByText('lum_test_123')).not.toBeInTheDocument()
  })
})
```

### Step 1.2: Run the test and verify it fails

- [ ] Run: `npx jest __tests__/components/api-keys/NewApiKeyDialog.test.tsx`
- [ ] Expected: FAIL with "Cannot find module" because the component file doesn't exist yet.

### Step 1.3: Create the component

- [ ] Create `app/workspace/[workspaceUrl]/components/api-keys/NewApiKeyDialog.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export interface NewApiKeyDialogProps {
  open: boolean
  keyValue: string | null
  copied: boolean
  onCopy: () => void
  onClose: () => void
}

export function NewApiKeyDialog({
  open,
  keyValue,
  copied,
  onCopy,
  onClose,
}: NewApiKeyDialogProps) {
  const intl = useIntl()

  return (
    <AlertDialog open={open} onOpenChange={isOpen => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {intl.formatMessage({ id: 'apiKeys.newKeyTitle' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {intl.formatMessage({ id: 'apiKeys.newKeyDesc' })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className='flex items-center gap-2 my-2'>
          <code className='flex-1 text-xs bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2 break-all font-mono'>
            {keyValue}
          </code>
          <Button
            variant='outline'
            size='sm'
            onClick={onCopy}
            aria-label='Copy'
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </Button>
        </div>

        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>
            {intl.formatMessage({ id: 'common.close' })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

### Step 1.4: Run the test and verify it passes

- [ ] Run: `npx jest __tests__/components/api-keys/NewApiKeyDialog.test.tsx`
- [ ] Expected: PASS — all 5 tests green.

### Step 1.5: Wire `NewApiKeyDialog` into `ApiKeysPage`

- [ ] Open `app/workspace/[workspaceUrl]/components/pages/ApiKeysPage.tsx`.
- [ ] Add import at top (alongside existing imports):

```tsx
import { NewApiKeyDialog } from '../api-keys/NewApiKeyDialog'
```

- [ ] Delete the inline `AlertDialog` block at lines 119–153 (the one with `<AlertDialogTitle>{intl.formatMessage({ id: 'apiKeys.newKeyTitle' })}…`).
- [ ] Replace it with:

```tsx
<NewApiKeyDialog
  open={!!newKey}
  keyValue={newKey?.key ?? null}
  copied={copied}
  onCopy={() => void handleCopy()}
  onClose={() => setNewKey(null)}
/>
```

- [ ] Remove the now-unused icon imports `Copy` and `Check` if they're no longer referenced elsewhere in this file (check with a grep before deleting; `Copy` may still be used by other UI, in which case keep it).

### Step 1.6: Verify type-check and tests still green

- [ ] Run: `npx tsc --noEmit`
- [ ] Expected: no new errors.
- [ ] Run: `npx jest __tests__/components/api-keys/`
- [ ] Expected: PASS.

### Step 1.7: Commit

- [ ] Run:

```bash
git add app/workspace/'[workspaceUrl]'/components/api-keys/NewApiKeyDialog.tsx \
        app/workspace/'[workspaceUrl]'/components/pages/ApiKeysPage.tsx \
        __tests__/components/api-keys/NewApiKeyDialog.test.tsx
git commit -m "$(cat <<'EOF'
refactor: extract NewApiKeyDialog from ApiKeysPage [LUM-99]

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Build `CodeBlock` component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/cli/CodeBlock.tsx`
- Create: `__tests__/components/cli/CodeBlock.test.tsx`

### Step 2.1: Write the failing test

- [ ] Create `__tests__/components/cli/CodeBlock.test.tsx`:

```tsx
const en: Record<string, string> = {
  'cli.copy': 'Copy',
  'cli.copied': 'Copied',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen, fireEvent, act } from '@testing-library/react'
import { CodeBlock } from '@/app/workspace/[workspaceUrl]/components/cli/CodeBlock'

beforeAll(() => {
  Object.assign(navigator, {
    clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
  })
})

beforeEach(() => {
  ;(navigator.clipboard.writeText as jest.Mock).mockClear()
  jest.useFakeTimers()
})

afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers()
  })
  jest.useRealTimers()
})

describe('CodeBlock', () => {
  it('renders every line with a leading $ prompt', () => {
    render(<CodeBlock lines={['npm install -g @lumoai/cli', 'lumo setup']} />)
    expect(screen.getByText('npm install -g @lumoai/cli')).toBeInTheDocument()
    expect(screen.getByText('lumo setup')).toBeInTheDocument()
    expect(screen.getAllByText('$').length).toBe(2)
  })

  it('renders one copy button per line', () => {
    render(<CodeBlock lines={['cmd-a', 'cmd-b']} />)
    expect(screen.getAllByRole('button', { name: /copy/i }).length).toBe(2)
  })

  it('writes the corresponding line to the clipboard when copy clicked', async () => {
    render(<CodeBlock lines={['npm install -g @lumoai/cli', 'lumo setup']} />)
    const buttons = screen.getAllByRole('button', { name: /copy/i })
    await act(async () => {
      fireEvent.click(buttons[1])
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('lumo setup')
  })

  it('flips the button icon to a check after copy then back after 2s', async () => {
    render(<CodeBlock lines={['lumo update']} />)
    const button = screen.getByRole('button', { name: /copy/i })
    await act(async () => {
      fireEvent.click(button)
    })
    // After copy, accessible name flips to "Copied"
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument()
    act(() => {
      jest.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })
})
```

### Step 2.2: Run the test and verify it fails

- [ ] Run: `npx jest __tests__/components/cli/CodeBlock.test.tsx`
- [ ] Expected: FAIL with "Cannot find module".

### Step 2.3: Create the component

- [ ] Create `app/workspace/[workspaceUrl]/components/cli/CodeBlock.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Copy, Check } from 'lucide-react'

interface CodeBlockProps {
  lines: string[]
}

export function CodeBlock({ lines }: CodeBlockProps) {
  const intl = useIntl()
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  async function handleCopy(line: string, index: number) {
    await navigator.clipboard.writeText(line)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  return (
    <div className='rounded-md bg-zinc-900 dark:bg-zinc-950 text-zinc-100 font-mono text-xs overflow-hidden'>
      {lines.map((line, index) => {
        const isCopied = copiedIndex === index
        return (
          <div
            key={index}
            className='flex items-center justify-between gap-3 px-3 py-2 border-b border-zinc-800 last:border-b-0'
          >
            <div className='flex items-center gap-2 min-w-0'>
              <span className='text-zinc-500 select-none'>$</span>
              <span className='truncate'>{line}</span>
            </div>
            <button
              type='button'
              onClick={() => void handleCopy(line, index)}
              aria-label={
                isCopied
                  ? intl.formatMessage({ id: 'cli.copied' })
                  : intl.formatMessage({ id: 'cli.copy' })
              }
              className='shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors'
            >
              {isCopied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        )
      })}
    </div>
  )
}
```

### Step 2.4: Run the test and verify it passes

- [ ] Run: `npx jest __tests__/components/cli/CodeBlock.test.tsx`
- [ ] Expected: PASS — all 4 tests green.

### Step 2.5: Commit

- [ ] Run:

```bash
git add app/workspace/'[workspaceUrl]'/components/cli/CodeBlock.tsx \
        __tests__/components/cli/CodeBlock.test.tsx
git commit -m "$(cat <<'EOF'
feat: CodeBlock component for CLI settings page [LUM-99]

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Build `CliStep` component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/cli/CliStep.tsx`
- Create: `__tests__/components/cli/CliStep.test.tsx`

### Step 3.1: Write the failing test

- [ ] Create `__tests__/components/cli/CliStep.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { CliStep } from '@/app/workspace/[workspaceUrl]/components/cli/CliStep'

describe('CliStep', () => {
  it('renders the numeric index, title, and description', () => {
    render(
      <CliStep
        index={2}
        title='Log in'
        description='Run lumo auth login to authenticate.'
      />
    )
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Log in')).toBeInTheDocument()
    expect(
      screen.getByText('Run lumo auth login to authenticate.')
    ).toBeInTheDocument()
  })

  it('renders children below the description', () => {
    render(
      <CliStep index={1} title='Install' description='Install the CLI.'>
        <div data-testid='child-content'>child</div>
      </CliStep>
    )
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })
})
```

### Step 3.2: Run the test and verify it fails

- [ ] Run: `npx jest __tests__/components/cli/CliStep.test.tsx`
- [ ] Expected: FAIL with "Cannot find module".

### Step 3.3: Create the component

- [ ] Create `app/workspace/[workspaceUrl]/components/cli/CliStep.tsx`:

```tsx
import { type ReactNode } from 'react'

interface CliStepProps {
  index: number
  title: string
  description: string
  children?: ReactNode
}

export function CliStep({ index, title, description, children }: CliStepProps) {
  return (
    <section className='flex gap-4 mb-8'>
      <div
        aria-hidden
        className='shrink-0 w-7 h-7 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-sm font-semibold flex items-center justify-center mt-0.5'
      >
        {index}
      </div>
      <div className='flex-1 min-w-0 space-y-3'>
        <div>
          <h2 className='text-sm font-semibold text-zinc-900 dark:text-zinc-100'>
            {title}
          </h2>
          <p className='text-xs text-zinc-500 dark:text-zinc-400 mt-1'>
            {description}
          </p>
        </div>
        {children}
      </div>
    </section>
  )
}
```

### Step 3.4: Run the test and verify it passes

- [ ] Run: `npx jest __tests__/components/cli/CliStep.test.tsx`
- [ ] Expected: PASS.

### Step 3.5: Commit

- [ ] Run:

```bash
git add app/workspace/'[workspaceUrl]'/components/cli/CliStep.tsx \
        __tests__/components/cli/CliStep.test.tsx
git commit -m "$(cat <<'EOF'
feat: CliStep component for CLI settings page [LUM-99]

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Build `CliCreateKeyForm` component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/cli/CliCreateKeyForm.tsx`
- Create: `__tests__/components/cli/CliCreateKeyForm.test.tsx`

### Step 4.1: Write the failing test

- [ ] Create `__tests__/components/cli/CliCreateKeyForm.test.tsx`:

```tsx
const en: Record<string, string> = {
  'cli.step.login.labelPlaceholder': 'Key label (e.g. Claude Code on Macbook)',
  'cli.step.login.createSubmit': 'Create API key',
  'common.create': 'Create',
  'apiKeys.newKeyTitle': 'API key created',
  'apiKeys.newKeyDesc': "Copy this key now — it won't be shown again.",
  'common.close': 'Close',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'

const baseHookReturn = {
  keys: [],
  loading: false,
  label: '',
  setLabel: jest.fn(),
  creating: false,
  newKey: null as { key: string } | null,
  setNewKey: jest.fn(),
  copied: false,
  revokeTarget: null,
  setRevokeTarget: jest.fn(),
  revoking: false,
  handleCreate: jest.fn().mockResolvedValue(undefined),
  handleRevoke: jest.fn().mockResolvedValue(undefined),
  handleCopy: jest.fn().mockResolvedValue(undefined),
}

const useApiKeysMock = jest.fn(() => baseHookReturn)

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useApiKeys', () => ({
  useApiKeys: () => useApiKeysMock(),
}))

import { CliCreateKeyForm } from '@/app/workspace/[workspaceUrl]/components/cli/CliCreateKeyForm'

describe('CliCreateKeyForm', () => {
  beforeEach(() => {
    useApiKeysMock.mockReturnValue({ ...baseHookReturn, label: '' })
  })

  it('renders the label input and the create button', () => {
    render(<CliCreateKeyForm />)
    expect(
      screen.getByPlaceholderText('Key label (e.g. Claude Code on Macbook)')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create API key' })
    ).toBeInTheDocument()
  })

  it('disables the create button when label is empty', () => {
    render(<CliCreateKeyForm />)
    expect(
      screen.getByRole('button', { name: 'Create API key' })
    ).toBeDisabled()
  })

  it('enables the create button and calls handleCreate when clicked', () => {
    const handleCreate = jest.fn().mockResolvedValue(undefined)
    useApiKeysMock.mockReturnValue({
      ...baseHookReturn,
      label: 'My laptop',
      handleCreate,
    })
    render(<CliCreateKeyForm />)
    const button = screen.getByRole('button', { name: 'Create API key' })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(handleCreate).toHaveBeenCalledTimes(1)
  })

  it('shows the NewApiKeyDialog when newKey is populated', () => {
    useApiKeysMock.mockReturnValue({
      ...baseHookReturn,
      newKey: {
        key: 'lum_freshly_minted',
      } as typeof baseHookReturn.newKey,
    })
    render(<CliCreateKeyForm />)
    expect(screen.getByText('lum_freshly_minted')).toBeInTheDocument()
    expect(screen.getByText('API key created')).toBeInTheDocument()
  })

  it('calls setNewKey(null) when the dialog close action fires', () => {
    const setNewKey = jest.fn()
    useApiKeysMock.mockReturnValue({
      ...baseHookReturn,
      newKey: { key: 'lum_x' } as typeof baseHookReturn.newKey,
      setNewKey,
    })
    render(<CliCreateKeyForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(setNewKey).toHaveBeenCalledWith(null)
  })
})
```

### Step 4.2: Run the test and verify it fails

- [ ] Run: `npx jest __tests__/components/cli/CliCreateKeyForm.test.tsx`
- [ ] Expected: FAIL with "Cannot find module".

### Step 4.3: Create the component

- [ ] Create `app/workspace/[workspaceUrl]/components/cli/CliCreateKeyForm.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useApiKeys } from '../../hooks/useApiKeys'
import { NewApiKeyDialog } from '../api-keys/NewApiKeyDialog'

export function CliCreateKeyForm() {
  const intl = useIntl()
  const {
    label,
    setLabel,
    creating,
    newKey,
    setNewKey,
    copied,
    handleCreate,
    handleCopy,
  } = useApiKeys()

  return (
    <>
      <div className='flex gap-2'>
        <Input
          placeholder={intl.formatMessage({
            id: 'cli.step.login.labelPlaceholder',
          })}
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void handleCreate()}
          className='max-w-xs'
        />
        <Button
          onClick={() => void handleCreate()}
          disabled={creating || !label.trim()}
        >
          {creating ? (
            <Loader2 size={14} className='animate-spin mr-1.5' />
          ) : (
            <Plus size={14} className='mr-1.5' />
          )}
          {intl.formatMessage({ id: 'cli.step.login.createSubmit' })}
        </Button>
      </div>

      <NewApiKeyDialog
        open={!!newKey}
        keyValue={newKey?.key ?? null}
        copied={copied}
        onCopy={() => void handleCopy()}
        onClose={() => setNewKey(null)}
      />
    </>
  )
}
```

### Step 4.4: Run the test and verify it passes

- [ ] Run: `npx jest __tests__/components/cli/CliCreateKeyForm.test.tsx`
- [ ] Expected: PASS — all 5 tests green.

### Step 4.5: Commit

- [ ] Run:

```bash
git add app/workspace/'[workspaceUrl]'/components/cli/CliCreateKeyForm.tsx \
        __tests__/components/cli/CliCreateKeyForm.test.tsx
git commit -m "$(cat <<'EOF'
feat: CliCreateKeyForm wraps useApiKeys for CLI page [LUM-99]

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Build `CliPage`

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/pages/CliPage.tsx`
- Create: `__tests__/components/cli/CliPage.test.tsx`

### Step 5.1: Write the failing test

- [ ] Create `__tests__/components/cli/CliPage.test.tsx`:

```tsx
const en: Record<string, string> = {
  'apiKeys.title': 'API Keys',
  'apiKeys.newKeyTitle': 'API key created',
  'apiKeys.newKeyDesc': "Copy this key now — it won't be shown again.",
  'common.close': 'Close',
  'cli.subtitle':
    'Lumo command-line interface — install, log in, and stay up to date.',
  'cli.step.install.title': 'Install',
  'cli.step.install.description':
    'Installs the CLI globally and wires up the Claude Code skill and hooks.',
  'cli.step.login.title': 'Log in',
  'cli.step.login.description':
    'Opens this page in your browser. Create a key below or on the API Keys page, then paste it back into the terminal.',
  'cli.step.login.labelPlaceholder': 'Key label (e.g. Claude Code on Macbook)',
  'cli.step.login.createSubmit': 'Create API key',
  'cli.step.update.title': 'Stay up to date',
  'cli.step.update.description':
    "Upgrades to the latest npm release. Don't run npm install -g manually after the first install.",
  'cli.copy': 'Copy',
  'cli.copied': 'Copied',
  'settings.cli': 'CLI',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

const baseHookReturn = {
  keys: [],
  loading: false,
  label: '',
  setLabel: jest.fn(),
  creating: false,
  newKey: null,
  setNewKey: jest.fn(),
  copied: false,
  revokeTarget: null,
  setRevokeTarget: jest.fn(),
  revoking: false,
  handleCreate: jest.fn().mockResolvedValue(undefined),
  handleRevoke: jest.fn().mockResolvedValue(undefined),
  handleCopy: jest.fn().mockResolvedValue(undefined),
}

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useApiKeys', () => ({
  useApiKeys: () => baseHookReturn,
}))

import { render, screen } from '@testing-library/react'
import { CliPage } from '@/app/workspace/[workspaceUrl]/components/pages/CliPage'

describe('CliPage', () => {
  it('renders the page title and subtitle', () => {
    render(<CliPage />)
    expect(screen.getByRole('heading', { name: 'CLI' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Lumo command-line interface — install, log in, and stay up to date.'
      )
    ).toBeInTheDocument()
  })

  it('renders all three step titles', () => {
    render(<CliPage />)
    expect(screen.getByText('Install')).toBeInTheDocument()
    expect(screen.getByText('Log in')).toBeInTheDocument()
    expect(screen.getByText('Stay up to date')).toBeInTheDocument()
  })

  it('renders all three numeric badges', () => {
    render(<CliPage />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders the install commands', () => {
    render(<CliPage />)
    expect(screen.getByText('npm install -g @lumoai/cli')).toBeInTheDocument()
    expect(screen.getByText('lumo setup')).toBeInTheDocument()
  })

  it('renders the login command', () => {
    render(<CliPage />)
    expect(screen.getByText('lumo auth login')).toBeInTheDocument()
  })

  it('renders the update command', () => {
    render(<CliPage />)
    expect(screen.getByText('lumo update')).toBeInTheDocument()
  })

  it('embeds the create-API-key form inside step 2', () => {
    render(<CliPage />)
    expect(
      screen.getByPlaceholderText('Key label (e.g. Claude Code on Macbook)')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create API key' })
    ).toBeInTheDocument()
  })
})
```

### Step 5.2: Run the test and verify it fails

- [ ] Run: `npx jest __tests__/components/cli/CliPage.test.tsx`
- [ ] Expected: FAIL with "Cannot find module".

### Step 5.3: Create the component

- [ ] Create `app/workspace/[workspaceUrl]/components/pages/CliPage.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import { CliStep } from '../cli/CliStep'
import { CodeBlock } from '../cli/CodeBlock'
import { CliCreateKeyForm } from '../cli/CliCreateKeyForm'

export function CliPage() {
  const intl = useIntl()

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          {intl.formatMessage({ id: 'settings.cli' })}
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          {intl.formatMessage({ id: 'cli.subtitle' })}
        </p>

        <CliStep
          index={1}
          title={intl.formatMessage({ id: 'cli.step.install.title' })}
          description={intl.formatMessage({
            id: 'cli.step.install.description',
          })}
        >
          <CodeBlock lines={['npm install -g @lumoai/cli', 'lumo setup']} />
        </CliStep>

        <CliStep
          index={2}
          title={intl.formatMessage({ id: 'cli.step.login.title' })}
          description={intl.formatMessage({
            id: 'cli.step.login.description',
          })}
        >
          <CodeBlock lines={['lumo auth login']} />
          <CliCreateKeyForm />
        </CliStep>

        <CliStep
          index={3}
          title={intl.formatMessage({ id: 'cli.step.update.title' })}
          description={intl.formatMessage({
            id: 'cli.step.update.description',
          })}
        >
          <CodeBlock lines={['lumo update']} />
        </CliStep>
      </div>
    </div>
  )
}
```

### Step 5.4: Run the test and verify it passes

- [ ] Run: `npx jest __tests__/components/cli/CliPage.test.tsx`
- [ ] Expected: PASS — all 7 tests green.

### Step 5.5: Commit

- [ ] Run:

```bash
git add app/workspace/'[workspaceUrl]'/components/pages/CliPage.tsx \
        __tests__/components/cli/CliPage.test.tsx
git commit -m "$(cat <<'EOF'
feat: CliPage assembles install/login/update steps [LUM-99]

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add the `/settings/cli` route file

**Files:**

- Create: `app/workspace/[workspaceUrl]/settings/cli/page.tsx`

No test — this is a thin export mirroring `settings/api-keys/page.tsx`. The CliPage test covers behavior.

### Step 6.1: Create the route file

- [ ] Create `app/workspace/[workspaceUrl]/settings/cli/page.tsx`:

```tsx
import { CliPage } from '../../components/pages/CliPage'

export default function CliSettingsRoute() {
  return <CliPage />
}
```

### Step 6.2: Verify the route resolves

- [ ] Run: `npx tsc --noEmit`
- [ ] Expected: no errors.

### Step 6.3: Commit

- [ ] Run:

```bash
git add app/workspace/'[workspaceUrl]'/settings/cli/page.tsx
git commit -m "$(cat <<'EOF'
feat: add /settings/cli route [LUM-99]

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Insert the CLI nav entry into `SettingsShell`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx` (lines 7–18 imports; lines 81–102 `personalItems`)

### Step 7.1: Add the lucide icon import

- [ ] Open `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx`.
- [ ] In the lucide-react import block (lines 7–18), add `Terminal`:

```tsx
import {
  ArrowLeft,
  Building2,
  Users,
  Puzzle,
  KeyRound,
  User,
  Settings2,
  Bell,
  Tag,
  CalendarClock,
  Terminal,
} from 'lucide-react'
```

### Step 7.2: Insert the nav entry between Notifications and API Keys

- [ ] In the `personalItems` array (the block currently containing Profile / Preferences / Notifications / API Keys), insert the new entry **before** the API Keys entry. The final array should look like:

```tsx
const personalItems = [
  {
    label: intl.formatMessage({ id: 'settings.profile' }),
    href: `/workspace/${workspaceUrl}/settings/profile`,
    icon: User,
  },
  {
    label: intl.formatMessage({ id: 'settings.preferences' }),
    href: `/workspace/${workspaceUrl}/settings/preferences`,
    icon: Settings2,
  },
  {
    label: intl.formatMessage({ id: 'settings.notifications' }),
    href: `/workspace/${workspaceUrl}/settings/notifications`,
    icon: Bell,
  },
  {
    label: intl.formatMessage({ id: 'settings.cli' }),
    href: `/workspace/${workspaceUrl}/settings/cli`,
    icon: Terminal,
  },
  {
    label: intl.formatMessage({ id: 'settings.apiKeys' }),
    href: `/workspace/${workspaceUrl}/settings/api-keys`,
    icon: KeyRound,
  },
]
```

### Step 7.3: Verify type-check

- [ ] Run: `npx tsc --noEmit`
- [ ] Expected: no errors.

### Step 7.4: Commit

- [ ] Run:

```bash
git add app/workspace/'[workspaceUrl]'/settings/SettingsShell.tsx
git commit -m "$(cat <<'EOF'
feat: add CLI nav entry to settings sidebar [LUM-99]

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add i18n keys to all 16 locale files

**Files:**

- Modify: `lib/i18n/en.json`
- Modify: `lib/i18n/zh-CN.json`
- Modify: `lib/i18n/zh-TW.json`
- Modify: `lib/i18n/de.json`
- Modify: `lib/i18n/en-AU.json`
- Modify: `lib/i18n/en-GB.json`
- Modify: `lib/i18n/es.json`
- Modify: `lib/i18n/es-419.json`
- Modify: `lib/i18n/fr.json`
- Modify: `lib/i18n/hi.json`
- Modify: `lib/i18n/id.json`
- Modify: `lib/i18n/ja.json`
- Modify: `lib/i18n/ko.json`
- Modify: `lib/i18n/ms.json`
- Modify: `lib/i18n/ru.json`
- Modify: `lib/i18n/vi.json`

For each file, find the existing `apiKeys.*` block and add the new keys **immediately after it** (so related onboarding keys stay together). JSON files are flat objects keyed by string — just add the 12 new entries, mind the trailing comma rules.

### Step 8.1: Append the en keys to `lib/i18n/en.json`

- [ ] Locate the line `"apiKeys.lastUsed": "last used {date}",` in `lib/i18n/en.json` and insert these 12 lines immediately after it:

```json
  "settings.cli": "CLI",
  "cli.subtitle": "Lumo command-line interface — install, log in, and stay up to date.",
  "cli.step.install.title": "Install",
  "cli.step.install.description": "Installs the CLI globally and wires up the Claude Code skill and hooks.",
  "cli.step.login.title": "Log in",
  "cli.step.login.description": "Opens this page in your browser. Create a key below or on the API Keys page, then paste it back into the terminal.",
  "cli.step.login.labelPlaceholder": "Key label (e.g. Claude Code on Macbook)",
  "cli.step.login.createSubmit": "Create API key",
  "cli.step.update.title": "Stay up to date",
  "cli.step.update.description": "Upgrades to the latest npm release. Don't run npm install -g manually after the first install.",
  "cli.copy": "Copy",
  "cli.copied": "Copied",
```

### Step 8.2: Append the zh-CN keys to `lib/i18n/zh-CN.json`

- [ ] Locate the `apiKeys.lastUsed` entry in `lib/i18n/zh-CN.json` and insert immediately after:

```json
  "settings.cli": "命令行",
  "cli.subtitle": "Lumo 命令行工具 — 安装、登录、保持更新。",
  "cli.step.install.title": "安装",
  "cli.step.install.description": "全局安装 CLI，并自动配置 Claude Code 的 skill 与 hooks。",
  "cli.step.login.title": "登录",
  "cli.step.login.description": "会在浏览器中打开本页面。可以在下方或 API Keys 页面创建一个 key，再粘贴回终端。",
  "cli.step.login.labelPlaceholder": "Key 名称（如 Claude Code on Macbook）",
  "cli.step.login.createSubmit": "创建 API key",
  "cli.step.update.title": "保持最新",
  "cli.step.update.description": "升级到最新的 npm 版本。首次安装后不要再手动跑 npm install -g。",
  "cli.copy": "复制",
  "cli.copied": "已复制",
```

### Step 8.3: Append the zh-TW keys to `lib/i18n/zh-TW.json`

- [ ] Insert after the `apiKeys.lastUsed` entry:

```json
  "settings.cli": "命令行",
  "cli.subtitle": "Lumo 命令列工具 — 安裝、登入、保持更新。",
  "cli.step.install.title": "安裝",
  "cli.step.install.description": "全域安裝 CLI，並自動設定 Claude Code 的 skill 與 hooks。",
  "cli.step.login.title": "登入",
  "cli.step.login.description": "會在瀏覽器中開啟本頁面。可在下方或 API Keys 頁面建立一個 key，再貼回終端機。",
  "cli.step.login.labelPlaceholder": "Key 名稱（如 Claude Code on Macbook）",
  "cli.step.login.createSubmit": "建立 API key",
  "cli.step.update.title": "保持最新",
  "cli.step.update.description": "升級到最新的 npm 版本。首次安裝後請勿再手動執行 npm install -g。",
  "cli.copy": "複製",
  "cli.copied": "已複製",
```

### Step 8.4: Append the de keys to `lib/i18n/de.json`

- [ ] Insert after the `apiKeys.lastUsed` entry:

```json
  "settings.cli": "CLI",
  "cli.subtitle": "Lumo Befehlszeilen-Tool — installieren, anmelden und aktuell bleiben.",
  "cli.step.install.title": "Installieren",
  "cli.step.install.description": "Installiert das CLI global und richtet den Claude-Code-Skill und die Hooks ein.",
  "cli.step.login.title": "Anmelden",
  "cli.step.login.description": "Öffnet diese Seite im Browser. Erstellen Sie unten oder auf der API-Keys-Seite einen Schlüssel und fügen Sie ihn dann im Terminal ein.",
  "cli.step.login.labelPlaceholder": "Schlüsselname (z. B. Claude Code on Macbook)",
  "cli.step.login.createSubmit": "API-Schlüssel erstellen",
  "cli.step.update.title": "Aktuell bleiben",
  "cli.step.update.description": "Aktualisiert auf die neueste npm-Version. Führen Sie nach der ersten Installation nicht erneut npm install -g aus.",
  "cli.copy": "Kopieren",
  "cli.copied": "Kopiert",
```

### Step 8.5: Append the en-AU keys to `lib/i18n/en-AU.json`

- [ ] Insert after the `apiKeys.lastUsed` entry:

```json
  "settings.cli": "CLI",
  "cli.subtitle": "Lumo command-line interface — install, log in, and stay up to date.",
  "cli.step.install.title": "Install",
  "cli.step.install.description": "Installs the CLI globally and wires up the Claude Code skill and hooks.",
  "cli.step.login.title": "Log in",
  "cli.step.login.description": "Opens this page in your browser. Create a key below or on the API Keys page, then paste it back into the terminal.",
  "cli.step.login.labelPlaceholder": "Key label (e.g. Claude Code on Macbook)",
  "cli.step.login.createSubmit": "Create API key",
  "cli.step.update.title": "Stay up to date",
  "cli.step.update.description": "Upgrades to the latest npm release. Don't run npm install -g manually after the first install.",
  "cli.copy": "Copy",
  "cli.copied": "Copied",
```

### Step 8.6: Append the en-GB keys to `lib/i18n/en-GB.json`

- [ ] Insert after the `apiKeys.lastUsed` entry. Use the same strings as en-AU (Step 8.5) — no spelling divergence in these particular strings.

### Step 8.7: Append the es keys to `lib/i18n/es.json`

- [ ] Insert after the `apiKeys.lastUsed` entry:

```json
  "settings.cli": "CLI",
  "cli.subtitle": "Interfaz de línea de comandos de Lumo — instala, inicia sesión y mantente al día.",
  "cli.step.install.title": "Instalar",
  "cli.step.install.description": "Instala el CLI globalmente y configura el skill y los hooks de Claude Code.",
  "cli.step.login.title": "Iniciar sesión",
  "cli.step.login.description": "Abre esta página en tu navegador. Crea una clave aquí abajo o en la página de claves de API y pégala de vuelta en la terminal.",
  "cli.step.login.labelPlaceholder": "Nombre de la clave (p. ej. Claude Code on Macbook)",
  "cli.step.login.createSubmit": "Crear clave de API",
  "cli.step.update.title": "Mantente al día",
  "cli.step.update.description": "Actualiza a la última versión publicada en npm. No vuelvas a ejecutar npm install -g manualmente después de la primera instalación.",
  "cli.copy": "Copiar",
  "cli.copied": "Copiado",
```

### Step 8.8: Append the es-419 keys to `lib/i18n/es-419.json`

- [ ] Insert after the `apiKeys.lastUsed` entry. Use the same strings as es (Step 8.7) — the divergence for Latin American Spanish is negligible for these strings.

### Step 8.9: Append the fr keys to `lib/i18n/fr.json`

- [ ] Insert after the `apiKeys.lastUsed` entry:

```json
  "settings.cli": "CLI",
  "cli.subtitle": "Interface en ligne de commande de Lumo — installer, se connecter et rester à jour.",
  "cli.step.install.title": "Installer",
  "cli.step.install.description": "Installe le CLI globalement et configure le skill Claude Code et les hooks.",
  "cli.step.login.title": "Se connecter",
  "cli.step.login.description": "Ouvre cette page dans votre navigateur. Créez une clé ci-dessous ou sur la page des clés API, puis collez-la dans le terminal.",
  "cli.step.login.labelPlaceholder": "Nom de la clé (par ex. Claude Code on Macbook)",
  "cli.step.login.createSubmit": "Créer une clé API",
  "cli.step.update.title": "Rester à jour",
  "cli.step.update.description": "Met à jour vers la dernière version publiée sur npm. Ne relancez pas npm install -g manuellement après la première installation.",
  "cli.copy": "Copier",
  "cli.copied": "Copié",
```

### Step 8.10: Append the hi keys to `lib/i18n/hi.json`

- [ ] Insert after the `apiKeys.lastUsed` entry:

```json
  "settings.cli": "CLI",
  "cli.subtitle": "Lumo कमांड-लाइन इंटरफ़ेस — इंस्टॉल करें, साइन इन करें और अप-टू-डेट रहें।",
  "cli.step.install.title": "इंस्टॉल करें",
  "cli.step.install.description": "CLI को ग्लोबली इंस्टॉल करता है और Claude Code skill तथा hooks को सेट करता है।",
  "cli.step.login.title": "साइन इन करें",
  "cli.step.login.description": "यह पेज आपके ब्राउज़र में खोलता है। नीचे या API Keys पेज पर एक key बनाएं, फिर उसे टर्मिनल में पेस्ट करें।",
  "cli.step.login.labelPlaceholder": "Key का नाम (जैसे Claude Code on Macbook)",
  "cli.step.login.createSubmit": "API key बनाएं",
  "cli.step.update.title": "अप-टू-डेट रहें",
  "cli.step.update.description": "नवीनतम npm रिलीज़ पर अपग्रेड करता है। पहले इंस्टॉल के बाद मैन्युअल रूप से npm install -g दोबारा न चलाएं।",
  "cli.copy": "कॉपी करें",
  "cli.copied": "कॉपी हो गया",
```

### Step 8.11: Append the id keys to `lib/i18n/id.json`

- [ ] Insert after the `apiKeys.lastUsed` entry:

```json
  "settings.cli": "CLI",
  "cli.subtitle": "Antarmuka baris perintah Lumo — instal, masuk, dan tetap perbarui.",
  "cli.step.install.title": "Instal",
  "cli.step.install.description": "Menginstal CLI secara global dan menyiapkan skill Claude Code beserta hooks.",
  "cli.step.login.title": "Masuk",
  "cli.step.login.description": "Membuka halaman ini di peramban Anda. Buat key di bawah atau di halaman API Keys, lalu tempelkan kembali ke terminal.",
  "cli.step.login.labelPlaceholder": "Nama key (mis. Claude Code on Macbook)",
  "cli.step.login.createSubmit": "Buat API key",
  "cli.step.update.title": "Tetap perbarui",
  "cli.step.update.description": "Memperbarui ke rilis npm terbaru. Jangan jalankan npm install -g secara manual lagi setelah instalasi pertama.",
  "cli.copy": "Salin",
  "cli.copied": "Tersalin",
```

### Step 8.12: Append the ja keys to `lib/i18n/ja.json`

- [ ] Insert after the `apiKeys.lastUsed` entry:

```json
  "settings.cli": "CLI",
  "cli.subtitle": "Lumo コマンドラインインターフェース — インストール、ログイン、最新の状態を維持。",
  "cli.step.install.title": "インストール",
  "cli.step.install.description": "CLI をグローバルにインストールし、Claude Code の skill と hooks を設定します。",
  "cli.step.login.title": "ログイン",
  "cli.step.login.description": "このページをブラウザで開きます。下のフォームまたは API Keys ページで key を作成し、ターミナルに貼り付けてください。",
  "cli.step.login.labelPlaceholder": "Key の名前（例: Claude Code on Macbook）",
  "cli.step.login.createSubmit": "API key を作成",
  "cli.step.update.title": "最新の状態を維持",
  "cli.step.update.description": "最新の npm リリースにアップグレードします。最初のインストール後、手動で npm install -g を再実行しないでください。",
  "cli.copy": "コピー",
  "cli.copied": "コピーしました",
```

### Step 8.13: Append the ko keys to `lib/i18n/ko.json`

- [ ] Insert after the `apiKeys.lastUsed` entry:

```json
  "settings.cli": "CLI",
  "cli.subtitle": "Lumo 명령줄 인터페이스 — 설치, 로그인, 최신 상태 유지.",
  "cli.step.install.title": "설치",
  "cli.step.install.description": "CLI를 전역으로 설치하고 Claude Code skill과 hooks를 설정합니다.",
  "cli.step.login.title": "로그인",
  "cli.step.login.description": "이 페이지가 브라우저에서 열립니다. 아래 폼이나 API Keys 페이지에서 key를 생성한 뒤 터미널에 붙여 넣으세요.",
  "cli.step.login.labelPlaceholder": "Key 이름 (예: Claude Code on Macbook)",
  "cli.step.login.createSubmit": "API key 생성",
  "cli.step.update.title": "최신 상태 유지",
  "cli.step.update.description": "최신 npm 릴리스로 업그레이드합니다. 최초 설치 이후에는 npm install -g를 수동으로 다시 실행하지 마세요.",
  "cli.copy": "복사",
  "cli.copied": "복사됨",
```

### Step 8.14: Append the ms keys to `lib/i18n/ms.json`

- [ ] Insert after the `apiKeys.lastUsed` entry:

```json
  "settings.cli": "CLI",
  "cli.subtitle": "Antara muka baris perintah Lumo — pasang, log masuk dan kekal terkini.",
  "cli.step.install.title": "Pasang",
  "cli.step.install.description": "Memasang CLI secara global dan menyediakan skill Claude Code serta hooks.",
  "cli.step.login.title": "Log masuk",
  "cli.step.login.description": "Membuka halaman ini di pelayar anda. Cipta key di bawah atau pada halaman API Keys, kemudian tampalkannya semula ke terminal.",
  "cli.step.login.labelPlaceholder": "Nama key (cth. Claude Code on Macbook)",
  "cli.step.login.createSubmit": "Cipta API key",
  "cli.step.update.title": "Kekal terkini",
  "cli.step.update.description": "Naik taraf ke keluaran npm terkini. Jangan jalankan npm install -g secara manual selepas pemasangan pertama.",
  "cli.copy": "Salin",
  "cli.copied": "Disalin",
```

### Step 8.15: Append the ru keys to `lib/i18n/ru.json`

- [ ] Insert after the `apiKeys.lastUsed` entry:

```json
  "settings.cli": "CLI",
  "cli.subtitle": "Интерфейс командной строки Lumo — установка, вход и обновления.",
  "cli.step.install.title": "Установить",
  "cli.step.install.description": "Устанавливает CLI глобально и настраивает skill и hooks Claude Code.",
  "cli.step.login.title": "Войти",
  "cli.step.login.description": "Открывает эту страницу в браузере. Создайте ключ ниже или на странице API Keys и вставьте его обратно в терминал.",
  "cli.step.login.labelPlaceholder": "Название ключа (например, Claude Code on Macbook)",
  "cli.step.login.createSubmit": "Создать API-ключ",
  "cli.step.update.title": "Поддерживать актуальность",
  "cli.step.update.description": "Обновляется до последнего релиза npm. Не запускайте npm install -g вручную повторно после первой установки.",
  "cli.copy": "Копировать",
  "cli.copied": "Скопировано",
```

### Step 8.16: Append the vi keys to `lib/i18n/vi.json`

- [ ] Insert after the `apiKeys.lastUsed` entry:

```json
  "settings.cli": "CLI",
  "cli.subtitle": "Giao diện dòng lệnh Lumo — cài đặt, đăng nhập và luôn cập nhật.",
  "cli.step.install.title": "Cài đặt",
  "cli.step.install.description": "Cài đặt CLI ở phạm vi toàn cục và thiết lập skill cùng hooks của Claude Code.",
  "cli.step.login.title": "Đăng nhập",
  "cli.step.login.description": "Mở trang này trong trình duyệt của bạn. Tạo key bên dưới hoặc trên trang API Keys, sau đó dán lại vào terminal.",
  "cli.step.login.labelPlaceholder": "Tên key (ví dụ: Claude Code on Macbook)",
  "cli.step.login.createSubmit": "Tạo API key",
  "cli.step.update.title": "Luôn cập nhật",
  "cli.step.update.description": "Nâng cấp lên phiên bản npm mới nhất. Không chạy lại npm install -g thủ công sau lần cài đặt đầu tiên.",
  "cli.copy": "Sao chép",
  "cli.copied": "Đã sao chép",
```

### Step 8.17: Verify JSON validity in every file

- [ ] Run:

```bash
for f in lib/i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" || echo "INVALID: $f"; done
```

- [ ] Expected: no `INVALID:` lines. (The `"$f"` is passed as argv to node so the variable expands; if any file is malformed, prettier on commit will also catch it.)
- [ ] **Fallback if `apiKeys.lastUsed` isn't present in some locale file**: insert the 12 new keys after the **last** `apiKeys.*` entry in that file. The goal is to keep onboarding-adjacent keys grouped together.

### Step 8.18: Commit

- [ ] Run:

```bash
git add lib/i18n/
git commit -m "$(cat <<'EOF'
i18n: add CLI onboarding strings for all 16 locales [LUM-99]

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Verification — full suite + manual smoke

### Step 9.1: Run the full test suite

- [ ] Run: `npm test`
- [ ] Expected: PASS — including the 5 new test files (`NewApiKeyDialog`, `CodeBlock`, `CliStep`, `CliCreateKeyForm`, `CliPage`).

### Step 9.2: Run type check

- [ ] Run: `npx tsc --noEmit`
- [ ] Expected: no errors.

### Step 9.3: Manual smoke test (dev server)

- [ ] Run: `npm run dev`
- [ ] Navigate in browser to `/workspace/<slug>/settings/cli` (replace `<slug>` with your workspace slug — `lumo` for the dev workspace).
- [ ] Confirm:
  - [ ] The new "CLI" item appears in the Personal nav section, between Notifications and API Keys.
  - [ ] Three numbered steps render (1 Install, 2 Log in, 3 Stay up to date).
  - [ ] Each code block has a working copy button (click → ✓ for 2s).
  - [ ] Typing a label + clicking "Create API key" opens the dialog with the one-time key.
  - [ ] Switching locale to zh-CN renders the page in Chinese (no key ids visible).
- [ ] Visit `/workspace/<slug>/settings/api-keys`, create a key, confirm the dialog still shows the one-time key correctly (this verifies the `NewApiKeyDialog` extraction didn't regress).

### Step 9.4: Final no-op commit if anything trailing was tweaked

If steps 9.1–9.3 surfaced any small fixes, group them into one commit. Otherwise, skip.

---

## Out of scope (do not implement)

- Local-state detection ("is CLI installed", "current CLI version").
- OS switcher (npm commands are cross-platform).
- Embedded video / GIF.
- Owner-only gating (every member needs CLI access).
- Surfacing `lumo whoami` / `session status` on this page.
- Markdown round-trip of any sort.
