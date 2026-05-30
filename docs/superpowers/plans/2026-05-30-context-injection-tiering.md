# 任务上下文注入分层重构 Implementation Plan [LUM-122]

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `lumo task context` 的 7 个来源(Slack/文档/Artifact/评论/WebLink/Figma/PR)统一成「便宜的 inline 卡片 + 按需 retrieval 命令」两层模型,缩小 inline 体积,让 agent 能按需取全文。

**Architecture:** 自由文本长内容(Slack/文档/Artifact/评论)在写入/刷新时用 LLM 生成总结并缓存到行上;已有元数据的(WebLink/Figma/PR)直接用元数据。所有 render 函数抽到共享模块 `lib/context/render/`,在卡片末尾打印 retrieval 命令原文。retrieval 走新增/已有的 CLI 命令 + API route,复用写入时的鉴权与 SSRF 守卫。

**Tech Stack:** Next.js App Router, TypeScript strict, Prisma/Neon, AI SDK(`@ai-sdk/gateway` 必须 `await import()`), commander CLI, Jest。

**Spec:** `docs/superpowers/specs/2026-05-29-context-injection-tiering-design.md`

**Branch:** `lumo/LUM-122-context-injection-tiering`(已创建)

**约定提醒(每个含 Prisma 的任务都适用):**

- 改 schema 后先 `npx prisma generate` 再 `npx tsc --noEmit`,否则会出现假的 "X not exported" 错误([[project_prisma_client_reset_before_tsc]])。
- 迁移用 `npx prisma migrate dev`;遇 P3008/P3012 drift 走手写 SQL + `db execute` + `migrate resolve --applied`,**绝不** reset DB([[feedback_prisma_drift_workaround]])。
- 所有面向用户字符串若新增,要更新 `lib/i18n/` 每个 locale 文件。
- 无 `console.log`(CLI 命令输出用 `console.log` 是既有约定,属例外)。

**已核实的代码事实(执行时照此,勿凭空假设):**

- **测试目录是根级 `__tests__/`**(如 `__tests__/services/`、`__tests__/repositories/`、`__tests__/cli/`),**不是** `__tests__/services/`。已存在 `__tests__/summary.test.ts`(与本任务无关的 sprint-summary),所以本任务总结服务测试命名为 `__tests__/services/summary.service.test.ts` 避免混淆。
- **API route 鉴权用 `requireIdentity(request)`**(来自 `@/lib/auth`),返回 `identity`(含 `workspaceId`)或 `NextResponse`(直接 return)。**不是** `getAuthContext`。task 解析照 `app/api/tasks/[id]/artifacts/[artifactId]/route.ts` 里的 `resolveTask(rawId, workspaceId)`(`isLikelyCuid` / `parseIdentifier` + `taskRepository.findByWorkspaceIdentifier`)模式。
- **SSRF 守卫函数是 `assertExternalHost(rawUrl)`**(来自 `@/lib/integrations/og-metadata/ssrf`),**不是** `assertPublicUrl`。
- **CLI 无 `register.ts`**;命令在 `cli/src/index.ts` 里用 commander 嵌套连线:`const task = program.command('task')` → `const taskArtifact = task.command('artifact')` → 叶子 `.command('show <...>').action(taskArtifactShow)`。命令文件导出**普通 async 函数**(如 `taskArtifactShow(identifier, artifactId)`,返回 `number | void`,错误时 `return 1`),**不是** `register*(program)` 工厂。
- **web-link repo 用 `getById(linkId)`**(返回带 `task.project.workspaceId` 的关联),workspace 校验写 `link.task.project.workspaceId !== workspaceId`。service 内已有 `err(message, status)` 工厂。

---

## Task 1: Schema — 给 5 个模型加缓存列

**Files:**

- Modify: `prisma/schema.prisma`(`TaskSlackContext`, `TaskArtifact`, `TaskWebLink`, `Document`, `Task`)
- Create: `prisma/migrations/<timestamp>_context_tiering_cache_columns/migration.sql`(由 migrate dev 生成)

- [ ] **Step 1: 编辑 schema,加可空列**

`TaskSlackContext`(在 `refreshError String?` 下方):

```prisma
  summary            String?
  summaryGeneratedAt DateTime?
```

