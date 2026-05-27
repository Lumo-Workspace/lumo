# CLI Onboarding — Settings Page Design

**Task**: [LUM-99](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-99) — Workspace settings 添加 CLI 安装说明
**Date**: 2026-05-27
**Status**: Draft

## Goal

Give every workspace member a one-stop page in settings where they can learn how to install the Lumo CLI, log in, and keep it updated. Today this information lives only in the README and the npm package; new members have to dig for it.

## Non-goals

- Detecting whether the CLI is installed on the user's machine (impossible from the browser).
- Replacing the CLI's own onboarding output (`lumo setup`, `lumo auth login` already print useful instructions in the terminal).
- Surfacing CLI state (current session binding, `whoami`, etc.) — those belong elsewhere.
- Per-OS install instructions (npm is cross-platform — one set of commands suffices).

## Placement

### Route

`app/workspace/[workspaceUrl]/settings/cli/page.tsx`, mirroring the thin route-file pattern used by sibling settings pages:

```ts
import { CliPage } from '../../components/pages/CliPage'

export default function CliSettingsRoute() {
  return <CliPage />
}
```

### Navigation

Add an entry to the `personalItems` array in `app/workspace/[workspaceUrl]/settings/SettingsShell.tsx`, ordered **above** `API Keys`:

```ts
{
  label: intl.formatMessage({ id: 'settings.cli' }),
  href: `/workspace/${workspaceUrl}/settings/cli`,
  icon: Terminal, // lucide-react
}
```

Rationale: CLI is the entry point, API Keys is the artifact the CLI consumes. Reading top-down: install CLI → create key → paste back. The page is in the Personal section because CLI keys are per-user — every member needs this, not just owners.

## Page Layout

Reuses the centered `max-w-2xl` container, `h1` title, and subtitle pattern already in `ApiKeysPage.tsx` for visual consistency with the rest of settings.

```
┌─ /settings/cli ──────────────────────────┐
│  CLI                                     │
│  Lumo command-line interface — install,  │
│  log in, and stay up to date.            │
│                                          │
│  ① Install                               │
│  ┌────────────────────────────────────┐  │
│  │ $ npm install -g @lumoai/cli   [📋]│  │
│  │ $ lumo setup                   [📋]│  │
│  └────────────────────────────────────┘  │
│  Installs the CLI globally and wires up  │
│  the Claude Code skill + hooks.          │
│                                          │
│  ② Log in                                │
│  ┌────────────────────────────────────┐  │
│  │ $ lumo auth login              [📋]│  │
│  └────────────────────────────────────┘  │
│  Opens this page in your browser. Create │
│  a key below or on the API Keys page,    │
│  then paste it back into the terminal.   │
│                                          │
│  [Label________] [Create API key]        │
│   → modal shows the key once + copy      │
│                                          │
│  ③ Stay up to date                       │
│  ┌────────────────────────────────────┐  │
│  │ $ lumo update                  [📋]│  │
│  └────────────────────────────────────┘  │
│  Upgrades to the latest npm release. Do  │
│  not re-run npm install -g manually.     │
└──────────────────────────────────────────┘
```

Each step is a row: a circular numbered badge (14×14, neutral background) on the left, step title + body on the right. Steps are stacked vertically, separated by `mb-8` like the cards on `WorkspaceSettingsPage`.

## Component Breakdown

| Component               | File                                                                   | Responsibility                                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CliPage`               | `app/workspace/[workspaceUrl]/components/pages/CliPage.tsx`            | Top-level page. Renders the shell, three `CliStep`s, and the embedded create-key form.                                                                                                                            |
| `CliStep`               | `app/workspace/[workspaceUrl]/components/cli/CliStep.tsx`              | Props: `{ index: number; title: string; description: string; children?: React.ReactNode }`. Renders the numbered badge + title + slot for body.                                                                   |
| `CodeBlock`             | `app/workspace/[workspaceUrl]/components/cli/CodeBlock.tsx`            | Props: `{ lines: string[] }`. Renders one or more `$ command` lines in a mono-spaced block with a copy button per line that flips to `✓` for 1.5 s.                                                               |
| `CliCreateKeyForm`      | `app/workspace/[workspaceUrl]/components/cli/CliCreateKeyForm.tsx`     | Label input + Create button. Calls the existing `useApiKeys` hook's `handleCreate`. On success, `useApiKeys.newKey` populates and the shared dialog opens.                                                        |
| `NewApiKeyDialog` (new) | `app/workspace/[workspaceUrl]/components/api-keys/NewApiKeyDialog.tsx` | Extracted from the inline modal currently inside `ApiKeysPage`. Props: `{ open: boolean; keyValue: string \| null; copied: boolean; onCopy(): void; onClose(): void }`. Used by both `CliPage` and `ApiKeysPage`. |

`ApiKeysPage` is refactored to render `<NewApiKeyDialog />` instead of its inline `AlertDialog` block. Behavior is identical — only the JSX moves. This is a tiny in-scope refactor to keep the two pages from drifting.

## Data Flow

`CliCreateKeyForm` reuses the existing `useApiKeys` hook unchanged:

```
User clicks "Create API key"
  → CliCreateKeyForm.onSubmit
    → useApiKeys.handleCreate (already POSTs /api/api-keys)
      → useApiKeys.newKey state populates
        → NewApiKeyDialog opens with the one-time key
          → user copies, closes
            → newKey clears, dialog closes
