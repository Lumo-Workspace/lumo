# Doc → Tasks: extract checkbox / selection into linked tasks — Design Spec

Task: [LUM-91](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-91)

## Overview

Today a doc and a task are linked one direction only: when a user types `@LUM-N` in a doc, a `DocumentMention(source=CONTENT)` row appears, and the task page shows "Mentioned in <doc>". There is no way to go the other direction — write a list of action items in a doc and turn them into real tasks. Users alt-tab to the task list and re-type each line by hand.

This spec adds a one-click flow that turns `taskItem` (markdown checkbox) lines and selected text inside a doc into real tasks. On extract, the source line/segment is replaced with a link to the new task, and the doc is bound to the task via `DocumentMention(source=EXPLICIT)` so the doc surfaces in `lumo task context LUM-N` and on the task page's "Mentioned in" panel.

V1 is web-only and zero-config (assignee = caller, project = doc.project, priority = LOW, no tag). No state sync — task status changes do not flow back to the doc.

## Scope

- **In scope:**
  - New endpoint `POST /api/documents/[id]/extract-tasks` with a `selector` discriminator (`marked` or `all_unchecked`)
  - New service `lib/services/document-task-extraction.service.ts`
  - HTML transformation of `taskItem` nodes and `data-extract-pending` spans into anchor links (server-side, in-transaction)
  - TipTap front-end: detect `data-task-id` on `taskItem` and render link/badge in place of checkbox; bubble-menu "Convert to task" and per-item hover button; toolbar batch button
  - Reuse `task-creation.service.createTask` and existing `DocumentMention` table — no schema changes
  - i18n keys for all new UI text in every locale file under `lib/i18n/`
- **Out of scope (V2 candidates):**
  - CLI command `lumo doc extract`
  - Live task-status badge on the linked doc segment (pull-style query at render time)
  - Bi-directional state sync (task done → doc checkbox tick)
  - AI-driven candidate extraction over arbitrary prose
  - Cross-paragraph text selection
  - Field-mapping modal (per-row assignee / priority / tag editing before commit)
  - Auto-extract on save

## User Flows

Three triggers all funnel into the same backend endpoint. Front-end differs only in how the candidate set is marked.

### A. Hover single `taskItem` (per-row)

- User hovers over a `[ ] xxx` line.
- TipTap NodeView renders a small `→ task` action at the row's trailing edge.
- Click → client stamps `data-extract-pending="true"` on that `<li>` only, serializes current doc, posts to `/extract-tasks` with `selector: { type: 'marked' }`.
- Server replies with one created task. Editor re-renders the doc.

### B. Selection bubble menu

- User selects text **inside a single paragraph**. Cross-paragraph selection disables the action.
- Bubble menu shows "Convert to task". Disabled when selection already contains a `[data-task-link]` anchor (avoid nested links).
- Click → client wraps the selection in `<span data-extract-pending="true">`, posts the same shape as A.
- Server replies with one task; that `<span>` becomes `<a data-task-link>`.

### C. Toolbar batch button

- Doc-top toolbar shows `📋 Extract N unchecked → tasks` where N is the live count of `taskItem[data-checked="false"]` that are **not already** wrapped in `[data-task-link]`. Hidden when N = 0.
- Click → minimal confirm dialog: "Create N tasks. Each will be yours, priority Low. [Cancel] [Create N]".
- Confirm → post with `selector: { type: 'all_unchecked' }`. No client-side marking required.
- Server replies with N tasks; editor re-renders.

## Data Model

**No schema changes.** Reuses:

- `DocumentMention(documentId, taskId, source)` — `source=EXPLICIT` for extracted rows. The existing `@@unique([documentId, taskId])` constraint is enough idempotency.
- `Task` — created via the standard `task-creation.service.createTask` path (same `Team.taskSeq` increment, same activity log, same notification side-effects).
- `Document.content` — TipTap-serialized HTML, modified in place. The added markup is plain HTML anchor + `data-*` attributes — nothing requires schema or storage changes.

This is intentional: extending an existing relation (`DocumentMention`) keeps the read path on the task page unchanged (it already aggregates explicit and content-derived mentions).

## API

### `POST /api/documents/[id]/extract-tasks`

**Request:**

```ts
{
  content: string                          // current TipTap HTML, sent by client
  selector:
    | { type: 'marked' }                   // server finds [data-extract-pending="true"] nodes
    | { type: 'all_unchecked' }            // server finds <li data-type="taskItem" data-checked="false"> not already linked
}
```