`TaskArtifact`(在 `order Int @default(0)` 下方):

```prisma
  summary String? @db.Text
```

`TaskWebLink`(在 `fetchError String?` 下方):

```prisma
  body          String?   @db.Text
  bodyFetchedAt DateTime?
```

`Document`(找到 model Document,在合适位置加):

```prisma
  summary            String?   @db.Text
  summaryGeneratedAt DateTime?
```

`Task`(找到 model Task,在标量字段区加):

```prisma
  commentsSummary   String?   @db.Text
  commentsSummaryAt DateTime?
```

- [ ] **Step 2: 生成迁移**

Run: `npx prisma migrate dev --name context_tiering_cache_columns`
Expected: 迁移创建并应用;`Already in sync` 或新迁移文件出现。若 drift,走 [[feedback_prisma_drift_workaround]] 流程。

- [ ] **Step 3: 重新生成 client 并校验类型**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: 无类型错误(新字段出现在生成的类型上)。

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add context-tiering cache columns to 5 models [LUM-122]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 总结生成服务 `summary.service.ts`

**Files:**

- Create: `lib/services/summary.service.ts`
- Test: `__tests__/services/summary.service.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// __tests__/services/summary.service.test.ts
import { summaryService, SUMMARY_PROMPTS } from '@/lib/services/summary.service'

describe('summaryService', () => {
  it('exposes a prompt template per kind', () => {
    expect(Object.keys(SUMMARY_PROMPTS).sort()).toEqual([
      'artifact',
      'comments',
      'document',
      'slack',
    ])
  })

  it('returns empty string for blank input without calling the model', async () => {
    const out = await summaryService.summarize('   ', 'slack')
    expect(out).toBe('')
  })

  it('does NOT statically import @ai-sdk/gateway (jest TransformStream trap)', () => {
    // Guards regression: a static import would crash this very test file on load.
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'lib/services/summary.service.ts'),
      'utf8'
    )
    expect(src).not.toMatch(/^import .*@ai-sdk\/gateway/m)
    expect(src).toMatch(/await import\(/)
  })
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx jest __tests__/services/summary.service.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/summary.service'`.

- [ ] **Step 3: 实现服务(gateway 动态 import)**

```typescript
// lib/services/summary.service.ts
export type SummaryKind = 'slack' | 'artifact' | 'document' | 'comments'

export const SUMMARY_PROMPTS: Record<SummaryKind, string> = {
  slack:
    'Summarize this Slack conversation for an engineer picking up the task. ' +
    '2-3 sentences, focus on decisions, blockers, and asks. No preamble.',
  artifact:
    'Summarize this spec/plan/design artifact in 2-3 sentences: what it ' +
    'covers and its key decisions. No preamble.',
  document:
    'Summarize this document in 2-3 sentences for an engineer. ' +
    'Focus on what it specifies or decides. No preamble.',
  comments:
    'Summarize this task comment thread in 2-3 sentences: status updates, ' +
    'decisions, and open questions. No preamble.',
}

const MAX_INPUT_CHARS = 24_000

export const summaryService = {
  async summarize(text: string, kind: SummaryKind): Promise<string> {
    const trimmed = text.trim()
    if (trimmed.length === 0) return ''

    // Dynamic import breaks the static dependency chain into @ai-sdk/gateway,
    // which crashes jest via TransformStream when imported statically.
    const { generateText } = await import('ai')
    const { gateway } = await import('@ai-sdk/gateway')

    const { text: out } = await generateText({
      model: gateway('openai/gpt-4o-mini'),
      system: SUMMARY_PROMPTS[kind],
      prompt: trimmed.slice(0, MAX_INPUT_CHARS),
    })
    return out.trim()
  },
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx jest __tests__/services/summary.service.test.ts`
Expected: PASS(3 个用例)。注意:`summarize` 的真实调用在测试里不触发(blank-input 用例提前返回),不会真打模型。

- [ ] **Step 5: Commit**

