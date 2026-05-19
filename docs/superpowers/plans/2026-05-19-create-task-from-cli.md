# Create Task from CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `lumo task create <title>` so users can file a task from the terminal in one HTTP call. Supports `--description`, `--priority`, `--assignee`, `--project` with server-side resolution of human-friendly refs (project name/slug, member email/name).

**Architecture:** Thin CLI → Bearer-authed `POST /api/tasks` → new `task-cli.service.ts` that resolves project + assignee via existing repositories then delegates to `taskService.createTask`. CLI is a single HTTP call; no local listing/disambiguation logic.

**Tech Stack:** TypeScript, Commander (CLI), Next.js App Router (route), Prisma + Clerk (data), Zod (validation), Jest (tests).

**Spec:** [docs/superpowers/specs/2026-05-19-create-task-from-cli-design.md](../specs/2026-05-19-create-task-from-cli-design.md)

---

## File Structure

**New files (server):**

- `lib/services/task-cli.service.ts` — `resolveProjectId`, `resolveAssigneeActorId`, `createFromCli`
- `app/api/tasks/route.ts` — `POST` handler (Bearer auth, ~50 lines)
- `__tests__/task-cli.service.test.ts` — resolution + create flow tests
- `__tests__/api-tasks-create.test.ts` — route auth + happy path + error mapping

**New files (CLI):**

- `cli/src/commands/task-create.ts` — flag parsing, HTTP call, output formatter
- `__tests__/cli/task-create-format.test.ts` — pure-function formatter tests

**Edited files:**

- `lib/validation/schemas.ts` — append `cliCreateTaskSchema`
- `lib/repositories/member.repository.ts` — append `findAllWithProfilesForCli`
- `__tests__/member.repository.test.ts` — append tests for the new helper
- `cli/src/index.ts` — register `task create <title>` subcommand

**Reused (no edits):**

- `lib/auth/bearer.ts` — `verifyBearer`
- `lib/repositories/project.repository.ts` — `findByWorkspaceNonIdea`
- `lib/services/task.service.ts` — `createTask`
- `lib/utils/slugify.ts` — `slugify`

---

### Task 1: Add CLI create-task validation schema

**Files:**

- Modify: `lib/validation/schemas.ts` (append after `createTaskSchema`, near line 116)
- Test: `__tests__/cli-create-task-schema.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli-create-task-schema.test.ts`:

```ts
import { cliCreateTaskSchema } from '@/lib/validation/schemas'

describe('cliCreateTaskSchema', () => {
  it('accepts a minimal payload with only title', () => {
    const result = cliCreateTaskSchema.safeParse({ title: 'Hello' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.title).toBe('Hello')
      expect(result.data.priority).toBe('LOW')
    }
  })

  it('defaults priority to LOW (matches CLI default, not server-side MEDIUM)', () => {
    const result = cliCreateTaskSchema.safeParse({ title: 't' })
    expect(result.success && result.data.priority).toBe('LOW')
  })

  it('accepts all optional fields', () => {
    const result = cliCreateTaskSchema.safeParse({
      title: 't',
      description: 'd',
      priority: 'HIGH',
      projectRef: 'lumo',
      assigneeRef: 'ada@example.com',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty title', () => {
    const result = cliCreateTaskSchema.safeParse({ title: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown priority', () => {
    const result = cliCreateTaskSchema.safeParse({
      title: 't',
      priority: 'low',
    })
    expect(result.success).toBe(false)
  })

  it('rejects title over 500 chars', () => {
    const result = cliCreateTaskSchema.safeParse({ title: 'x'.repeat(501) })
    expect(result.success).toBe(false)
  })

  it('rejects description over 10000 chars', () => {
    const result = cliCreateTaskSchema.safeParse({
      title: 't',
      description: 'x'.repeat(10001),
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli-create-task-schema.test.ts`
Expected: FAIL — `cliCreateTaskSchema` is not exported.

- [ ] **Step 3: Implement the schema**

In `lib/validation/schemas.ts`, append below `updateTaskSchema` (around line 132):

```ts
/**
 * CLI-side task create: accepts human-friendly refs (project name/slug,
 * member email/name) instead of internal IDs. Server resolves them.
 *
 * Priority defaults to LOW to match the CLI's UX default. The web schema
 * (`createTaskSchema`) keeps MEDIUM for other callers — do not unify them.
 */
export const cliCreateTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(500, 'Title must be at most 500 characters'),
  description: z.string().max(10000).nullable().optional(),
  priority: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    .optional()
    .default('LOW'),
  projectRef: z.string().trim().min(1).max(200).optional(),
  assigneeRef: z.string().trim().min(1).max(200).optional(),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli-create-task-schema.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/validation/schemas.ts __tests__/cli-create-task-schema.test.ts
git commit -m "feat: cliCreateTaskSchema for human-ref task creation [LUM-43]"
```

---

### Task 2: Add member repository helper for CLI assignee resolution

We need a single call that returns every workspace member with their Clerk email + display name + actor id, so the resolver can match by email or name in one Clerk roundtrip.

**Files:**

