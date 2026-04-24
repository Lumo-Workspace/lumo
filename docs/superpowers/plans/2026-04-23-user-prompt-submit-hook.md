# UserPromptSubmit Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Claude Code 的第四种 hook `UserPromptSubmit` 接入 Lumo 现有的 settings.json → CLI → API → Prisma → Timeline 链路,在 Timeline 上以蓝色 "You" 行突出展示人类输入。

**Architecture:** 零新增服务/仓储层 —— `hookEventService` / `hookEventRepository` / `_handler.ts` 对 `HookEventType` 枚举已 generic。只需:(1) Prisma 枚举加值并迁移;(2) 新 API route 5 行委托;(3) CLI 加一种 `HookPath`;(4) merge-events 增加 `kind:'user-prompt'` 构建器 + `stripInjectedTags` 清洗工具;(5) Timeline.tsx 加蓝色 + "You" 标签;(6) settings.json 钩子注册。

**Tech Stack:** Next.js 14 App Router · TypeScript · Prisma(Postgres) · Jest · Tailwind · 现有 Lumo CLI(commander)

**Spec:** [docs/superpowers/specs/2026-04-23-user-prompt-submit-hook-design.md](../specs/2026-04-23-user-prompt-submit-hook-design.md)

**Branch:** `lumo/LUM-N-user-prompt-submit-hook`(已创建,spec 已提交于 `66f1f38`)

---

## Task 1: Prisma schema — add USER_PROMPT_SUBMIT enum value

**Files:**

- Modify: `prisma/schema.prisma` (HookEventType enum around line 1127)
- Create: `prisma/migrations/<timestamp>_add_user_prompt_submit_hook_event/migration.sql` (由 `prisma migrate` 生成)

- [ ] **Step 1: Edit schema to add enum value**

修改 `prisma/schema.prisma` 里的枚举(大约 line 1127):

```prisma
enum HookEventType {
  PRE_TOOL_USE
  POST_TOOL_USE
  STOP
  USER_PROMPT_SUBMIT
}
```

- [ ] **Step 2: Generate migration**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
npx prisma migrate dev --name add_user_prompt_submit_hook_event --create-only
```

Expected: 新目录 `prisma/migrations/<timestamp>_add_user_prompt_submit_hook_event/` 出现,内含 `migration.sql`。

- [ ] **Step 3: Verify migration SQL**

打开新生成的 `migration.sql`,确认内容就一行:

```sql
-- AlterEnum
ALTER TYPE "HookEventType" ADD VALUE 'USER_PROMPT_SUBMIT';
```

Postgres 限制:此语句不能在一个事务里和其他语句一起跑 —— 迁移文件里应该仅有这一条(或带必要注释)。如果 Prisma 额外塞了别的 DDL,停下来问人,不要手改迁移。

- [ ] **Step 4: Apply migration + regenerate client**

```bash
npx prisma migrate dev
```

Expected: migrate 输出 "Database is now in sync with your schema" 且 Prisma Client 重新生成。TypeScript 里 `HookEventType` 联合类型现在包含 `'USER_PROMPT_SUBMIT'`。

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: 无错误。(现有 `_handler.ts` / `hookEventService.ts` / `hookEventRepository.ts` 泛型传递,枚举加值不破坏它们。)

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(prisma): add USER_PROMPT_SUBMIT to HookEventType enum [LUM-N]"
```

---

## Task 2: `stripInjectedTags` helper — TDD

**Files:**

- Modify: `app/sessions/[id]/merge-events.ts` (新增私有 helper,紧邻既有 `clip` 函数)
- Modify: `__tests__/app/sessions/merge-events.test.ts` (新增 describe 块)

因为 `stripInjectedTags` 目前声明为私有函数,单测通过 `mergeEvents` 对含注入标签的 UserPromptSubmit 事件的行为来间接覆盖。不为私有函数单独导出 —— 保持既有封装风格(`clip`、`getString` 等都是私有)。

- [ ] **Step 1: 追加失败测试 — mergeEvents 正确清洗 system-reminder**

在 `__tests__/app/sessions/merge-events.test.ts` 文件末尾添加(放到最后一个 `it` 后、`})` 前面;`RawEvent` 已经从 `@/app/sessions/[id]/merge-events` 导入):