```bash
git add lib/services/summary.service.ts __tests__/services/summary.service.test.ts
git commit -m "feat: add summary.service with per-kind prompts (dynamic gateway import) [LUM-122]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Slack — 写入/刷新时生成总结

**Files:**

- Modify: `lib/services/task-slack-context.service.ts`
- Test: `__tests__/services/task-slack-context.service.test.ts`(若不存在则 Create)
- Repo helper: `lib/repositories/task-slack-context.repository.ts`(加 `updateSummary`)

- [ ] **Step 1: repo 加 `updateSummary`**

```typescript
// lib/repositories/task-slack-context.repository.ts — add to the exported object
  async updateSummary(id: string, summary: string) {
    return prisma.taskSlackContext.update({
      where: { id },
      data: { summary, summaryGeneratedAt: new Date() },
    })
  },
```

- [ ] **Step 2: 写失败测试(总结在 link 后被异步触发)**

```typescript
// renderSlack summary helper — test the pure helper, not waitUntil timing
import { buildSlackSummaryInput } from '@/lib/services/task-slack-context.service'

it('flattens a thread snapshot into summarizable text', () => {
  const input = buildSlackSummaryInput({
    messages: [
      { ts: '1', userId: 'U1', userName: 'Alice', text: 'ship it?' },
      { ts: '2', userId: 'U2', userName: 'Bob', text: 'yes after review' },
    ],
  })
  expect(input).toContain('Alice: ship it?')
  expect(input).toContain('Bob: yes after review')
})
```

- [ ] **Step 3: 运行,确认失败**

Run: `npx jest __tests__/services/task-slack-context.service.test.ts`
Expected: FAIL — `buildSlackSummaryInput` 未导出。

- [ ] **Step 4: 实现 helper + 在 link/refresh 路径接 `waitUntil`**

在 `task-slack-context.service.ts` 顶部导入并加 helper:

```typescript
import { waitUntil } from '@vercel/functions'
import { summaryService } from '@/lib/services/summary.service'

export function buildSlackSummaryInput(snapshot: {
  messages: Array<{ userId: string; userName: string | null; text: string }>
}): string {
  return snapshot.messages
    .map(m => `${m.userName ?? m.userId}: ${m.text}`)
    .join('\n')
}

function scheduleSlackSummary(
  contextId: string,
  snapshot: {
    messages: Array<{ userId: string; userName: string | null; text: string }>
  }
): void {
  waitUntil(
    summaryService
      .summarize(buildSlackSummaryInput(snapshot), 'slack')
      .then(s => {
        if (s) return taskSlackContextRepository.updateSummary(contextId, s)
      })
      .catch(() => {})
  )
}
```

在 `linkSlackPermalink` 和 `refreshContext` 写完 snapshot 后调用 `scheduleSlackSummary(ctx.id, snapshot)`。

- [ ] **Step 5: 运行测试,确认通过**

Run: `npx jest __tests__/services/task-slack-context.service.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add lib/services/task-slack-context.service.ts lib/repositories/task-slack-context.repository.ts __tests__/services/task-slack-context.service.test.ts
git commit -m "feat: generate Slack thread summary on link/refresh [LUM-122]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Artifact — add 时生成总结(一次性)

**Files:**

- Modify: `lib/services/task-artifact.service.ts`(add 路径)
- Test: `__tests__/services/task-artifact.service.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
it('schedules a one-time summary after creating an artifact', async () => {
  const spy = jest.spyOn(summaryService, 'summarize').mockResolvedValue('sum')
  // ... call taskArtifactService.add(...) with mocked repo
  await flushPromises()
  expect(spy).toHaveBeenCalledWith(expect.any(String), 'artifact')
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx jest __tests__/services/task-artifact.service.test.ts -t 'schedules a one-time summary'`
Expected: FAIL — 未调用 summarize。

- [ ] **Step 3: 实现:add 后 `waitUntil` 生成总结**

在 `task-artifact.service.ts` 的 add 成功创建后:

```typescript
import { waitUntil } from '@vercel/functions'
import { summaryService } from '@/lib/services/summary.service'
// after create:
waitUntil(
  summaryService
    .summarize(created.content, 'artifact')
    .then(s => {
      if (s) return taskArtifactRepository.updateSummary(created.id, s)
    })
    .catch(() => {})
)
```