- Modify: `lib/repositories/member.repository.ts` (append after `findActorsByEmailInWorkspace`, near line 192)
- Test: `__tests__/member.repository.test.ts` (append a new `describe` block)

- [ ] **Step 1: Write the failing test**

Append to `__tests__/member.repository.test.ts` (inside the `describe('memberRepository', ...)` block):

```ts
describe('findAllWithProfilesForCli', () => {
  it('returns every member with email, displayName, clerkId, actorId', async () => {
    mockMemberFindMany.mockResolvedValue([
      { id: 'm-1', clerkId: 'clerk-1', actor: { id: 'actor-1' } },
      { id: 'm-2', clerkId: 'clerk-2', actor: { id: 'actor-2' } },
    ])
    mockClerkGetUserList.mockResolvedValue({
      data: [
        {
          id: 'clerk-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          primaryEmailAddressId: 'e-1',
          emailAddresses: [{ id: 'e-1', emailAddress: 'ada@example.com' }],
        },
        {
          id: 'clerk-2',
          firstName: null,
          lastName: null,
          primaryEmailAddressId: 'e-2',
          emailAddresses: [{ id: 'e-2', emailAddress: 'bob@example.com' }],
        },
      ],
    })

    const result = await memberRepository.findAllWithProfilesForCli('ws-1')

    expect(result).toEqual([
      {
        memberId: 'm-1',
        clerkId: 'clerk-1',
        actorId: 'actor-1',
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
      },
      {
        memberId: 'm-2',
        clerkId: 'clerk-2',
        actorId: 'actor-2',
        email: 'bob@example.com',
        displayName: 'bob',
      },
    ])
    expect(mockClerkGetUserList).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ['clerk-1', 'clerk-2'] })
    )
  })

  it('skips members with no actor row (defensive)', async () => {
    mockMemberFindMany.mockResolvedValue([
      { id: 'm-1', clerkId: 'clerk-1', actor: null },
      { id: 'm-2', clerkId: 'clerk-2', actor: { id: 'actor-2' } },
    ])
    mockClerkGetUserList.mockResolvedValue({
      data: [
        {
          id: 'clerk-2',
          firstName: 'Bob',
          lastName: null,
          primaryEmailAddressId: 'e-2',
          emailAddresses: [{ id: 'e-2', emailAddress: 'bob@example.com' }],
        },
      ],
    })

    const result = await memberRepository.findAllWithProfilesForCli('ws-1')

    expect(result).toHaveLength(1)
    expect(result[0]?.memberId).toBe('m-2')
  })

  it('returns empty when workspace has no members', async () => {
    mockMemberFindMany.mockResolvedValue([])

    const result = await memberRepository.findAllWithProfilesForCli('ws-1')

    expect(result).toEqual([])
    expect(mockClerkGetUserList).not.toHaveBeenCalled()
  })

  it('returns members with empty profile fields when Clerk has no record', async () => {
    mockMemberFindMany.mockResolvedValue([
      { id: 'm-1', clerkId: 'clerk-1', actor: { id: 'actor-1' } },
    ])
    mockClerkGetUserList.mockResolvedValue({ data: [] })

    const result = await memberRepository.findAllWithProfilesForCli('ws-1')

    expect(result).toEqual([
      {
        memberId: 'm-1',
        clerkId: 'clerk-1',
        actorId: 'actor-1',
        email: '',
        displayName: '',
      },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/member.repository.test.ts -t findAllWithProfilesForCli`
Expected: FAIL — `findAllWithProfilesForCli is not a function`.

- [ ] **Step 3: Implement the helper**

In `lib/repositories/member.repository.ts`, append before the closing `}` of `memberRepository` (after `findActorsByEmailInWorkspace`, around line 192):

```ts
  /**
   * Return every workspace member with Clerk email + display name + actor id
   * in a single batch call. Used by CLI assignee resolution where we may
   * need to match by either email or name in one request, and where the
   * caller can tolerate Clerk's ~100-300ms roundtrip.
   *
   * Members with no actor row are omitted (you can't assign to them anyway).
   * Members whose Clerk profile is missing get empty email/displayName so
   * the caller's "no match" message can still list them as candidates.
   */
  async findAllWithProfilesForCli(
    workspaceId: string
  ): Promise<
    {
      memberId: string
      clerkId: string
      actorId: string
      email: string
      displayName: string
    }[]
  > {
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: {
        id: true,
        clerkId: true,
        actor: { select: { id: true } },
      },
      orderBy: { joinedAt: 'asc' },
    })

    const eligible = members.filter(
      (m): m is typeof m & { actor: { id: string } } => m.actor !== null
    )
    if (eligible.length === 0) return []

    const clerkIds = eligible.map(m => m.clerkId)

    const { createClerkClient } = await import('@clerk/nextjs/server')
    const clerk = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY!,
    })
    const { data: users } = await clerk.users.getUserList({
      userId: clerkIds,
      limit: Math.min(clerkIds.length, 100),
    })

    const profileByClerkId = new Map<
      string,
      { email: string; displayName: string }
    >()
    for (const u of users) {
      const email =
        u.emailAddresses.find(e => e.id === u.primaryEmailAddressId)
          ?.emailAddress ??
        u.emailAddresses[0]?.emailAddress ??
        ''
      const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
      const displayName = fullName || email.split('@')[0] || ''
      profileByClerkId.set(u.id, { email, displayName })
    }

    return eligible.map(m => {
      const p = profileByClerkId.get(m.clerkId)
      return {
        memberId: m.id,
        clerkId: m.clerkId,
        actorId: m.actor.id,
        email: p?.email ?? '',
        displayName: p?.displayName ?? '',
      }
    })
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/member.repository.test.ts -t findAllWithProfilesForCli`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full member-repo suite to verify nothing else broke**