```typescript
it('extracts user-visible text from UserPromptSubmit prompt', () => {
  const result = mergeEvents([
    {
      id: 'u1',
      type: 'USER_PROMPT_SUBMIT',
      toolName: null,
      payload: {
        prompt: 'add oauth login\n<system-reminder>ignore me</system-reminder>',
      },
      createdAt: new Date('2026-04-23T09:00:00Z'),
    },
  ])
  expect(result).toHaveLength(1)
  expect(result[0]!.kind).toBe('user-prompt')
  expect(result[0]!.summary).toBe('add oauth login')
  const promptBlock = result[0]!.details.find(d => d.label === 'prompt')
  expect(promptBlock?.text).toBe('add oauth login')
  const raw = result[0]!.details.find(
    d => d.label === 'raw (with injected context)'
  )
  expect(raw?.text).toContain('<system-reminder>')
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
npm test -- --testPathPattern=merge-events.test
```

Expected: FAIL — 具体表现为 TypeScript 编译报错 `'USER_PROMPT_SUBMIT'` 不是 `HookEventType` 字面量联合的成员;或若当下 Jest 配置容忍类型,则断言失败(`kind` 不是 `'user-prompt'`)。

- [ ] **Step 3: 在 merge-events.ts 扩展类型声明**

编辑 `app/sessions/[id]/merge-events.ts`,修改顶部类型声明(约 line 10):

```typescript
export type HookEventType =
  | 'PRE_TOOL_USE'
  | 'POST_TOOL_USE'
  | 'STOP'
  | 'USER_PROMPT_SUBMIT'
```

并修改 `TimelineItem.kind` (约 line 33):

```typescript
export interface TimelineItem {
  key: string
  kind: 'tool' | 'stop' | 'orphan' | 'user-prompt'
  /** ...（其余字段保持不变）*/
}
```

- [ ] **Step 4: 添加 stripInjectedTags helper**

在 `app/sessions/[id]/merge-events.ts` 的 Helpers 区,紧贴 `function clip(`(约 line 464)之前插入:

```typescript
/**
 * Remove harness-injected sections from a user prompt so the Timeline
 * summary reflects what the human actually typed. The tags below are
 * appended by Claude Code hooks, slash commands, or SessionStart.
 */
function stripInjectedTags(s: string): string {
  return s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
}
```

- [ ] **Step 5: 添加 userPromptItem 构建器**

在 `app/sessions/[id]/merge-events.ts` 的 Item builders 区,`function stopItem(` 之前(约 line 84)插入:

```typescript
function userPromptItem(ev: RawEvent): TimelineItem {
  const rawPrompt = getString(ev.payload, 'prompt') ?? ''
  const cleaned = stripInjectedTags(rawPrompt).trim()

  const summary = cleaned ? clip(cleaned, 100) : '(empty prompt)'
  const details: DetailBlock[] = []
  if (cleaned) {
    details.push({ label: 'prompt', variant: 'text', text: cleaned })
  }
  if (rawPrompt && rawPrompt !== cleaned) {
    details.push({
      label: 'raw (with injected context)',
      variant: 'text',
      text: rawPrompt,
    })
  }

  return {
    key: ev.id,
    kind: 'user-prompt',
    toolName: null,
    summary,
    badge: null,
    status: 'ok',
    startAt: ev.createdAt,
    endAt: ev.createdAt,
    details,
  }
}
```

- [ ] **Step 6: 在 mergeEvents 主循环里分派 USER_PROMPT_SUBMIT**

在 `function mergeEvents(` 主循环里,在 `if (ev.type === 'STOP')` 分支之前(约 line 52)插入:

```typescript
if (ev.type === 'USER_PROMPT_SUBMIT') {
  items.push(userPromptItem(ev))
  continue
}
```

- [ ] **Step 7: 运行测试验证通过**

```bash
npm test -- --testPathPattern=merge-events.test
```

Expected: PASS, 包括 step 1 新加的那条 + 既有用例全部。

- [ ] **Step 8: 补更多 edge case 测试**

在同一个 describe 块内,紧随 step 1 测试之后追加:

```typescript
it('returns "(empty prompt)" when payload.prompt is missing', () => {
  const result = mergeEvents([
    {
      id: 'u2',
      type: 'USER_PROMPT_SUBMIT',
      toolName: null,
      payload: {},
      createdAt: new Date('2026-04-23T09:00:00Z'),
    },
  ])
  expect(result[0]!.summary).toBe('(empty prompt)')
  expect(result[0]!.details).toHaveLength(0)
})

it('omits raw detail block when nothing was stripped', () => {
  const result = mergeEvents([
    {
      id: 'u3',
      type: 'USER_PROMPT_SUBMIT',
      toolName: null,
      payload: { prompt: 'plain text, no tags' },
      createdAt: new Date('2026-04-23T09:00:00Z'),
    },
  ])
  expect(result[0]!.details).toHaveLength(1)
  expect(result[0]!.details[0]!.label).toBe('prompt')
})

it('strips command-name / command-message / command-args tags', () => {
  const result = mergeEvents([
    {
      id: 'u4',
      type: 'USER_PROMPT_SUBMIT',
      toolName: null,
      payload: {
        prompt:
          '<command-message>slash cmd</command-message><command-name>/foo</command-name><command-args>a\nb</command-args>run this',
      },
      createdAt: new Date('2026-04-23T09:00:00Z'),
    },
  ])
  expect(result[0]!.summary).toBe('run this')
})

it('clips summary to 100 chars but keeps full text in detail', () => {
  const longPrompt = 'x'.repeat(200)
  const result = mergeEvents([
    {
      id: 'u5',
      type: 'USER_PROMPT_SUBMIT',
      toolName: null,
      payload: { prompt: longPrompt },
      createdAt: new Date('2026-04-23T09:00:00Z'),
    },
  ])
  expect(result[0]!.summary.length).toBeLessThanOrEqual(100)
  expect(result[0]!.details[0]!.text.length).toBe(200)
})

it('sorts UserPromptSubmit into the timeline by createdAt', () => {
  const result = mergeEvents([
    {
      id: 'u6',
      type: 'USER_PROMPT_SUBMIT',
      toolName: null,
      payload: { prompt: 'hi' },
      createdAt: new Date('2026-04-23T09:00:00Z'),
    },
    stop('s1', 'done', '2026-04-23T09:00:02Z'),
    pre('p1', 'u1', 'Read', { file_path: '/a' }, '2026-04-23T09:00:01Z'),
    post(
      'q1',
      'u1',
      'Read',
      { file_path: '/a' },
      { file: { content: 'x' } },
      '2026-04-23T09:00:01.500Z'
    ),
  ])
  expect(result.map(r => r.kind)).toEqual(['user-prompt', 'tool', 'stop'])
})
```

- [ ] **Step 9: 运行完整测试套件**

```bash
npm test -- --testPathPattern=merge-events.test
```

Expected: PASS — 所有新旧用例均通过。

- [ ] **Step 10: Commit**

```bash
git add app/sessions/[id]/merge-events.ts __tests__/app/sessions/merge-events.test.ts
git commit -m "feat(timeline): render UserPromptSubmit as 'user-prompt' item [LUM-N]"
```

---

## Task 3: API route + integration test — TDD

**Files:**

- Create: `app/api/hooks/user-prompt-submit/route.ts`
- Modify: `__tests__/app/api/hooks/route.integration.test.ts`

- [ ] **Step 1: 写失败集成测试**

打开 `__tests__/app/api/hooks/route.integration.test.ts`,在顶部 `import` 区加一行(紧随既有 `postStop` 导入后):

```typescript
import { POST as postUserPrompt } from '@/app/api/hooks/user-prompt-submit/route'
```

在文件末尾、`describe('POST /api/hooks/stop', ...)` 块之后,追加:

```typescript
describe('POST /api/hooks/user-prompt-submit', () => {
  it('records USER_PROMPT_SUBMIT event', async () => {
    const payload = {
      session_id: 'sess_1',
      cwd: '/tmp',
      prompt: 'hello',
    }
    const res = await postUserPrompt(
      post('http://x/api/hooks/user-prompt-submit', payload, {
        Authorization: 'Bearer lum_ok',
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockRecord).toHaveBeenCalledWith({
      identity,
      type: 'USER_PROMPT_SUBMIT',
      payload,
    })
  })

  it('returns 401 without bearer', async () => {
    const res = await postUserPrompt(
      post('http://x/api/hooks/user-prompt-submit', {})
    )
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npm test -- --testPathPattern=hooks/route.integration
```