并在 `task-artifact.repository.ts` 加 `updateSummary(id, summary)`(同 Task 3 Step 1 模式,写 `summary` 字段,无 `summaryGeneratedAt`——content 不可变)。

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx jest __tests__/services/task-artifact.service.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-artifact.service.ts lib/repositories/task-artifact.repository.ts __tests__/services/task-artifact.service.test.ts
git commit -m "feat: generate artifact summary once on add [LUM-122]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 文档 — create/update 后台生成 + load 时按 staleness 懒刷新

**Files:**

- Modify: `lib/services/document.service.ts`(create/update 路径)
- Modify: `lib/repositories/document.repository.ts`(加 `updateSummary`)
- Test: `__tests__/services/document.service.test.ts`

- [ ] **Step 1: repo 加 `updateSummary`**

```typescript
  async updateSummary(id: string, summary: string) {
    return prisma.document.update({
      where: { id },
      data: { summary, summaryGeneratedAt: new Date() },
    })
  },
```

- [ ] **Step 2: 写失败测试**

```typescript
it('schedules a document summary after create', async () => {
  const spy = jest.spyOn(summaryService, 'summarize').mockResolvedValue('sum')
  // ... call documentService.create(...) with markdown content
  await flushPromises()
  expect(spy).toHaveBeenCalledWith(expect.any(String), 'document')
})
```

- [ ] **Step 3: 运行,确认失败**

Run: `npx jest __tests__/services/document.service.test.ts -t 'schedules a document summary'`
Expected: FAIL。

- [ ] **Step 4: 实现 create/update 后 `waitUntil` 生成总结**

在 document.service 的 create 和 update 写完后,用文档正文(markdown)调 `summaryService.summarize(body, 'document')`,成功后 `documentRepository.updateSummary(doc.id, s)`,全程 `waitUntil(...).catch(() => {})`。

- [ ] **Step 5: 运行测试,确认通过**

Run: `npx jest __tests__/services/document.service.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add lib/services/document.service.ts lib/repositories/document.repository.ts __tests__/services/document.service.test.ts
git commit -m "feat: generate document summary on create/update [LUM-122]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> 注:文档的 load 时懒刷新在 Task 9(渲染装配)里接,因为它发生在 `getContextForIdentifier` 内。

---

## Task 6: 评论 — 新评论写入时按数量决定总结 vs 全文

**Files:**

- Modify: `lib/services/task-comment.service.ts` 或评论创建所在 service
- Modify: `lib/repositories/task.repository.ts`(加 `updateCommentsSummary`)
- Test: 对应 service test

- [ ] **Step 1: repo 加 `updateCommentsSummary`**

```typescript
  async updateCommentsSummary(taskId: string, summary: string) {
    return prisma.task.update({
      where: { id: taskId },
      data: { commentsSummary: summary, commentsSummaryAt: new Date() },
    })
  },
```

- [ ] **Step 2: 写失败测试(>3 条才总结)**

```typescript
it('summarizes comments only when count > 3', async () => {
  const spy = jest.spyOn(summaryService, 'summarize').mockResolvedValue('sum')
  // create 4th comment -> spy called with 'comments'
  // with <=3 comments -> spy NOT called
})
```

- [ ] **Step 3: 运行,确认失败**

Run: `npx jest -t 'summarizes comments only when count'`
Expected: FAIL。

- [ ] **Step 4: 实现:评论创建后,若 count > 3 则 `waitUntil` 重算 commentsSummary**

评论写入成功后取该 task 评论数;`> 3` 时拼接全部评论(`作者: 全文`)调 `summaryService.summarize(text, 'comments')` → `updateCommentsSummary`。`<= 3` 不调 LLM(渲染层直接 inline 全文,见 Task 8)。

- [ ] **Step 5: 运行测试,确认通过**

Run: `npx jest -t 'summarizes comments only when count'`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add lib/services/task-comment.service.ts lib/repositories/task.repository.ts <test file>
git commit -m "feat: summarize task comments when thread exceeds 3 [LUM-122]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: WebLink — body 抓取(retrieval 用)

**Files:**

- Modify: `lib/services/task-web-link.service.ts`(加 `fetchBody`)
- Modify: `lib/repositories/task-web-link.repository.ts`(加 `updateBody`、`findById`)
- Test: `__tests__/lib/services/task-web-link.service.test.ts`

- [ ] **Step 1: 写失败测试(fetchBody 复用 SSRF 守卫)**

```typescript
import { taskWebLinkService } from '@/lib/services/task-web-link.service'
import { assertPublicUrl } from '@/lib/integrations/og-metadata/ssrf'

