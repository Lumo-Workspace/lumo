# Drafts ("草稿箱") — Design Spec

## Summary

Add a drafts system that lets users save incomplete task and project forms as private drafts, with a dedicated drafts page for browsing and restoring them. Additionally, auto-save form state to localStorage so accidental modal closes don't lose work.

## Two-Layer Architecture

| Layer               | Storage            | Purpose                                          | Visibility                       |
| ------------------- | ------------------ | ------------------------------------------------ | -------------------------------- |
| **Explicit drafts** | DB (`Draft` table) | User clicks "Save Draft" to intentionally save   | Private to creator, cross-device |
| **Form recovery**   | localStorage       | Auto-saves form state on change (debounce 500ms) | Local browser only               |

These layers are independent. Explicit drafts are managed in the drafts page. Form recovery is a transparent safety net shown as a banner when reopening a modal.

## Scope

- New `Draft` Prisma model
- New `/api/drafts` CRUD routes
- New `/workspace/[workspaceUrl]/drafts` page
- Sidebar navigation entry with draft count badge
- "Save Draft" button in NewTaskModal, NewProjectModal, QuickDispatchModal
- localStorage auto-recovery for all three modals
- Project drafts reuse `isIdea` — the drafts page aggregates both sources

## Data Model

```prisma
model Draft {
  id          String   @id @default(cuid())
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  creatorId   String   // actorId — drafts are private to creator
  type        String   // "TASK" | "PROJECT"
  data        Json     // serialized form field snapshot
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([workspaceId, creatorId])
}
```

**`data` field structure (validated at runtime with Zod):**

Task draft:

```typescript
{
  title?: string
  description?: string
  status?: ApiStatus
  priority?: ApiPriority
  projectId?: string
  assigneeId?: string
  repositoryId?: string
  dueDate?: string
}
```

Project draft:

```typescript
{
  name?: string
  description?: string
}
```

All fields are optional — a draft with only a title is valid.

**Project drafts and `isIdea`:** The drafts page shows `isIdea` projects alongside Draft records of type `PROJECT`. These are two separate sources aggregated in the UI. Creating a project draft via the "Save Draft" button creates a Draft record (not an `isIdea` project), since the form data may be incomplete (e.g., no name yet). The `isIdea` projects that already exist continue to appear in the drafts page as well.

## API Routes

### GET /api/drafts

Query params: `workspaceUrl`

Returns all drafts for the current user in the workspace, ordered by `updatedAt` desc.

Response:

```typescript
{
  drafts: Array<{
    id: string
    type: 'TASK' | 'PROJECT'
    data: Record<string, unknown>
    createdAt: string
    updatedAt: string
  }>
}
```

### POST /api/drafts

Upsert: if `id` is provided, update; otherwise create.

Request body:

```typescript
{
  id?: string
  workspaceUrl: string
  type: "TASK" | "PROJECT"
  data: Record<string, unknown>
}
```

Response: `{ draft: { id, type, data, createdAt, updatedAt } }`

### DELETE /api/drafts/[id]

Deletes a single draft. Only the creator can delete their own drafts.

Query params: `workspaceUrl`

Response: `{ success: true }`

## Validation Schemas

```typescript
// In lib/validation/schemas.ts

export const taskDraftDataSchema = z.object({
  title: z.string().max(500).optional(),
  description: z.string().max(10000).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  projectId: z.string().optional(),
  assigneeId: z.string().optional(),
  repositoryId: z.string().optional(),
  dueDate: z.string().datetime().nullable().optional(),
})

export const projectDraftDataSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
})

export const upsertDraftSchema = z.object({
  id: z.string().cuid().optional(),
  workspaceUrl: z.string().min(1),
  type: z.enum(['TASK', 'PROJECT']),
  data: z.record(z.unknown()),
  // data is further validated against taskDraftDataSchema or projectDraftDataSchema
  // based on `type` at runtime
})
```

## localStorage Form Recovery

### Cache Keys

- `lumo:form-recovery:new-task` — NewTaskModal form snapshot
- `lumo:form-recovery:new-project` — NewProjectModal form snapshot
- `lumo:form-recovery:quick-dispatch` — QuickDispatch input text

### Behavior

1. **Auto-save:** On form field change, debounce 500ms, write current form state to localStorage via `writeCache`.
2. **Recovery banner:** When a modal opens, check for cached data. If found, show a banner at the top of the modal: "Unsaved content detected" with "Restore" and "Discard" buttons.
3. **Clear on submit:** Successful form submission clears the recovery cache.
4. **Clear on "Save Draft":** Saving to DB draft clears the recovery cache (data is now safely in DB).
5. **No recovery cache when editing a draft:** When a modal is opened with data pre-filled from a DB draft, do NOT write to recovery cache. This avoids conflicts between the two layers.
6. **No write when form is empty:** Don't write recovery cache when all fields are at default/empty values.