```

The keys-list and revoke flows from `useApiKeys` are **not** rendered on this page — the form only exposes the create surface.

## i18n

Add to **every** locale file under `lib/i18n/`:

Proposed copy (en / zh-CN / zh-TW):

| Key                               | en                                                                                                                 | zh-CN                                                                          | zh-TW                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `settings.cli`                    | CLI                                                                                                                | 命令行                                                                         | 命令行                                                                       |
| `cli.subtitle`                    | Lumo command-line interface — install, log in, and stay up to date.                                                | Lumo 命令行工具 — 安装、登录、保持更新。                                       | Lumo 命令列工具 — 安裝、登入、保持更新。                                     |
| `cli.step.install.title`          | Install                                                                                                            | 安装                                                                           | 安裝                                                                         |
| `cli.step.install.description`    | Installs the CLI globally and wires up the Claude Code skill and hooks.                                            | 全局安装 CLI，并自动配置 Claude Code 的 skill 与 hooks。                       | 全域安裝 CLI，並自動設定 Claude Code 的 skill 與 hooks。                     |
| `cli.step.login.title`            | Log in                                                                                                             | 登录                                                                           | 登入                                                                         |
| `cli.step.login.description`      | Opens this page in your browser. Create a key below or on the API Keys page, then paste it back into the terminal. | 会在浏览器中打开本页面。可以在下方或 API Keys 页面创建一个 key，再粘贴回终端。 | 會在瀏覽器中開啟本頁面。可在下方或 API Keys 頁面建立一個 key，再貼回終端機。 |
| `cli.step.login.labelPlaceholder` | Key label (e.g. Claude Code on Macbook)                                                                            | Key 名称（如 Claude Code on Macbook）                                          | Key 名稱（如 Claude Code on Macbook）                                        |
| `cli.step.login.createSubmit`     | Create API key                                                                                                     | 创建 API key                                                                   | 建立 API key                                                                 |
| `cli.step.update.title`           | Stay up to date                                                                                                    | 保持最新                                                                       | 保持最新                                                                     |
| `cli.step.update.description`     | Upgrades to the latest npm release. Don't run npm install -g manually after the first install.                     | 升级到最新的 npm 版本。首次安装后不要再手动跑 npm install -g。                 | 升級到最新的 npm 版本。首次安裝後請勿再手動執行 npm install -g。             |
| `cli.copy`                        | Copy                                                                                                               | 复制                                                                           | 複製                                                                         |
| `cli.copied`                      | Copied                                                                                                             | 已复制                                                                         | 已複製                                                                       |

Every locale gets a proper translation — no English fallbacks (per project convention recorded in CLAUDE.md and user memory).

## Testing

- `__tests__/CliPage.test.tsx` — renders, asserts the three step titles and the three commands are present.
- `__tests__/CodeBlock.test.tsx` — clicking copy calls `navigator.clipboard.writeText` with the line; icon flips to ✓ briefly.
- `__tests__/CliCreateKeyForm.test.tsx` — submitting calls the hook's `handleCreate` with the trimmed label; disabled when label is empty.
- `__tests__/NewApiKeyDialog.test.tsx` — given a `keyValue`, renders the value in the code box and wires copy/close callbacks.
- `__tests__/ApiKeysPage.test.tsx` — extended (or added) to assert it now renders `NewApiKeyDialog` and that creating a key still surfaces the key in the dialog.

## Out of Scope (YAGNI)

- Local-state detection ("is CLI installed", "current CLI version").
- OS switcher (npm commands are cross-platform).
- Embedded video/GIF.
- Owner-only gating (every member needs CLI access).
- Surfacing `lumo whoami` / `session status` on this page.

## Open Questions

None remaining at design time.