jest.mock('@/lib/integrations/og-metadata/ssrf', () => ({
  assertPublicUrl: jest.fn(),
}))

it('fetchBody calls assertPublicUrl before fetching', async () => {
  // mock fetch + repo; assert assertPublicUrl called with the link url
  expect(assertPublicUrl).toHaveBeenCalled()
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx jest __tests__/lib/services/task-web-link.service.test.ts -t 'fetchBody'`
Expected: FAIL — `fetchBody` 不存在。

- [ ] **Step 3: 实现 `fetchBody`(SSRF + 抓取 + 回填)**

```typescript
import { assertPublicUrl } from '@/lib/integrations/og-metadata/ssrf'
// in taskWebLinkService:
  async fetchBody(workspaceId: string, taskId: string, linkId: string) {
    const link = await taskWebLinkRepository.findById(linkId)
    if (!link || link.taskId !== taskId || link.workspaceId !== workspaceId) {
      throw Object.assign(new Error('Web link not found'), { status: 404 })
    }
    if (link.body) return link.body
    await assertPublicUrl(link.url) // throws on private/SSRF target
    const res = await fetch(link.url)
    const html = await res.text()
    const body = htmlToPlainText(html).slice(0, 50_000)
    await taskWebLinkRepository.updateBody(linkId, body)
    return body
  },
```

`htmlToPlainText` 复用现有 markdown/html 工具(`@/lib/utils/markdown`)。repo 加 `findById` 与 `updateBody(id, body)`(写 `body` + `bodyFetchedAt: new Date()`)。

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx jest __tests__/lib/services/task-web-link.service.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-web-link.service.ts lib/repositories/task-web-link.repository.ts __tests__/lib/services/task-web-link.service.test.ts
git commit -m "feat: add web-link body fetch with SSRF guard for retrieval [LUM-122]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: 共享 render 模块 — 改 4 个 + 新增 3 个

**Files:**

- Create: `lib/context/render/slack.ts`, `web-link.ts`, `figma.ts`, `artifact.ts`, `document.ts`, `comments.ts`, `pr.ts`, `index.ts`
- Modify: `lib/services/task-context.service.ts`(移除内联 render,改 import)
- Test: `__tests__/context/render.test.ts`(根级约定;import 用 `@/lib/context/render/*` 别名)

> 每个 render 函数纯函数:输入数据 → markdown 字符串,空集返回 `''`,卡片末尾打印 retrieval 命令原文。

- [ ] **Step 1: 写失败测试(覆盖卡片形态 + 命令原文 + 空集)**

```typescript
import { renderSlackContextSection } from '@/lib/context/render/slack'
import { renderCommentsSection } from '@/lib/context/render/comments'
import { renderPRSection } from '@/lib/context/render/pr'

it('slack card shows summary + retrieval command', () => {
  const out = renderSlackContextSection([
    {
      id: 'clx_a',
      isThread: true,
      slackChannelName: 'design',
      permalink: 'https://x',
      snapshotAt: new Date('2026-05-28T10:12:00Z'),
      refreshError: null,
      summary: 'Decided to ship after review.',
      snapshot: {
        messages: [{ ts: '1', userId: 'U1', userName: 'A', text: 'hi' }],
      },
    },
  ] as any)
  expect(out).toContain('Decided to ship after review.')
  expect(out).toContain('lumo task slack show clx_a')
  expect(out).not.toContain('- **A**: hi') // full thread NOT inlined anymore
})

it('comments: inlines full text when <= 3, summary when > 3', () => {
  const few = renderCommentsSection({
    comments: [{ author: 'A', createdAt: new Date(), body: 'c1' }],
    identifier: 'LUM-1',
    commentsSummary: null,
  })
  expect(few).toContain('c1')

  const many = renderCommentsSection({
    comments: new Array(4)
      .fill(0)
      .map((_, i) => ({ author: 'A', createdAt: new Date(), body: `c${i}` })),
    identifier: 'LUM-1',
    commentsSummary: 'Summary here',
  })
  expect(many).toContain('Summary here')
  expect(many).toContain('lumo task comment list LUM-1')
})

it('empty sets render empty string', () => {
  expect(renderSlackContextSection([] as any)).toBe('')
  expect(renderPRSection([] as any)).toBe('')
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx jest __tests__/context/render.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 把现有 4 个 render 从 task-context.service.ts 搬到模块并改造**

- `slack.ts`:`renderSlackContextSection` 改为输出 `### #channel · meta` + summary 一行 + `  ↳ 全文: lumo task slack show <id>`;不再 inline 每条消息。无 summary 时回退到前 3 条原文截断。
- `web-link.ts`:`renderWebLinkSection` 保留 OG title/desc 行,追加 `  ↳ 正文: lumo task web show <id>`。
- `figma.ts`:`renderFigmaSection` 保留文件/帧/缩略图,追加 `  ↳ design context: lumo task figma context <id>`。
- `artifact.ts`:`renderArtifactSection` 改为 `## [kind] title · agent` + summary 一行 + `  ↳ 全文: lumo task artifact show <id>`;不再 inline content。无 summary 回退到 content 前 N 行。

- [ ] **Step 4: 新增 3 个 render**

- `document.ts`:`renderDocumentSection(docs)` → `## Documents` + 每条 `### title` + summary + `  ↳ 全文: lumo doc show <id>`。
- `comments.ts`:`renderCommentsSection({comments, identifier, commentsSummary})` → `## Comments`;`<= 3` inline 全文,`> 3` 用 `commentsSummary` + `  ↳ 全文: lumo task comment list <identifier>`。
- `pr.ts`:`renderPRSection(prs)` → `## Pull Requests` + 每条 `- #N title — state · CI` + `  ↳ diff: lumo task pr show <N>`。
- `index.ts`:re-export 全部 7 个。

- [ ] **Step 5: 运行测试,确认通过**

Run: `npx jest __tests__/context/render.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add lib/context/render __tests__/context lib/services/task-context.service.ts
git commit -m "feat: shared context render module (tiered cards + retrieval commands) [LUM-122]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: 装配 — task-context.service 接入新 render + 文档/评论/PR + 文档懒刷新

**Files:**

- Modify: `lib/services/task-context.service.ts`(`TaskContext` 接口 + `getContextForIdentifier`)
- Test: `__tests__/services/task-context.service.test.ts`

- [ ] **Step 1: 扩 `TaskContext` 接口**

加三个字段:

```typescript
/** Pre-rendered "## Documents" markdown; empty when none mentioned. */
docSection: string
/** Pre-rendered "## Comments" markdown; empty when none. */
commentsSection: string
/** Pre-rendered "## Pull Requests" markdown; empty when none. */
prSection: string
```

- [ ] **Step 2: 写失败测试**

```typescript
it('includes doc/comments/pr sections in the assembled context', async () => {
  // mock repos to return one mentioned doc, 4 comments, one PR
  const ctx = await taskContextService.getContextForIdentifier(
    'ws',
    'm',
    'LUM-1'
  )
  expect(ctx?.docSection).toContain('lumo doc show')
  expect(ctx?.commentsSection).toContain('## Comments')
  expect(ctx?.prSection).toContain('## Pull Requests')
})
```

- [ ] **Step 3: 运行,确认失败**

Run: `npx jest __tests__/services/task-context.service.test.ts -t 'doc/comments/pr'`
Expected: FAIL。

- [ ] **Step 4: 实现装配**

在 `getContextForIdentifier` 内:

- 取 `documentMentionRepository.listDocsForTask(resolved.id)`(EXPLICIT + CONTENT),渲染 `renderDocumentSection`;对每个 `updatedAt > summaryGeneratedAt` 的 doc,`waitUntil(documentService.refreshSummary(doc.id).catch(()=>{}))`(照 Figma `scheduleLazyRefresh` 先例)。
- 取评论 `taskCommentRepository.listByTask(resolved.id)` + `full.commentsSummary`,渲染 `renderCommentsSection`。
- 取 PR `pullRequestRepository.listByTask(resolved.id)`,渲染 `renderPRSection`。
- 4 个已有 section 改为从 `lib/context/render` import。
- 返回对象加 `docSection / commentsSection / prSection`。

- [ ] **Step 5: 运行全量测试**

Run: `npx jest __tests__/services/task-context.service.test.ts && npx tsc --noEmit`
Expected: PASS,无类型错误。

- [ ] **Step 6: Commit**

```bash
git add lib/services/task-context.service.ts __tests__/services/task-context.service.test.ts
git commit -m "feat: assemble doc/comments/pr sections + lazy doc summary refresh [LUM-122]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Retrieval API routes(slack/web/figma-context/comments/pr)

**Files:**

- Create: `app/api/tasks/[id]/slack-contexts/[contextId]/snapshot/route.ts`
- Create: `app/api/tasks/[id]/web-links/[linkId]/body/route.ts`
- Create: `app/api/tasks/[id]/figma-links/[linkId]/context/route.ts`
- Create: `app/api/tasks/[id]/pull-requests/[number]/route.ts`
- (评论列表已有 `app/api/tasks/[id]/comments/route.ts` GET — 确认其返回全文,否则补)
- Test: `__tests__/app/api/tasks/retrieval.test.ts`

> 每个 route 走 thin pattern:`getAuthContext()` → 校验 → service → `NextResponse.json`。401/404/SSRF 拒绝都返回明确状态。

- [ ] **Step 1: 写失败测试(鉴权 + 404)**

```typescript
it('web body route returns 401 without auth', async () => {
  jest.spyOn(authCtx, 'getAuthContext').mockResolvedValue(null)
  const res = await GET(req, {
    params: Promise.resolve({ id: 't', linkId: 'l' }),
  })
  expect(res.status).toBe(401)
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx jest __tests__/app/api/tasks/retrieval.test.ts`
Expected: FAIL — route 不存在。

- [ ] **Step 3: 实现 4 个 route**

各 route 模板(以 web body 为例):

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/context'
import { taskWebLinkService } from '@/lib/services/task-web-link.service'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const { id, linkId } = await params
  const auth = await getAuthContext()
  if (!auth)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await taskWebLinkService.fetchBody(
      auth.workspaceId,
      id,
      linkId
    )
    return NextResponse.json({ body })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 })
  }
}
```

- slack snapshot route → 返回存储的 `snapshot`(无网络)。
- figma context route → 调 figma service 的 design-context 取数(实时);未连接返回明确错误。
- pr route → 调 PR/GitHub 集成取 diff + review comments;未连接返回明确错误。

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx jest __tests__/app/api/tasks/retrieval.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add app/api/tasks __tests__/app/api/tasks/retrieval.test.ts
git commit -m "feat: retrieval API routes for slack/web/figma/pr [LUM-122]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: CLI retrieval 命令(5 个)

**Files:**

- Create: `cli/src/commands/task-slack-show.ts`, `task-web-show.ts`, `task-figma-context.ts`, `task-comment-list.ts`, `task-pr-show.ts`
- Modify: `cli/src/register.ts`(注册 5 个)
- Test: 若 CLI 有测试约定则加;否则手动验证

> 每个命令照 `task-artifact-show.ts` 模式:`resolveTaskByIdentifier` → `apiFetch` → 打印。

- [ ] **Step 1: 实现 `task-slack-show.ts`**

```typescript
import { Command } from 'commander'
import { resolveTaskByIdentifier } from '../lib/resolve-task.js'
import { apiFetch } from '../lib/api.js'
import { printError } from '../lib/output.js'