### Recovery Banner UI

```
┌──────────────────────────────────────────────────────────────┐
│ 💡 Unsaved content detected from last session  [Restore] [Discard] │
└──────────────────────────────────────────────────────────────┘
```

Shown as a subtle info banner inside the modal, above the title input.

## UI: Drafts Page

### Route

`/workspace/[workspaceUrl]/drafts`

### Layout

- Two tabs: "Tasks" and "Projects"
- Tasks tab shows Draft records with `type: "TASK"`
- Projects tab shows Draft records with `type: "PROJECT"` + `isIdea` projects from the DB

### Draft Card

Each draft card displays:

- Title (from `data.title` or `data.name`) — or "Untitled draft" if empty
- Draft type badge (Task / Project)
- Relative timestamp ("2 hours ago", "yesterday")
- Partial field indicators: small icons/tags showing which fields are filled (e.g., priority pill, project name, assignee avatar)

### Actions

- **Click** → Opens corresponding modal pre-filled with draft data. Passes `draftId` as a prop so the modal knows it's restoring a draft (disables localStorage auto-save, deletes the draft on successful submit).
- **Delete** (trash icon, with confirmation) → `DELETE /api/drafts/[id]`
- For `isIdea` projects: click navigates to the project page (existing behavior)

### Empty State

"No drafts yet" with a brief description: "Save incomplete tasks and projects here to finish them later."

## UI: Sidebar Entry

Add "Drafts" item to the sidebar navigation, in the top-level group (alongside My Tasks and Inbox):

- Icon: `FileEdit` from lucide-react
- Label: i18n `sidebar.drafts`
- Badge: draft count (only Task/Project drafts from DB, not localStorage). Hidden when count is 0.
- Route: `/workspace/[workspaceUrl]/drafts`

## UI: Save Draft Buttons

### NewTaskModal

Footer area, left side (before Cancel):

```
[Save Draft]          [Cancel] [Create ⌘↵]
```

"Save Draft" is a ghost button. On click:

1. POST to `/api/drafts` with current form state
2. Clear localStorage recovery cache
3. Close modal
4. Show toast: "Draft saved"

### NewProjectModal

Same pattern as NewTaskModal.

### QuickDispatchModal

In the preview phase, add "Save Draft" between "Edit" and "Confirm":

```
[Back]     [Edit] [Save Draft] [Confirm]
```

Saves the parsed result as a Task draft.

## Data Flow Summary

```
User action                        Storage              Recovery
───────────────────────────────────────────────────────────────────
Typing in modal → debounce 500ms → localStorage       → Banner on next modal open
Click "Save Draft"               → DB (Draft table)   → Drafts page click
                                   + clear localStorage
From draft → edit → submit       → Delete Draft record → —
                                   localStorage NOT written
From draft → edit → close        → Draft record stays  → Drafts page still shows it
Submit (no draft involved)       → Clear localStorage  → —
```

## Key Rules

1. From-draft editing does NOT trigger localStorage auto-save (avoid two-source conflicts).
2. "Save Draft" clears localStorage cache for that form.
3. Successful submit deletes the DB draft (if restoring from one) AND clears localStorage.
4. Draft count badge in sidebar only counts DB drafts, not localStorage recovery data.
5. `isIdea` projects appear in the Projects tab of the drafts page but are not Draft records — they link to the project page directly.

## i18n Keys

```
drafts.title = "Drafts" / "草稿箱"
drafts.tabTasks = "Tasks" / "任务"
drafts.tabProjects = "Projects" / "项目"
drafts.empty = "No drafts yet" / "暂无草稿"
drafts.emptyDescription = "Save incomplete tasks and projects here to finish them later." / "在这里保存未完成的任务和项目，稍后继续编辑。"
drafts.untitled = "Untitled draft" / "无标题草稿"
drafts.saveDraft = "Save Draft" / "保存草稿"
drafts.saved = "Draft saved" / "草稿已保存"
drafts.delete = "Delete draft" / "删除草稿"
drafts.deleteConfirm = "Delete this draft?" / "确定删除这个草稿？"
drafts.recovery = "Unsaved content detected from last session" / "检测到上次未完成的内容"
drafts.restore = "Restore" / "恢复"
drafts.discard = "Discard" / "清空"
sidebar.drafts = "Drafts" / "草稿箱"
```

## Out of Scope

- Shared/collaborative drafts (drafts are always private)
- Draft versioning or history
- Auto-expiration of old drafts (user deletes manually or submits)
- Offline support / service worker caching
- Draft for subtasks or documents