Run: `npx jest __tests__/member.repository.test.ts`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/member.repository.ts __tests__/member.repository.test.ts
git commit -m "feat: memberRepository.findAllWithProfilesForCli for CLI assignee resolution [LUM-43]"
```

---

### Task 3: Add task-cli.service.ts (project + assignee resolution + create)

This is the brain. Pure service: takes a workspace + caller + parsed input, resolves refs, delegates to `taskService.createTask`, returns identifier + URL.

**Files:**

- Create: `lib/services/task-cli.service.ts`
- Test: `__tests__/task-cli.service.test.ts`

- [ ] **Step 1: Write the failing test (resolveProjectId)**

Create `__tests__/task-cli.service.test.ts`:

```ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findByWorkspaceNonIdea: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByWorkspaceAndClerkId: jest.fn(),
    findActorByMemberId: jest.fn(),
    findAllWithProfilesForCli: jest.fn(),
  },
}))

jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    createTask: jest.fn(),
  },
}))

import { taskCliService } from '@/lib/services/task-cli.service'
import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskService } from '@/lib/services/task.service'

const mockFindProjects = projectRepository.findByWorkspaceNonIdea as jest.Mock
const mockFindMember = memberRepository.findByWorkspaceAndClerkId as jest.Mock
const mockFindActor = memberRepository.findActorByMemberId as jest.Mock
const mockFindAllProfiles =
  memberRepository.findAllWithProfilesForCli as jest.Mock
const mockCreateTask = taskService.createTask as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskCliService.resolveProjectId', () => {
  it('returns the single project when ref is omitted', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
    ])
    const id = await taskCliService.resolveProjectId('ws-1', undefined)
    expect(id).toBe('p-1')
  })

  it('throws 400 with candidates when ref is omitted and multiple projects exist', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
      { id: 'p-2', name: 'Agent Server', description: null },
    ])
    await expect(
      taskCliService.resolveProjectId('ws-1', undefined)
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Available: lumo, agent-server'),
    })
  })

  it('throws when workspace has no projects', async () => {
    mockFindProjects.mockResolvedValue([])
    await expect(
      taskCliService.resolveProjectId('ws-1', undefined)
    ).rejects.toMatchObject({ status: 400 })
  })

  it('matches a project by exact name (case-insensitive)', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
      { id: 'p-2', name: 'Agent Server', description: null },
    ])
    const id = await taskCliService.resolveProjectId('ws-1', 'lumo')
    expect(id).toBe('p-1')
  })

  it('matches a project by slugified name', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
      { id: 'p-2', name: 'Agent Server', description: null },
    ])
    const id = await taskCliService.resolveProjectId('ws-1', 'agent-server')
    expect(id).toBe('p-2')
  })

  it('throws 400 when ref matches no project, listing candidates', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
    ])
    await expect(
      taskCliService.resolveProjectId('ws-1', 'unknown')
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('no project matches "unknown"'),
    })
  })

  it('throws 400 when ref matches more than one project', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
      { id: 'p-2', name: 'lumo', description: null },
    ])
    await expect(
      taskCliService.resolveProjectId('ws-1', 'lumo')
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('multiple projects match "lumo"'),
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/task-cli.service.test.ts -t resolveProjectId`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement task-cli.service.ts skeleton + resolveProjectId**

Create `lib/services/task-cli.service.ts`:

```ts
import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskService } from '@/lib/services/task.service'
import { slugify } from '@/lib/utils/slugify'
import type { TaskPriority } from '@prisma/client'

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

/**
 * Resolve a `--project <ref>` argument to a project id within a workspace.
 * Matches case-insensitively against the project's name OR its slugified
 * name (the same form the web UI uses in URLs). When ref is omitted, picks
 * the single non-idea project, or throws with a candidate list.
 */
async function resolveProjectId(
  workspaceId: string,
  projectRef: string | undefined
): Promise<string> {
  const projects = await projectRepository.findByWorkspaceNonIdea(workspaceId)
  if (projects.length === 0) {
    throw httpError(
      400,
      'Workspace has no projects. Create one in the web UI first.'
    )
  }

  const candidates = projects.map(p => slugify(p.name)).join(', ')

  if (!projectRef) {
    if (projects.length === 1) return projects[0]!.id
    throw httpError(
      400,
      `Workspace has multiple projects. Use --project <name>.\nAvailable: ${candidates}`
    )
  }

  const ref = projectRef.trim().toLowerCase()
  const refSlug = slugify(projectRef)
  const matches = projects.filter(
    p => p.name.toLowerCase() === ref || slugify(p.name) === refSlug
  )
  if (matches.length === 1) return matches[0]!.id
  if (matches.length === 0) {
    throw httpError(
      400,
      `No project matches "${projectRef}".\nAvailable: ${candidates}`
    )
  }
  throw httpError(
    400,
    `Multiple projects match "${projectRef}". Use a more specific name.`
  )
}