**Response 200:**

```ts
{
  tasks: Array<{ id: string; identifier: string; title: string }>
  updatedContent: string // post-replacement HTML to setContent() into the editor
  updatedAt: string // ISO; for client cache invalidation
  skipped: Array<{
    reason: 'empty' | 'too_long' | 'already_linked' | 'invalid_marker'
    label?: string // truncated text of the skipped candidate, for toast surface
  }>
}
```

**Errors:**

| Status | Code              | When                                                                        |
| ------ | ----------------- | --------------------------------------------------------------------------- |
| 400    | `MISSING_PROJECT` | `doc.projectId === null` — task creation requires a project                 |
| 403    | (no body code)    | Caller lacks edit access (creator / share role >= EDITOR / workspace scope) |
| 409    | `NO_CANDIDATES`   | Selector resolved zero candidates after filtering — surface "nothing to do" |
| 500    | —                 | Standard error envelope; the route catches and logs with stack              |

**Why one endpoint with a selector:** the actual work (parse → identify candidates → create tasks → create mentions → replace nodes → save doc) is identical regardless of trigger. The only thing that varies is "which nodes are candidates" — exactly what `selector` describes. Splitting into `/extract-checked` and `/extract-marked` routes duplicates auth, validation, transaction setup, and HTML parsing for no gain.

### Why client sends `content`

The doc may have unsaved local edits when the user hits Extract. Two options were considered:

1. **Force-save then extract**: client saves doc, server reads from DB, processes, saves again.
2. **Client sends current content**: server processes the provided HTML, saves the result.

(2) is simpler — no save-then-read race, no concurrent-save handling. Server still becomes single source of truth for the _post-extract_ state. The pre-extract content is just input.

## Service Layer

New file: `lib/services/document-task-extraction.service.ts`

```ts
export interface ExtractArgs {
  documentId: string
  memberId: string
  content: string
  selector: { type: 'marked' } | { type: 'all_unchecked' }
}

export interface ExtractResult {
  tasks: Array<{ id: string; identifier: string; title: string }>
  updatedContent: string
  updatedAt: string
  skipped: Array<{ reason: SkipReason; label?: string }>
}

export async function extractTasksFromDoc(
  args: ExtractArgs
): Promise<ExtractResult>
```

**Steps inside `extractTasksFromDoc`:**

1. Reuse the existing `documentRepository.findEditable(documentId, memberId, workspaceId)` helper at [document.repository.ts:485](lib/repositories/document.repository.ts:485) — it already implements the "creator OR WORKSPACE-visible OR EDITOR/MANAGER share" rule. Null result → throw `httpError(403, …)`.
2. Project gate: `if (!doc.projectId) throw httpError(400, 'MISSING_PROJECT')`.
3. Parse `content` with `node-html-parser`. (Library justification: ~30 KB, no jsdom weight; doc.content is TipTap-serialized and structurally predictable, so a forgiving HTML parser is appropriate.)
4. Run the candidate selector:
   - `marked` → all elements with `data-extract-pending="true"`.
   - `all_unchecked` → all `li[data-type="taskItem"][data-checked="false"]` whose inner content does **not** already contain `a[data-task-link]`.
5. For each candidate, extract `textContent`, trim, validate. Push to `skipped` with reason if:
   - `empty` — text is empty after trim
   - `too_long` — text > 200 chars (the over-200 portion becomes the task description; title is truncated)
   - `invalid_marker` — marker wraps content that already includes a task-link anchor
6. Single `prisma.$transaction`:
   - Resolve `callerActor` once (same `memberRepository.findActorByMemberId` pattern as `task-cli.service`).
   - Create one task per valid candidate via `taskCreation.createTask(projectId, {...}, callerActor.id, callerClerkId)`. Sequential — `Team.taskSeq` increment is serialized; concurrent batch attempts produce contiguous numbers.
   - Insert `DocumentMention` rows with `source = EXPLICIT`. Idempotent via the existing `@@unique([documentId, taskId])` constraint (`createMany({ skipDuplicates: true })`).
   - Replace each candidate node:
     - `taskItem` candidate (selector A and C path): keep the `<li>` node and its position in the parent `taskList`. Wrap the inner text node with `<a data-task-link="<taskId>" data-task-identifier="LUM-N" href="<canonical task URL>">…</a>`. Add `data-task-id` to the `<li>` itself so the front-end NodeView knows to switch render mode.
     - `data-extract-pending` `<span>` candidate (selector B path): replace the entire span with the same anchor structure.
   - Serialize DOM back to HTML.
   - `documentRepository.update(documentId, { content: html })` — bumps `updatedAt` via Prisma's `@updatedAt`.
