# Phase C: Type System Unification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate dead/duplicate types from `types/`, centralize service/repository type exports, and reduce direct `@prisma/client` type imports.

**Architecture:** Grep each type for actual imports, delete zero-reference types, ensure barrel exports from `lib/services/index.ts` and `lib/repositories/index.ts` cover all public types.

**Tech Stack:** TypeScript, Prisma

---

### Task 1: Delete Dead Types from types/index.ts

**Files:**

- Modify: `types/index.ts`

- [ ] **Step 1: Delete unused types**

Remove these types that have zero imports outside the file:

```typescript
// DELETE all of these from types/index.ts:
// - Block (lines ~142-148)
// - BlockType (lines ~150-157)
// - AgentRecommendation (lines ~184-189)
// - QualityCheck (lines ~192-200)
// - QualityCategory (lines ~202-206)
// - ValidationError (lines ~226-229) — duplicate of api.ts
// - FormState<T> (lines ~231-236) — duplicate of forms.ts
// - BaseEvent (lines ~239-244)
// - PageEvent (lines ~246-249)
// - StoryEvent (lines ~251-259)
// - TaskEvent (lines ~261-265)
// - AppEvent (lines ~267)
// - Notification (lines ~270-280)
// - NotificationType (lines ~282)
// - ViewType (lines ~304)
// - ViewMode (lines ~305)
// - TeamViewMode (lines ~306)
// - ContextMenuState (lines ~308-313)
// - EntityId (lines ~316)
// - Timestamp (lines ~317)
// - EntityWithTimestamps (lines ~318-321)
```

Read the file first, identify exact line ranges, then remove each type. Keep all types that ARE imported (User, Team, Project, Story, Task, Agent, ApiResponse, PaginatedResponse, SearchFilters, SortOptions, etc.).

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: zero errors (we only deleted unused types)

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "chore: remove 21 dead types from types/index.ts [LUM-0]"
```

---

### Task 2: Clean types/api.ts

**Files:**

- Modify: `types/api.ts`

- [ ] **Step 1: Grep for actual imports from types/api.ts**

Run grep to confirm which exports are actually imported by other files. Keep only those with real consumers. Candidates for deletion: all CRUD request/response types (CreateUserRequest, UpdateUserRequest, etc.), HttpMethod, ApiEndpoint, ApiRequestConfig, PaginationParams, Stats types, WebSocket event types.

Keep: ApiError, ApiErrorResponse, ValidationError (if imported).

- [ ] **Step 2: Delete unused types**

Remove all types with zero external imports.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add types/api.ts
git commit -m "chore: remove unused API types from types/api.ts [LUM-0]"
```

---

### Task 3: Clean types/forms.ts, types/kanban.ts, types/profile.ts

**Files:**

- Modify: `types/forms.ts`
- Modify: `types/kanban.ts`
- Modify: `types/profile.ts`

- [ ] **Step 1: Grep each file's exports for actual imports**

For each file, identify which exports have zero consumers. Expected: most form field types, kanban types, and profile utility types are dead.

- [ ] **Step 2: Delete unused types from all three files**

Keep only types with real imports. For `types/profile.ts`, keep `UserProfile` (used by `hooks/use-profile-updates.ts`). For `types/summary.ts` — all types are in use, don't touch.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add types/forms.ts types/kanban.ts types/profile.ts
git commit -m "chore: remove unused form/kanban/profile types [LUM-0]"
```

---

### Task 4: Verify Service/Repository Barrel Exports

**Files:**

- Modify: `lib/services/index.ts`
- Modify: `lib/repositories/index.ts`

- [ ] **Step 1: Check current barrel exports**

Read `lib/services/index.ts` and `lib/repositories/index.ts`. Verify every public input/output type (UpdateTaskInput, TaskUpdateResult, UpdateProjectInput, UpdateDocumentInput, CreateDocumentData, DocumentFilters, CreateWorkspaceData) is re-exported.

- [ ] **Step 2: Add any missing re-exports**

If any service/repository defines a public type that isn't re-exported through the barrel, add it.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add lib/services/index.ts lib/repositories/index.ts
git commit -m "chore: ensure complete barrel exports for services/repositories [LUM-0]"
```

---

### Task 5: Full Verification

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 2: Tests**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 3: Verify no type conflicts**

Grep for types that exist in both `types/` and `app/workspace/[workspaceUrl]/types.ts` with the same name but different shapes. After cleanup, remaining overlaps should be intentional (e.g., `types/index.ts` User is a generic user, workspace types has WorkspaceMemberInfo which is a different concept).