export const taskCliService = {
  resolveProjectId,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/task-cli.service.test.ts -t resolveProjectId`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing test (resolveAssigneeActorId)**

Append to `__tests__/task-cli.service.test.ts`:

```ts
describe('taskCliService.resolveAssigneeActorId', () => {
  it('resolves "me" via caller clerkId → member → actor', async () => {
    mockFindMember.mockResolvedValue({ id: 'mem-1' })
    mockFindActor.mockResolvedValue({ id: 'actor-1' })

    const id = await taskCliService.resolveAssigneeActorId({
      workspaceId: 'ws-1',
      callerClerkId: 'clerk-1',
      assigneeRef: 'me',
    })

    expect(id).toBe('actor-1')
    expect(mockFindAllProfiles).not.toHaveBeenCalled()
  })

  it('treats omitted assigneeRef as "me"', async () => {
    mockFindMember.mockResolvedValue({ id: 'mem-1' })
    mockFindActor.mockResolvedValue({ id: 'actor-1' })

    const id = await taskCliService.resolveAssigneeActorId({
      workspaceId: 'ws-1',
      callerClerkId: 'clerk-1',
      assigneeRef: undefined,
    })

    expect(id).toBe('actor-1')
  })

  it('throws when caller is not a member of the workspace', async () => {
    mockFindMember.mockResolvedValue(null)

    await expect(
      taskCliService.resolveAssigneeActorId({
        workspaceId: 'ws-1',
        callerClerkId: 'clerk-x',
        assigneeRef: 'me',
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('matches assignee by email (case-insensitive)', async () => {
    mockFindAllProfiles.mockResolvedValue([
      {
        memberId: 'm-1',
        clerkId: 'c-1',
        actorId: 'a-1',
        email: 'ada@example.com',
        displayName: 'Ada',
      },
      {
        memberId: 'm-2',
        clerkId: 'c-2',
        actorId: 'a-2',
        email: 'bob@example.com',
        displayName: 'Bob',
      },
    ])

    const id = await taskCliService.resolveAssigneeActorId({
      workspaceId: 'ws-1',
      callerClerkId: 'c-1',
      assigneeRef: 'ADA@example.com',
    })

    expect(id).toBe('a-1')
  })

  it('matches assignee by displayName (case-insensitive)', async () => {
    mockFindAllProfiles.mockResolvedValue([
      {
        memberId: 'm-1',
        clerkId: 'c-1',
        actorId: 'a-1',
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
      },
    ])

    const id = await taskCliService.resolveAssigneeActorId({
      workspaceId: 'ws-1',
      callerClerkId: 'c-1',
      assigneeRef: 'ada lovelace',
    })

    expect(id).toBe('a-1')
  })

  it('prefers email over name when both could match', async () => {
    mockFindAllProfiles.mockResolvedValue([
      {
        memberId: 'm-1',
        clerkId: 'c-1',
        actorId: 'a-1',
        email: 'alice@example.com',
        displayName: 'Different Name',
      },
      {
        memberId: 'm-2',
        clerkId: 'c-2',
        actorId: 'a-2',
        email: 'other@example.com',
        displayName: 'alice@example.com',
      },
    ])

    const id = await taskCliService.resolveAssigneeActorId({
      workspaceId: 'ws-1',
      callerClerkId: 'c-1',
      assigneeRef: 'alice@example.com',
    })

    expect(id).toBe('a-1')
  })

  it('throws 400 when no member matches', async () => {
    mockFindAllProfiles.mockResolvedValue([
      {
        memberId: 'm-1',
        clerkId: 'c-1',
        actorId: 'a-1',
        email: 'ada@example.com',
        displayName: 'Ada',
      },
    ])

    await expect(
      taskCliService.resolveAssigneeActorId({
        workspaceId: 'ws-1',
        callerClerkId: 'c-1',
        assigneeRef: 'zoe',
      })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('no member matches "zoe"'),
    })
  })

  it('throws 400 when multiple members share the same name', async () => {
    mockFindAllProfiles.mockResolvedValue([
      {
        memberId: 'm-1',
        clerkId: 'c-1',
        actorId: 'a-1',
        email: 'ada1@example.com',
        displayName: 'Ada',
      },
      {
        memberId: 'm-2',
        clerkId: 'c-2',
        actorId: 'a-2',
        email: 'ada2@example.com',
        displayName: 'Ada',
      },
    ])

    await expect(
      taskCliService.resolveAssigneeActorId({
        workspaceId: 'ws-1',
        callerClerkId: 'c-1',
        assigneeRef: 'Ada',
      })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('ada1@example.com, ada2@example.com'),
    })
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest __tests__/task-cli.service.test.ts -t resolveAssigneeActorId`
Expected: FAIL — `taskCliService.resolveAssigneeActorId is not a function`.

- [ ] **Step 7: Implement resolveAssigneeActorId**

In `lib/services/task-cli.service.ts`, add this function above the export, then add it to the export:

```ts
async function resolveAssigneeActorId(args: {
  workspaceId: string
  callerClerkId: string
  assigneeRef: string | undefined
}): Promise<string> {
  const { workspaceId, callerClerkId, assigneeRef } = args
  const isMe = !assigneeRef || assigneeRef.trim().toLowerCase() === 'me'

  if (isMe) {
    const member = await memberRepository.findByWorkspaceAndClerkId(
      workspaceId,
      callerClerkId
    )
    if (!member) {
      throw httpError(400, 'Caller is not a member of this workspace')
    }
    const actor = await memberRepository.findActorByMemberId(member.id)
    if (!actor) {
      throw httpError(
        500,
        'Member has no actor row — workspace data is inconsistent'
      )
    }
    return actor.id
  }

  const ref = assigneeRef!.trim().toLowerCase()
  const candidates =
    await memberRepository.findAllWithProfilesForCli(workspaceId)

  const byEmail = candidates.filter(c => c.email.toLowerCase() === ref)
  if (byEmail.length === 1) return byEmail[0]!.actorId
  if (byEmail.length > 1) {
    const list = byEmail.map(c => c.email).join(', ')
    throw httpError(400, `Multiple members match "${assigneeRef}": ${list}`)
  }

  const byName = candidates.filter(c => c.displayName.toLowerCase() === ref)
  if (byName.length === 1) return byName[0]!.actorId
  if (byName.length > 1) {
    const list = byName.map(c => c.email).join(', ')
    throw httpError(400, `Multiple members match "${assigneeRef}": ${list}`)
  }

  throw httpError(400, `No member matches "${assigneeRef}".`)
}

export const taskCliService = {
  resolveProjectId,
  resolveAssigneeActorId,
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest __tests__/task-cli.service.test.ts -t resolveAssigneeActorId`
Expected: PASS (8 tests).

- [ ] **Step 9: Write the failing test (createFromCli)**

Append to `__tests__/task-cli.service.test.ts`:

```ts
describe('taskCliService.createFromCli', () => {
  beforeEach(() => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
    ])
    mockFindMember.mockResolvedValue({ id: 'mem-1' })
    mockFindActor.mockResolvedValue({ id: 'actor-caller' })
    mockCreateTask.mockResolvedValue({
      task: {
        id: 'task-1',
        title: 'Hello',
        teamIdentifier: 'LUM',
        number: 44,
      },
    })
  })

  it('delegates to taskService.createTask with resolved IDs and returns identifier + URL', async () => {
    const result = await taskCliService.createFromCli({
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk-1',
      input: { title: 'Hello', priority: 'LOW' },
    })

    expect(mockCreateTask).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({
        title: 'Hello',
        priority: 'LOW',
        status: 'TODO',
        assigneeActorId: 'actor-caller',
      }),
      'actor-caller',
      'clerk-1'
    )
    expect(result).toEqual({
      id: 'task-1',
      identifier: 'LUM-44',
      title: 'Hello',
      url: 'https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44',
    })
  })

  it('respects an explicit projectRef and assigneeRef', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
      { id: 'p-2', name: 'Agent Server', description: null },
    ])
    mockFindAllProfiles.mockResolvedValue([
      {
        memberId: 'm-2',
        clerkId: 'c-2',
        actorId: 'actor-ada',
        email: 'ada@example.com',
        displayName: 'Ada',
      },
    ])

    await taskCliService.createFromCli({
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk-1',
      input: {
        title: 'Hello',
        priority: 'HIGH',
        projectRef: 'agent-server',
        assigneeRef: 'ada@example.com',
      },
    })

    expect(mockCreateTask).toHaveBeenCalledWith(
      'p-2',
      expect.objectContaining({
        title: 'Hello',
        priority: 'HIGH',
        assigneeActorId: 'actor-ada',
      }),
      'actor-caller',
      'clerk-1'
    )
  })

  it('uses configured base URL when LUMO_API_URL is set', async () => {
    const original = process.env.LUMO_PUBLIC_URL
    process.env.LUMO_PUBLIC_URL = 'https://staging.uselumo.ai'
    try {
      const result = await taskCliService.createFromCli({
        workspaceId: 'ws-1',
        workspaceSlug: 'lumo',
        callerClerkId: 'clerk-1',
        input: { title: 'Hello', priority: 'LOW' },
      })
      expect(result.url).toBe(
        'https://staging.uselumo.ai/workspace/lumo/my-tasks/LUM-44'
      )
    } finally {
      process.env.LUMO_PUBLIC_URL = original
    }
  })
})
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx jest __tests__/task-cli.service.test.ts -t createFromCli`
Expected: FAIL — `taskCliService.createFromCli is not a function`.

- [ ] **Step 11: Implement createFromCli**

In `lib/services/task-cli.service.ts`, replace the export block:

```ts
const DEFAULT_PUBLIC_URL = 'https://www.uselumo.ai'

function resolvePublicUrl(): string {
  const v = process.env.LUMO_PUBLIC_URL?.trim()
  return v && v.length > 0 ? v.replace(/\/+$/, '') : DEFAULT_PUBLIC_URL
}

async function createFromCli(args: {
  workspaceId: string
  workspaceSlug: string
  callerClerkId: string
  input: {
    title: string
    description?: string | null | undefined
    priority: TaskPriority
    projectRef?: string | undefined
    assigneeRef?: string | undefined
  }
}): Promise<{ id: string; identifier: string; title: string; url: string }> {
  const { workspaceId, workspaceSlug, callerClerkId, input } = args

  const projectId = await resolveProjectId(workspaceId, input.projectRef)
  const assigneeActorId = await resolveAssigneeActorId({
    workspaceId,
    callerClerkId,
    assigneeRef: input.assigneeRef,
  })

  // We need the caller's own actor id to attribute the create activity.
  // For assigneeRef === "me" this is identical to assigneeActorId; for
  // other refs we still need it, so resolve via the caller's member row.
  const callerMember = await memberRepository.findByWorkspaceAndClerkId(
    workspaceId,
    callerClerkId
  )
  if (!callerMember) {
    throw httpError(400, 'Caller is not a member of this workspace')
  }
  const callerActor = await memberRepository.findActorByMemberId(
    callerMember.id
  )
  if (!callerActor) {
    throw httpError(500, 'Member has no actor row')
  }

  const { task } = await taskService.createTask(
    projectId,
    {
      title: input.title,
      description: input.description ?? null,
      status: 'TODO',
      priority: input.priority,
      assigneeActorId,
    },
    callerActor.id,
    callerClerkId
  )

  const identifier = `${task.teamIdentifier}-${task.number}`
  const url = `${resolvePublicUrl()}/workspace/${workspaceSlug}/my-tasks/${identifier}`

  return { id: task.id, identifier, title: task.title, url }
}

export const taskCliService = {
  resolveProjectId,
  resolveAssigneeActorId,
  createFromCli,
}
```

- [ ] **Step 12: Run all task-cli tests**

Run: `npx jest __tests__/task-cli.service.test.ts`
Expected: PASS (all 3 describe blocks, ~18 tests).

- [ ] **Step 13: Commit**

```bash
git add lib/services/task-cli.service.ts __tests__/task-cli.service.test.ts
git commit -m "feat: taskCliService for CLI-driven task creation [LUM-43]"
```

---

### Task 4: Add POST /api/tasks Bearer-auth route

Thin HTTP layer: verify bearer → validate body → call service → map errors → 201.

**Files:**

- Create: `app/api/tasks/route.ts`
- Test: `__tests__/api-tasks-create.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api-tasks-create.test.ts`:

```ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/auth/bearer', () => ({
  verifyBearer: jest.fn(),
}))