7. Fire-and-forget side effects (already handled inside `taskCreation.createTask` per task — `dispatchCreateTaskSideEffects` runs Slack + activity + assignee notification).
8. Return `{ tasks, updatedContent, updatedAt, skipped }`.

**Why hover-single goes through `marked` too:** keeps the backend with one parser path. The client pays the cost of stamping one attribute before the post; the server doesn't need a separate "by-anchor-id" lookup.

## HTML Transformation Detail

### `taskItem` → linked `taskItem` (selectors `marked` and `all_unchecked`)

Before:

```html
<li data-type="taskItem" data-checked="false">
  <label><input type="checkbox" /><span></span></label>
  <div><p>改进 OAuth flow</p></div>
</li>
```

After:

```html
<li
  data-type="taskItem"
  data-checked="false"
  data-task-id="cm_abc123"
  data-task-identifier="LUM-92"
>
  <label><input type="checkbox" /><span></span></label>
  <div>
    <p>
      <a data-task-link="cm_abc123" href="/workspace/lumo/my-tasks/LUM-92"
        >改进 OAuth flow</a
      >
    </p>
  </div>
</li>
```

The `<li>` keeps its position in the `taskList` `<ul>` so doc structure does not fragment. The front-end NodeView keys off `data-task-id` (when present) to suppress the checkbox UI and render a task badge / icon instead.

### Inline selection → linked span (selector `marked`)

Before:

```html
<p>之前的文字 <span data-extract-pending="true">想转的部分</span> 之后的文字</p>
```

After:

```html
<p>
  之前的文字
  <a data-task-link="cm_def456" href="/workspace/lumo/my-tasks/LUM-93"
    >想转的部分</a
  >
  之后的文字
</p>
```

### Title vs description handling

- Title = `textContent.trim()` of the candidate node, truncated to 200 chars.
- If the original text exceeded 200 chars, the remainder is appended to the task description (so nothing is lost), and the candidate's `skipped` entry uses reason `too_long` (still counts as created — toast says "Created N tasks (M had text truncated; see task descriptions for the full body)").

## Front-end

### TipTap node extensions