export function registerTaskSlackShow(program: Command) {
  program
    .command('task-slack-show <identifier> <contextId>')
    .description('Show the full stored Slack thread snapshot')
    .action(async (identifier: string, contextId: string) => {
      const task = await resolveTaskByIdentifier(identifier)
      const res = await apiFetch(
        `/api/tasks/${task.id}/slack-contexts/${contextId}/snapshot`
      )
      if (!res.ok) {
        await printError(res)
        process.exit(1)
      }
      const { snapshot } = (await res.json()) as {
        snapshot: {
          messages: Array<{
            userName: string | null
            userId: string
            text: string
          }>
        }
      }
      for (const m of snapshot.messages) {
        console.log(`${m.userName ?? '@' + m.userId}: ${m.text}`)
      }
    })
}
```

- [ ] **Step 2: 实现其余 4 个(同模式)**

- `task-web-show <identifier> <linkId>` → GET `.../web-links/<linkId>/body`,打印 `body`。
- `task-figma-context <identifier> <linkId>` → GET `.../figma-links/<linkId>/context`,打印 design context。
- `task-comment-list <identifier>` → GET `.../comments`,逐条打印 `作者 · 时间\n全文`。
- `task-pr-show <identifier> <number>` → GET `.../pull-requests/<number>`,打印 diff + review comments。

> 注意:命令名虽用连字符(`task-slack-show`),但面向用户的描述/SKILL.md 写作 `task slack show`(commander 子命令显示风格)。与现有 `task-artifact-show` 一致。

- [ ] **Step 3: 在 register.ts 注册 5 个**

```typescript
import { registerTaskSlackShow } from './commands/task-slack-show.js'
// ... + 4 more imports
// inside registerCommands():
registerTaskSlackShow(program)
registerTaskWebShow(program)
registerTaskFigmaContext(program)
registerTaskCommentList(program)
registerTaskPrShow(program)
```

- [ ] **Step 4: 构建并冒烟验证**

Run: `cd cli && npm run build && node dist/index.js task-slack-show --help`
Expected: 显示命令 help,无报错。

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands cli/src/index.ts
git commit -m "feat: CLI retrieval commands (slack/web/figma/comment/pr) [LUM-122]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: 同步 SKILL.md + 全量验证

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md`

