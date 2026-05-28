# Fix CLI-Created Task Description Rendering

**Task**: [LUM-107](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-107)
**Date**: 2026-05-28
**Status**: Draft

## Summary

Tasks created or updated via `lumo task create -d "..."` (or any non-TipTap
client) currently store the raw markdown string verbatim. When the task is
first opened in the web detail page, TipTap reads the body as HTML — newlines
collapse, markdown markers (`##`, `**`, `-`) render as literal text, and the
whole body gets wrapped in a single `<p>`. The HTML form is then written back,
permanently flattening the description. LUM-106 is the canonical example.

This spec fixes the issue end-to-end:

1. The server normalizes task description on every write (markdown → HTML, with
   an HTML pass-through), so the stored value is always TipTap-friendly.
2. The server exposes a sibling `descriptionMarkdown` on read responses for
   terminal-friendly rendering (CLI / agent context).
3. A one-shot script backfills already-flattened tasks.

## Goals

- New tasks created via CLI render with proper structure on the web.
- `lumo task show` / `lumo task context` print human-readable markdown.
- Web ↔ CLI round-trips are idempotent (writing back HTML doesn't re-convert).
- LUM-106 and similar already-flattened tasks become readable.

## Non-goals

- Changing the on-disk storage format (still HTML in `tasks.description`).
- Touching `taskWebLink.description` or `document.content`.
- A new `descriptionFormat` column or per-task format flag.
- Per-client format negotiation (no `Accept: text/markdown`).
- A general-purpose markdown editor on the CLI (`--from-editor`).
- Comment-body or sub-task rendering — out of scope.

## §1 Architecture overview

```
        ┌──────────────────────────────────────────┐
write:  │ POST/PATCH /api/tasks                    │
        │   description (md or html) ─┐            │
        │  task service               ▼            │
        │   normalizeRichText ──── markdownToHtml  │ ← embedded call
        │                             │            │
        │                             ▼            │
        │  Prisma: tasks.description (always HTML) │
        └──────────────────────────────────────────┘

        ┌──────────────────────────────────────────┐
read:   │ GET /api/tasks/:id                       │
        │ GET /api/tasks/context/:identifier       │
        │  description (HTML, raw)                 │ ← Web → TipTap
        │  descriptionMarkdown (htmlToMarkdown)    │ ← CLI / agent
        └──────────────────────────────────────────┘
```

- The write-path call lands in service-layer code (two sites), so every
  caller — REST clients, Sentry webhook, agent webhook, future channels —
  benefits without changes.
- `markdownToHtml` is already idempotent for HTML input (`isHtml` check), so
  the Web → server → Web round-trip is stable.
- Reads add `descriptionMarkdown` as a sibling field instead of mutating
  `description`. Old CLI versions against the new server keep working; new
  CLI against an old server falls back to the existing `description`.

### The `isHtml` false-positive problem

The existing `isHtml` regex matches any occurrence of `<p>`, `<div>`, etc.
anywhere in the text. A markdown body that mentions HTML tags by name (like
LUM-107's own description, which contains `<p>` as inline narrative) would be
mistaken for HTML and pass through unconverted.

We introduce a stricter `looksLikeHtmlDocument` for this code path:

```ts
// true only when the string begins with a structural block tag —
// excludes mid-text references like "wrapped in `<p>`"
function looksLikeHtmlDocument(text: string): boolean {
  return /^\s*<(p|div|h[1-6]|ul|ol|pre|blockquote|table|img)\b[^>]*>/i.test(
    text
  )
}
```

We do **not** touch `isHtml` itself — the document service relies on it and
the heuristics it tolerates are appropriate there.

## §2 Write path

### New utility: `normalizeRichText`

Location: `lib/utils/markdown.ts` (alongside the existing `markdownToHtml`).

```ts
export function normalizeRichText(
  input: string | null | undefined
): string | null {
  if (input == null) return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null // unify empty → null (matches CLI --description "")
  if (looksLikeHtmlDocument(trimmed)) return trimmed
  return markdownToHtml(trimmed)
}
```

`looksLikeHtmlDocument` is private to this module.

### Call sites (exactly two)

| File                                                                                          | Current line                                                              | Change                                                                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [lib/services/task-creation.service.ts:107](../../lib/services/task-creation.service.ts#L107) | `description: description ?? null,`                                       | `description: normalizeRichText(description),`                                               |
| [lib/services/task-state.service.ts:151](../../lib/services/task-state.service.ts#L151)       | `if (rest.description !== undefined) data.description = rest.description` | `if (rest.description !== undefined) data.description = normalizeRichText(rest.description)` |

`task-cli.service.ts` is a thin wrapper over these two — no separate change.
`createFromAutomation` (Sentry webhook) shares `taskRepository.createWithSequence`
but builds its own description string; passing through `normalizeRichText`
wraps it as `<p>…</p>`, which is the correct outcome.

### Zod schema

`description` stays `z.string().optional().nullable()`. Add a one-line comment
in the schema noting that the server normalizes (client can send either form).

## §3 Read path

### Server: `descriptionMarkdown` on responses

New helper in `lib/services/task-rendering.ts`:

```ts
import { htmlToMarkdown } from '@/lib/utils/markdown'

export function withMarkdown<T extends { description: string | null }>(
  task: T
): T & { descriptionMarkdown: string | null } {
  return {
    ...task,
    descriptionMarkdown: task.description
      ? htmlToMarkdown(task.description)
      : null,
  }
}
```

Wire it in at two places:

| Endpoint / service                                                                                                            | Hook                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `GET /api/tasks/:id` route handler                                                                                            | wrap the response task with `withMarkdown(...)`     |
| `taskContextService.getContextForIdentifier` ([task-context.service.ts:318](../../lib/services/task-context.service.ts#L318)) | construct the `task` object via `withMarkdown(...)` |

The conversion stays in the service / route layer — repositories continue to
return raw entities.

### CLI: prefer markdown when available

| File                                                                       | Change                                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [cli/src/commands/task-show.ts](../../cli/src/commands/task-show.ts)       | `Description:` block prints `task.descriptionMarkdown ?? task.description`                                     |
| [cli/src/commands/task-context.ts](../../cli/src/commands/task-context.ts) | Add `descriptionMarkdown?: string \| null` to `TaskContextResponse.task`; line 107 uses the same `??` fallback |

The `??` fallback gives us cross-version compatibility: new CLI against an
old server still prints something readable (the HTML); old CLI against the
new server keeps working unchanged.

## §4 Backfill

Location: `scripts/backfill-task-descriptions.ts` (one-shot, not built).

### Decision predicate

```ts
function shouldBackfill(html: string | null): boolean {
  if (!html) return false
  // 1. Form: a single block tag wraps the entire body, no nested blocks inside.
  const single = /^\s*<p>([\s\S]+)<\/p>\s*$/i.exec(html)
  if (!single) return false
  const inner = single[1]
  if (/<(p|div|h[1-6]|ul|ol|li|pre|blockquote|table)\b/i.test(inner))
    return false
  // 2. Content carries markdown markers worth recovering.
  return isMarkdown(inner)
}
```

### Rebuild

```ts
function rebuild(html: string): string {
  const inner = /^\s*<p>([\s\S]+)<\/p>\s*$/i.exec(html)![1]
  const decoded = inner
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return markdownToHtml(decoded)
}
```

### Execution flow

1. **Dry-run (default)**: scan, print match count + first 5 sample diffs, no DB writes.
2. **`--apply`**: explicit opt-in flag; only then does the script call `prisma.task.update`.
3. Each per-row update is wrapped in `try/catch` so a single failure does not
   halt the run; failed identifiers are collected and printed at the end.
4. Each updated task's identifier is logged for traceability.
5. Final summary: `Updated N task(s). Skipped M (no marker / already structured). Failed F.`

### Roll-out

1. Local `.env.local` dry-run → eyeball sample diffs.
2. Prod dry-run via `DOTENV_CONFIG_PATH=.env.production tsx scripts/backfill-task-descriptions.ts`.
3. After explicit user authorization in-session (same gate as `prisma migrate
deploy`), `--apply` against prod.
4. Spot-check: `lumo task show LUM-106` should render as markdown sections.

## §5 Testing

### Unit tests

| File                                                            | Coverage                                                                                                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `__tests__/lib/utils/markdown.test.ts` (append)                 | `normalizeRichText`: null / empty / plain markdown / already-HTML / markdown that mentions `<p>` literally / Web-UI round-trip is idempotent |
| `__tests__/lib/services/task-creation.service.test.ts` (append) | `createTask` stores HTML when given markdown                                                                                                 |
| `__tests__/lib/services/task-state.service.test.ts` (append)    | Update normalizes; `description: ""` still clears (→ null)                                                                                   |
| `__tests__/lib/services/task-rendering.test.ts` (new)           | `withMarkdown` adds the field; null passes through; HTML → markdown shape                                                                    |
| `__tests__/scripts/backfill-task-descriptions.test.ts` (new)    | `shouldBackfill` decision matrix; `rebuild` decodes entities then converts                                                                   |
| `__tests__/cli/commands/task-show.test.ts` (append)             | Prefers `descriptionMarkdown`, falls back to `description`                                                                                   |

### Manual end-to-end verification (pasted into PR)

1. `lumo task create "test md" -d $'## H\n- a\n- b\n\n**bold**'` → open in web,
   see structured heading / list / bold.
2. `lumo task show <id>` → terminal output is markdown.
3. `lumo task context <id>` → Description block is markdown.
4. Edit the description in the web UI and save → `lumo task show <id>` still
   returns structured markdown (Web round-trip stays idempotent).
5. Local backfill dry-run prints hit count + sample diffs.
6. Prod dry-run → `--apply` after authorization → `lumo task show LUM-106`
   verifies recovery.

### Regression watch

TipTap's `setContent` may re-serialize the HTML with minor differences (e.g.
self-closing tags, attribute order). The unit test for `normalizeRichText`
includes an explicit "Web-write-back HTML is idempotent through normalize"
case to catch this.

## §6 Out of scope

- CLI-side markdown conversion (server is the single point of truth).
- A `descriptionFormat: 'markdown' | 'html'` column or any persistent format flag.
- Auto-detecting other rich-text fields (comments, web link notes) — separate scope.
- Re-rendering already-correct HTML descriptions written by the Web UI.
- CI auto `prisma migrate deploy` — surfaced as a follow-up task during
  brainstorming; tracked separately.

## §7 Files touched (summary)

**Server**

- `lib/utils/markdown.ts` (add `normalizeRichText`, private `looksLikeHtmlDocument`)
- `lib/services/task-creation.service.ts` (1 line)
- `lib/services/task-state.service.ts` (1 line)
- `lib/services/task-rendering.ts` (new, ~15 LOC)
- `app/api/tasks/[id]/route.ts` (wrap response)
- `lib/services/task-context.service.ts` (wrap response task)

**CLI**

- `cli/src/commands/task-show.ts` (prefer markdown field)
- `cli/src/commands/task-context.ts` (interface + fallback)

**Scripts**

- `scripts/backfill-task-descriptions.ts` (new)

**Tests** — see §5 table.

**No schema migration. No new dependencies.**