- **Existing `taskItem` extension**: extend the NodeView (or add `parseHTML` / `renderHTML` overrides) to read `data-task-id`. When present:
  - Render the leading checkbox container as a small task-status icon (initially static — no live status query; that's V2)
  - Render inner content read-only (suppress local checkbox toggling on this `<li>`)
  - Wrap the inner text rendering in a link to the task URL
- **New `taskLink` mark or inline node**: parses `<a data-task-link>`. Behaves like a link with a small icon. Click → router push to the task URL. Defined as a node (not a mark) when block-level (inside a `<p>` standalone, rare), and as a mark when wrapping inline text.

### UI components

- **Hover action**: `taskItem` NodeView renders a `→ task` button at the row's trailing edge on hover. Only visible when `data-task-id` is absent. Click → wrap that `<li>` with `data-extract-pending` attribute, fire the API call.
- **Bubble menu**: add a "Convert to task" item to the existing TipTap bubble menu. Disabled when:
  - `editor.state.selection.empty === true`
  - Selection crosses paragraph boundaries (compute via `$from.parent !== $to.parent`)
  - Selection range contains any node matching `[data-task-link]`
- **Toolbar batch button**: a button in the doc's top toolbar showing `Extract {n} unchecked` where `n` is computed via `editor.state.doc.descendants(...)` counting `taskItem` nodes with `data-checked=false` and no `data-task-id`. Recomputed on every `editor.on('update')`. Hidden when `n === 0`. Click → minimal confirm dialog → POST with `all_unchecked` selector.
- **API client**: `lib/api-client/documents.ts` adds `extractTasks(docId, body)`. On success: replace the editor's content via `editor.commands.setContent(updatedContent)` and toast the result. On `MISSING_PROJECT` error: surface a toast with a "Set project" CTA that opens the doc settings drawer.

## Edge Cases

| Scenario                                            | Behavior                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty checkbox text `[ ] `                          | Skipped (`empty`). Toast: "Skipped 1 empty item." (or "N empty items") when count > 0 in the same batch.                                                                                                                                                                                                                                                                     |
| Candidate text > 200 chars                          | Title = first 200 chars, description = rest. Counted as created. Toast addendum: "(M had text truncated — see task descriptions for the full body)."                                                                                                                                                                                                                         |
| `doc.projectId === null`                            | 400 `MISSING_PROJECT`. Toast: "This doc has no project. Tasks need a project — set one in doc settings." with a CTA linking to the settings drawer.                                                                                                                                                                                                                          |
| Caller lacks edit permission                        | Buttons hidden in UI (permission already known client-side). 403 fallback on direct API call.                                                                                                                                                                                                                                                                                |
| Concurrent extract by two users                     | Both submissions process their own provided `content`. Whichever transaction commits second wins on `documentRepository.update` (last-write semantics — server uses `updatedAt` as a soft version check; on mismatch returns 409 and the client refetches and re-prompts).                                                                                                   |
| Selection spans paragraphs                          | Bubble menu button disabled. If client somehow bypasses (`marked` with cross-paragraph wrapping), server validates that `data-extract-pending` wraps text within a single block element; otherwise the span is added to `skipped` with `invalid_marker`.                                                                                                                     |
| Selection includes an existing `<a data-task-link>` | Bubble menu button disabled. Server-side, candidate is skipped with `invalid_marker`.                                                                                                                                                                                                                                                                                        |
| Batch 100 candidates                                | Single transaction — Prisma createMany for mentions, sequential createTask for tasks (sequence increment is serialized). Target P95 < 3s for 100; budget achievable on Neon Postgres with the existing connection pool.                                                                                                                                                      |
| User hits Cmd+Z after extract                       | Undo only reverts editor's local view to a pre-link state — it does NOT delete the created tasks. This is intentional: the side effect is real and visible elsewhere (task list, notifications). On next save / refresh the editor re-syncs with the server's link version. Toast on extract surfaces this: "Tasks are kept even if you undo. Remove them in the task list." |
| Doc was deleted between client load and extract     | `findEditable` returns null → bubbled as 404 (or 403 if doc still exists but caller lost edit access). Editor surface should already be gone; toast as fallback.                                                                                                                                                                                                             |
| Task deletion later                                 | The `<a data-task-link>` becomes a dead link. V1 accepts this — task page is gone but doc unchanged. V2 may add a "deleted task" rendering in the NodeView based on a fetch-on-render.                                                                                                                                                                                       |

## i18n

All new user-facing strings live under `doc.extract.*` and must be added to every locale file in `lib/i18n/`:

- `doc.extract.button.hover` — `→ task`
- `doc.extract.button.bubble` — `Convert to task`
- `doc.extract.button.batch` — `Extract {count} unchecked` (uses `{count}` ICU placeholder)
- `doc.extract.confirm.title` — `Create {count, plural, one {1 task} other {# tasks}}?`
- `doc.extract.confirm.message` — `Each task will be assigned to you with priority Low.`
- `doc.extract.confirm.cta` — `Create {count, plural, one {task} other {# tasks}}`
- `doc.extract.toast.success` — `Created {count, plural, one {1 task} other {# tasks}}.`
- `doc.extract.toast.skipped_empty` — `Skipped {count, plural, one {1 empty item} other {# empty items}}.`
- `doc.extract.toast.truncated` — `{count, plural, one {1 task had its title truncated} other {# tasks had their titles truncated}} — see task descriptions for the full body.`
- `doc.extract.toast.error_no_project` — `This doc has no project. Tasks need a project — set one in doc settings.`
- `doc.extract.toast.error_no_project_cta` — `Set project`
- `doc.extract.toast.error_conflict` — `Doc was edited elsewhere. Refresh and try again.`
- `doc.extract.toast.error_unknown` — `Could not extract tasks. Try again or refresh.`
- `doc.extract.linked_task_label` — `Linked to {identifier}` (tooltip on the rendered task icon)
- `doc.extract.undo_warning` — `Tasks are kept even if you undo. Remove them in the task list.`

Per CLAUDE.md i18n rule, **no English fallback** — every locale (`en.json`, `zh-CN.json`, and any other present) gets a proper translation. Plurals use ICU `{count, plural, ...}` syntax which all current locales already use elsewhere in the codebase.

## Testing

### Service unit tests (`__tests__/services/document-task-extraction.test.ts`)

- `all_unchecked`: identifies every unchecked `taskItem`, skips already-linked items, builds the right number of tasks
- `marked`: identifies only `data-extract-pending` nodes; ignores plain `taskItem`s
- Empty text → `skipped[].reason === 'empty'`, no task created
- Long text (300 chars) → title truncated to 200, full text in description
- Missing `projectId` → throws `MISSING_PROJECT`
- Permission denied (caller without edit access, doc PRIVATE) → throws 403
- Cross-paragraph marker → skipped with `invalid_marker`
- Already-linked candidate inside a marker → skipped with `invalid_marker`
- Returned `updatedContent` parses back through `node-html-parser` round-trip without structural changes
- Returned `updatedContent` validates against TipTap schema: spin up a headless ProseMirror schema instance with TipTap's `taskList` + `taskItem` + link extensions, call `EditorState.fromJSON` on the parsed HTML — must not throw

### API integration tests

- 201: typical batch extract, response shape matches
- 400 `MISSING_PROJECT`: doc with `projectId === null`
- 403: caller is workspace member but doc is PRIVATE and caller isn't creator
- 409 `NO_CANDIDATES`: selector resolves zero items
- 200 with all skipped: every candidate was empty — tasks empty, skipped populated

### Front-end component tests

- Hover button: shows on hover when `data-task-id` absent; hides when present
- Bubble menu "Convert to task": disabled when selection empty, cross-paragraph, or includes a `[data-task-link]`
- Toolbar batch button: count updates on every editor change, hides at 0
- After API success: `setContent` invoked with the response's `updatedContent`
- Undo after extract: editor reverts visually but no further API call fires; toast warning rendered

## Risks & Monitoring

- **TipTap schema drift**: a future TipTap upgrade could change `taskItem` serialization (the class names, the `data-type` value, the nested `<label><input></label>` shape). Mitigation: pin a TipTap version range in `package.json`; service tests round-trip real TipTap output to catch drift early; consider a CI test that boots the editor headlessly with the bundled TipTap version and asserts the serialized shape.
- **Concurrent extract conflicts**: two users batch-extracting at the same time will collide on `documentRepository.update`. Emit a `extract.conflict_409` counter to telemetry; if it grows past ~1% of calls, revisit the optimistic-lock strategy (currently last-write-wins with version check).
- **Latency on large docs**: 100-candidate batch hits Postgres for N task inserts + 1 mention `createMany` + 1 doc update. Emit `extract.duration_ms` with `candidate_count` dimension; target P95 < 1s for ≤ 10 candidates, < 3s for ≤ 100. If breached, batch task creation needs its own `createMany` path (currently sequential to preserve `Team.taskSeq` semantics).
- **HTML parser security**: `node-html-parser` is permissive; we don't render its output anywhere except the editor (which is itself a sandboxed TipTap surface). No XSS exposure beyond what the editor already presents.

## Implementation Order Hint (for the plan)

The natural slicing — each step independently testable and shippable behind a feature gate:

1. Service skeleton + DOM parsing + transaction wrapping (no UI). Behind a private flag, tested via API integration.
2. API route wired through. Still no UI.
3. TipTap `taskItem` NodeView updates (read `data-task-id`, render badge / link). Doc starts displaying extracted items correctly even if the trigger UI isn't built yet.
4. Hover action button on `taskItem`.
5. Bubble menu "Convert to task" action.
6. Toolbar batch button with confirm dialog.
7. i18n keys + locale files.
8. Edge-case polish (toast text, error states, undo warning).

The dependency line is 1 → 2 → 3 (UI display) → 4/5/6 (any order, independent). 7 + 8 thread through 4/5/6.

## Open Questions

- **Should extracting a `taskItem` toggle the visible checkbox to checked?** Two views: (a) no — the box stays unchecked because the _work_ isn't done, it's just been tracked elsewhere; the new task icon is the signal that tracking moved; (b) yes — visually "ticking it off the list" matches user mental model. Spec defaults to (a) for V1; revisit with user feedback.
- **What about `<task-list>` inside blockquotes / list items?** TipTap allows nesting. The selector probably needs `<li[data-type="taskItem"][data-checked="false"]>` to be unscoped (any depth), which `node-html-parser`'s CSS selector handles natively. Worth a test case in step 1.
- **Should the toolbar batch confirm dialog show a preview list?** V1 says no (zero-config, just count). If users routinely cancel after seeing the count, V2 adds a small preview list. Not blocking V1.