Expected: FAIL — `Cannot find module '@/app/api/hooks/user-prompt-submit/route'`。

- [ ] **Step 3: 创建路由文件**

创建目录 + 文件 `app/api/hooks/user-prompt-submit/route.ts`:

```typescript
import { handleHookRequest } from '@/app/api/hooks/_handler'

export async function POST(request: Request) {
  return handleHookRequest(request, 'USER_PROMPT_SUBMIT')
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npm test -- --testPathPattern=hooks/route.integration
```

Expected: PASS — 所有用例(新旧)均通过。

- [ ] **Step 5: Commit**

```bash
git add app/api/hooks/user-prompt-submit/ __tests__/app/api/hooks/route.integration.test.ts
git commit -m "feat(api): add /api/hooks/user-prompt-submit route [LUM-N]"
```

---

## Task 4: CLI extension — extend HookPath and register subcommand

**Files:**

- Modify: `cli/src/lib/hook-runner.ts` (line 23)
- Modify: `cli/src/index.ts` (line ~75,紧邻 hook 其他子命令注册)

现有 CLI 没有 hook 子命令的单测(参见 `__tests__/` 无 `cli/*`)。这是纯机械改动 + 类型检查即可。

- [ ] **Step 1: 扩展 HookPath 联合类型**

修改 `cli/src/lib/hook-runner.ts`,把 `HookPath` (line 23)改为:

```typescript
export type HookPath =
  | 'pre-tool-use'
  | 'post-tool-use'
  | 'user-prompt-submit'
  | 'stop'
```

- [ ] **Step 2: 注册 CLI 子命令**

修改 `cli/src/index.ts`,在 `hook.command('post-tool-use')` 块后、`hook.command('stop')` 块前插入:

```typescript
hook
  .command('user-prompt-submit')
  .description(
    'Forward a UserPromptSubmit hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('user-prompt-submit')))
```

- [ ] **Step 3: 本地构建 CLI**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/cli
npm run build
```

Expected: 构建无错误。(如果此仓库 CLI 有 test 脚本但目前没测,`npm test` 会跳过;无需强行补测 —— 和 pre-tool-use / post-tool-use / stop 保持一致。)

- [ ] **Step 4: 烟囱测 CLI dispatch**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/cli
echo '{}' | node dist/index.js hook user-prompt-submit
echo "exit: $?"
```

Expected: `exit: 0`。(凭据缺失会被 `logHookError` 写到 `~/.lumo/hook.log`,不污染 stdout/stderr,这是既有契约。)

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add cli/src/index.ts cli/src/lib/hook-runner.ts cli/dist/
git commit -m "feat(cli): add 'lumo hook user-prompt-submit' subcommand [LUM-N]"
```

Note: 如果仓库把 `cli/dist/` gitignore 了(需要确认 `git status` 看看是否包含 dist 构建产物),则 step 5 的 add 只需要 `cli/src/`。运行 `git status --short cli/` 来确认。

---

## Task 5: Timeline.tsx — blue "You" styling

**Files:**

- Modify: `app/sessions/[id]/Timeline.tsx` (line ~36-43)

此文件无既有单测。样式改动通过后续的 dogfood 步骤目视验证。

- [ ] **Step 1: 更新 kindLabel 分派**

修改 `app/sessions/[id]/Timeline.tsx` 第 43 行附近:

**旧:**

```typescript
const kindLabel = item.kind === 'stop' ? 'Stop' : (item.toolName ?? 'tool')
```

**新:**

```typescript
const kindLabel =
  item.kind === 'stop'
    ? 'Stop'
    : item.kind === 'user-prompt'
      ? 'You'
      : (item.toolName ?? 'tool')
```

- [ ] **Step 2: 更新 statusClass — 为 user-prompt 着蓝色**

修改第 36-41 行附近:

**旧:**

```typescript
const statusClass =
  item.status === 'error'
    ? 'text-red-600'
    : item.status === 'pending'
      ? 'text-amber-600'
      : 'text-emerald-600'