jest.mock('@/lib/services/task-cli.service', () => ({
  taskCliService: {
    createFromCli: jest.fn(),
  },
}))

import { POST } from '@/app/api/tasks/route'
import { verifyBearer } from '@/lib/auth/bearer'
import { taskCliService } from '@/lib/services/task-cli.service'

const mockVerify = verifyBearer as jest.Mock
const mockCreate = taskCliService.createFromCli as jest.Mock

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://x/api/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer lum_test',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

const IDENTITY = {
  user: { id: 'clerk-1' },
  workspace: { id: 'ws-1', slug: 'lumo', name: 'Lumo' },
  apiKey: { id: 'k-1', name: 'CLI', prefix: 'lum_test' },
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/tasks', () => {
  it('returns 401 when bearer is missing or invalid', async () => {
    mockVerify.mockResolvedValue(null)
    const res = await POST(makeRequest({ title: 'Hi' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when body fails zod validation', async () => {
    mockVerify.mockResolvedValue(IDENTITY)
    const res = await POST(makeRequest({ title: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 201 with task identifier and URL on success', async () => {
    mockVerify.mockResolvedValue(IDENTITY)
    mockCreate.mockResolvedValue({
      id: 'task-1',
      identifier: 'LUM-44',
      title: 'Hi',
      url: 'https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44',
    })

    const res = await POST(makeRequest({ title: 'Hi' }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.task).toEqual({
      id: 'task-1',
      identifier: 'LUM-44',
      title: 'Hi',
      url: 'https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44',
    })
    expect(mockCreate).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk-1',
      input: expect.objectContaining({ title: 'Hi', priority: 'LOW' }),
    })
  })

  it('maps service errors with status to that status', async () => {
    mockVerify.mockResolvedValue(IDENTITY)
    mockCreate.mockRejectedValue(
      Object.assign(new Error('no project matches "foo"'), { status: 400 })
    )

    const res = await POST(makeRequest({ title: 'Hi', projectRef: 'foo' }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('no project matches "foo"')
  })

  it('maps thrown errors without status to 500 and hides the message', async () => {
    mockVerify.mockResolvedValue(IDENTITY)
    mockCreate.mockRejectedValue(new Error('db blew up'))

    const res = await POST(makeRequest({ title: 'Hi' }))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Internal Server Error')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api-tasks-create.test.ts`
Expected: FAIL — `app/api/tasks/route` not found.

- [ ] **Step 3: Implement the route**

Create `app/api/tasks/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { cliCreateTaskSchema } from '@/lib/validation/schemas'
import { taskCliService } from '@/lib/services/task-cli.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * POST /api/tasks
 *
 * Bearer-authed CLI endpoint for `lumo task create`. Accepts human-friendly
 * refs (project name/slug, member email/name) and returns the created
 * task's identifier + URL. Web callers use POST /api/projects/[id]/tasks
 * instead.
 */
export async function POST(request: Request): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = cliCreateTaskSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  try {
    const task = await taskCliService.createFromCli({
      workspaceId: identity.workspace.id,
      workspaceSlug: identity.workspace.slug,
      callerClerkId: identity.user.id,
      input: parsed.data,
    })
    return NextResponse.json({ task }, { status: 201 })
  } catch (err) {
    const status =
      err instanceof Error && 'status' in err
        ? (err as Error & { status: number }).status
        : 500
    const message =
      status === 500 ? 'Internal Server Error' : (err as Error).message
    if (status === 500) {
      console.error('POST /api/tasks error:', err)
    }
    return NextResponse.json({ error: message }, { status })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api-tasks-create.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check the new route**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/tasks/route.ts __tests__/api-tasks-create.test.ts
git commit -m "feat: POST /api/tasks Bearer-auth endpoint for CLI [LUM-43]"
```

---

### Task 5: Add CLI command (cli/src/commands/task-create.ts) + formatter tests

The command splits into two pieces:

- `formatCreatedTaskLine` / `formatErrorMessage` — pure functions, unit-testable
- `taskCreate(...)` — flag parsing + HTTP, exercised manually

**Files:**

- Create: `cli/src/commands/task-create.ts`
- Test: `__tests__/cli/task-create-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/task-create-format.test.ts`:

```ts
/**
 * @jest-environment node
 */
import {
  formatCreatedTaskLine,
  normalizePriority,
} from '@/cli/src/commands/task-create'

describe('formatCreatedTaskLine', () => {
  it('renders identifier, quoted title, and URL on one line', () => {
    const line = formatCreatedTaskLine({
      id: 'task-1',
      identifier: 'LUM-44',
      title: 'Add OAuth login',
      url: 'https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44',
    })
    expect(line).toBe(
      'Created LUM-44 "Add OAuth login"  https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44'
    )
  })

  it('escapes embedded double-quotes in the title', () => {
    const line = formatCreatedTaskLine({
      id: 'task-2',
      identifier: 'LUM-45',
      title: 'Add "OAuth" login',
      url: 'https://x/y',
    })
    expect(line).toContain('"Add \\"OAuth\\" login"')
  })
})

describe('normalizePriority', () => {
  it('uppercases valid values', () => {
    expect(normalizePriority('low')).toBe('LOW')
    expect(normalizePriority('MEDIUM')).toBe('MEDIUM')
    expect(normalizePriority('High')).toBe('HIGH')
    expect(normalizePriority('urgent')).toBe('URGENT')
  })

  it('returns null on invalid input (caller formats the error)', () => {
    expect(normalizePriority('p1')).toBeNull()
    expect(normalizePriority('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/task-create-format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the command**

Create `cli/src/commands/task-create.ts`:

```ts
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'

const ALLOWED_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
type Priority = (typeof ALLOWED_PRIORITIES)[number]

export interface CreateTaskOptions {
  description?: string
  priority?: string
  assignee?: string
  project?: string
}

interface CreatedTaskResponse {
  task: {
    id: string
    identifier: string
    title: string
    url: string
  }
}

/**
 * Uppercase + validate a priority string. Returns null on unknown values so
 * the caller can print a context-aware error.
 */
export function normalizePriority(value: string): Priority | null {
  if (!value) return null
  const upper = value.toUpperCase()
  return (ALLOWED_PRIORITIES as readonly string[]).includes(upper)
    ? (upper as Priority)
    : null
}

/**
 * Format the single-line success output. Title is double-quoted; embedded
 * double-quotes are backslash-escaped so the output stays parseable as one
 * shell-safe token group.
 */
export function formatCreatedTaskLine(task: {
  id: string
  identifier: string
  title: string
  url: string
}): string {
  const escapedTitle = task.title.replace(/"/g, '\\"')
  return `Created ${task.identifier} "${escapedTitle}"  ${task.url}`
}

export async function taskCreate(
  title: string | undefined,
  opts: CreateTaskOptions
): Promise<number | void> {
  if (!title || title.trim().length === 0) {
    console.error(
      'Error: missing <title>. Usage: lumo task create <title> [options]'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  // Priority: default LOW, validate if provided
  let priority: Priority = 'LOW'
  if (opts.priority !== undefined) {
    const normalized = normalizePriority(opts.priority)
    if (!normalized) {
      console.error(
        `Error: invalid priority "${opts.priority}". Allowed: low, medium, high, urgent`
      )
      return 1
    }
    priority = normalized
  }

  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks`

  const body: Record<string, unknown> = {
    title: title.trim(),
    priority,
  }
  if (opts.description !== undefined) body.description = opts.description
  if (opts.project !== undefined) body.projectRef = opts.project
  if (opts.assignee !== undefined) body.assigneeRef = opts.assignee

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }

  if (res.status === 201) {
    const data = (await res.json()) as CreatedTaskResponse
    process.stdout.write(formatCreatedTaskLine(data.task) + '\n')
    return
  }

  // Surface server error message when present, otherwise the status
  let serverMsg: string | null = null
  try {
    const errBody = (await res.json()) as { error?: string }
    if (typeof errBody.error === 'string') serverMsg = errBody.error
  } catch {
    // Body wasn't JSON; fall through to status-only message
  }
  if (serverMsg) {
    console.error(`Error: ${serverMsg}`)
  } else {
    console.error(`Error: task create failed (HTTP ${res.status})`)
  }
  return 1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/task-create-format.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Build the CLI to catch any TypeScript errors**

Run: `cd cli && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/task-create.ts __tests__/cli/task-create-format.test.ts
git commit -m "feat: cli task-create command + output formatter [LUM-43]"
```

---

### Task 6: Register `task create` subcommand and verify end-to-end

**Files:**

- Modify: `cli/src/index.ts`

- [ ] **Step 1: Add the import**

In `cli/src/index.ts`, after the existing `import { taskContext } ...` line (around line 9), add:

```ts
import { taskCreate } from './commands/task-create'
```

- [ ] **Step 2: Register the subcommand**

In `cli/src/index.ts`, immediately after the existing `task.command('context <identifier>')...` block (ends around line 77), append:

```ts
task
  .command('create <title>')
  .description(
    'Create a task. --project required when workspace has >1 project; defaults: priority=low, assignee=me.'
  )
  .option('-d, --description <text>', 'Task description')
  .option(
    '-p, --priority <level>',
    'Priority: low | medium | high | urgent (default: low)'
  )
  .option('-a, --assignee <ref>', 'Assignee email, name, or "me" (default: me)')
  .option('--project <ref>', 'Project name or slug')
  .action(
    wrap((title, options) =>
      taskCreate(title as string, options as Record<string, string>)
    )
  )
```

- [ ] **Step 3: Rebuild the CLI**

Run: `cd cli && npm run build && cd ..`
Expected: clean build, `cli/dist/commands/task-create.js` exists.

- [ ] **Step 4: Smoke-test the help text**

Run: `lumo task create --help`
Expected: prints the usage block with all four options.

- [ ] **Step 5: Smoke-test missing title**

Run: `lumo task create`
Expected: exit 1, stderr `Error: missing <title>. Usage: lumo task create <title> [options]`.

- [ ] **Step 6: Smoke-test invalid priority**

Run: `lumo task create "smoke" --priority p1`
Expected: exit 1, stderr `Error: invalid priority "p1". Allowed: low, medium, high, urgent`.

- [ ] **Step 7: Smoke-test the happy path against a running dev server**

Make sure the Next.js dev server is up (`npm run dev` if it isn't already). Then:

```bash
lumo task create "[smoke] CLI create works" --priority low
```

Expected: stdout one line `Created LUM-N "[smoke] CLI create works"  <url>`, exit 0. Open the URL to verify the task exists.

- [ ] **Step 8: Smoke-test multi-project error path** (only if your workspace has >1 project; otherwise skip)

```bash
lumo task create "[smoke] needs project"
```

Expected: exit 1, stderr `Error: Workspace has multiple projects. Use --project <name>.\nAvailable: <list>`.

- [ ] **Step 9: Smoke-test --project + --assignee**

```bash
lumo task create "[smoke] explicit refs" --project lumo --assignee me
```

Expected: success, task assigned to you.

- [ ] **Step 10: Commit**

```bash
git add cli/src/index.ts cli/dist
git commit -m "feat: register \`lumo task create\` subcommand [LUM-43]"
```

(If the project's `.gitignore` excludes `cli/dist`, drop that path from the `git add` line.)

- [ ] **Step 11: Final verification — full test suite + type check**

Run: `npx jest && npx tsc --noEmit`
Expected: all green.

---

## Self-Review Notes

- **Spec coverage:** Every spec section maps to a task — schema (T1), member resolution helper (T2), resolution + create service (T3), HTTP route (T4), CLI command + formatter (T5), CLI registration + smoke (T6). The error table from the spec is exercised across T3 (service errors), T4 (route mapping), T5 (CLI mapping + offline errors).
- **No placeholders:** every code step contains complete code; no "add error handling" placeholders.
- **Type consistency:** `findAllWithProfilesForCli` shape (`memberId / clerkId / actorId / email / displayName`) is identical in T2 and T3. `createFromCli` arg/return shapes match between T3 and T4.
- **Mocking strategy:** uses the same Jest patterns established by `member.repository.test.ts` and `api-lumo-sync.test.ts`. No new test infrastructure needed.
- **Out-of-scope deferrals:** `--parent`, `--sprint`, `--due-date`, `--repository`, and `--status` are not in v1 per the spec's non-goals; the new schema simply omits them and they default server-side.