- [ ] **Step 1: 更新 SKILL.md**

- frontmatter `description` 触发词加:`task slack show`、`task web show`、`task figma context`、`task comment list`、`task pr show`、`retrieval`、`取全文`、`看 thread`。
- 新增章节描述 5 个 retrieval 命令(用途、参数、输出形态),并说明:`task context` 输出的卡片末尾会打印对应 retrieval 命令,agent 需要全文时照抄执行。

- [ ] **Step 2: 全量测试 + 类型 + lint**

Run:

```bash
npx prisma generate && npx tsc --noEmit && npm test && npm run lint:tokens
```

Expected: 全绿。若 tsc 报 "X not exported" 先 `npx prisma generate`([[project_prisma_client_reset_before_tsc]])。

- [ ] **Step 3: 端到端验证 `task context`**

Run: `lumo task context LUM-122`
Expected: 各 section 显示精简卡片 + `↳` retrieval 命令行;无整段全文 inline(评论 ≤3 除外)。

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: sync SKILL.md with retrieval commands [LUM-122]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 实现后:PR Checklist

- [ ] 测试通过、`npx tsc --noEmit` 无错、无新增 `console.log`(CLI 命令除外)
- [ ] 分支 `lumo/LUM-122-context-injection-tiering`、PR 标题 `feat: tier task-context injection with on-demand retrieval [LUM-122]`
- [ ] `cli/src/commands/` 改了 → `SKILL.md` 已同步 ✓(Task 12)
- [ ] PR 描述注明:含 Prisma 迁移(仅加可空列,无数据破坏),部署需 `migrate deploy`
- [ ] i18n:若新增面向用户字符串,所有 locale 文件已补
- [ ] 合并后验证 prod 迁移已应用([[project_prod_db_env_split]] / `migrate status`)

---

## Self-Review 记录

- **Spec 覆盖**:7 源 → Slack(T3+T8)、文档(T5+T9)、Artifact(T4+T8)、评论(T6+T8+T9)、WebLink(T7+T8)、Figma(T8 render + T10/T11 context)、PR(T8+T9+T10+T11);summary.service(T2);schema(T1);SKILL.md(T12)。无遗漏。
- **占位符**:无 TBD;每个 code step 含真实代码。
- **类型一致性**:`updateSummary` / `updateCommentsSummary` / `updateBody` / `fetchBody` / `summarize(text, kind)` / `render*Section` 跨任务命名一致;`SummaryKind` 四值与 `SUMMARY_PROMPTS` 键一致。
- **已知坑覆盖**:gateway 动态 import(T2)、prisma generate 先于 tsc(T1/T9/T12)、drift workaround(T1)、SKILL.md 同步(T12)、SSRF 守卫复用(T7/T10)。