```

**新:**

```typescript
const statusClass =
  item.kind === 'user-prompt'
    ? 'text-sky-600 font-medium'
    : item.status === 'error'
      ? 'text-red-600'
      : item.status === 'pending'
        ? 'text-amber-600'
        : 'text-emerald-600'
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add app/sessions/[id]/Timeline.tsx
git commit -m "feat(timeline): style user-prompt rows in blue with 'You' label [LUM-N]"
```

---

## Task 6: Wire up .claude/settings.json

**Files:**

- Modify: `.claude/settings.json`

此文件没有单测,但改它会让**本机**的 Claude Code 立即开始给 Lumo 发 UserPromptSubmit。因此这是 dogfood 的起点。

- [ ] **Step 1: 添加 UserPromptSubmit 钩子**

修改 `.claude/settings.json` 为:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [{ "type": "command", "command": "lumo hook pre-tool-use" }]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [{ "type": "command", "command": "lumo hook post-tool-use" }]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "lumo hook user-prompt-submit" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "command", "command": "lumo hook stop" }]
      }
    ]
  }
}
```

(Prettier 可能在 commit 时重排;不影响语义。)

- [ ] **Step 2: Commit**

```bash
git add .claude/settings.json
git commit -m "chore(claude): wire UserPromptSubmit hook to lumo CLI [LUM-N]"
```

---

## Task 7: 全量验证与合并准备

- [ ] **Step 1: 全量测试**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
npm test
```

Expected: 所有测试通过(包括 merge-events 新 case、API 集成测试新 case)。

- [ ] **Step 2: 全量 typecheck**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 3: Lint**

```bash
npm run lint 2>&1 | tail -10
```

Expected: 无 `error`;警告照现状。

- [ ] **Step 4: 确认无 console.log**

```bash
git diff main..HEAD -- '*.ts' '*.tsx' | grep -E '^\+' | grep -c 'console\.log' || echo 0
```

Expected: `0`。

- [ ] **Step 5: 启动 dev server,验证一次真实 UserPromptSubmit 端到端**

```bash
npm run dev
```

在另一个终端新开一个 Claude Code session(本仓库内)。随便说一句话。等 hook 发完。

然后在浏览器打开 `http://localhost:3000/sessions/<session-id>`(session 列表 `http://localhost:3000/sessions` 里会出现新行)。

**验证点:**

- Timeline 最上面出现蓝色 "You" 行
- summary 是你刚才输入的话的前 100 字
- 点开能看到完整 prompt block
- 如果 prompt 里含 `<system-reminder>`(例如首次 session 带 SessionStart hook 注入),会额外看到 "raw (with injected context)" block

- [ ] **Step 6: 推分支 + 开 PR**

```bash
git push -u origin lumo/LUM-N-user-prompt-submit-hook
gh pr create --title "feat: add UserPromptSubmit hook to Timeline [LUM-N]" --body "$(cat <<'EOF'
## Summary

- Extend HookEventType enum with USER_PROMPT_SUBMIT + migration
- New /api/hooks/user-prompt-submit route (5-line delegate)
- CLI gets a new `lumo hook user-prompt-submit` subcommand
- Timeline renders user-prompt events as blue "You" rows, with harness-injected tags stripped from the summary
- Pure observation: no summary invalidation, no task matching, no classifier change

Design: `docs/superpowers/specs/2026-04-23-user-prompt-submit-hook-design.md`

## Test plan

- [ ] merge-events unit tests cover tag stripping, empty prompt, long clip, ordering
- [ ] Hook API integration tests cover 200 ok / 401 no auth for the new route
- [ ] Manual dogfood: start a Claude Code session, see blue "You" row in Timeline

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note: `--title` 里的 `[LUM-N]` 按 CLAUDE.md 惯例是占位 task id。真正发 PR 前,把 N 替换为 Linear / 内部 tracker 里分配的实际数字。

---

## Self-review checklist

- ✅ Task 1 覆盖 spec §4.1(Prisma)
- ✅ Task 2 覆盖 spec §4.5.1(merge-events + stripInjectedTags)+ §6.1 单测
- ✅ Task 3 覆盖 spec §4.4(API route)+ §6.1 集成测试
- ✅ Task 4 覆盖 spec §4.3(CLI)
- ✅ Task 5 覆盖 spec §4.5.2(Timeline.tsx 样式)
- ✅ Task 6 覆盖 spec §4.2(settings.json)
- ✅ Task 7 覆盖 CLAUDE.md PR checklist + 手动 dogfood(spec §6.2)
- ✅ 所有类型、签名、文件路径内部自洽(HookPath 联合、TimelineItem.kind、`stripInjectedTags` 名字三处一致)
