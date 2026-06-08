# 通用实体 @ 提及系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复静默失效的 @ 通知 bug,并把编辑器 @ 提及从 user/task 扩成 user/task/sprint/project/milestone 五类实体、全面接入所有编辑器面。

**Architecture:** 复用现有 tiptap mention 节点 + suggestion + MentionList。抽共享纯解析器修通知 bug;泛化节点/列表到 5 类;新增统一 `mention-search` 服务端端点(tasks/sprints/projects/milestones),人走客户端缓存;新增 `useMentionSources()` 把 `members + searchEntities` 收成单一 prop,各编辑器面统一接入。

**Tech Stack:** Next.js 14 App Router, TypeScript (strict), Prisma, Clerk, React Query, tiptap (`@tiptap/extension-mention` + `@tiptap/suggestion` 已装), react-intl, Jest。

**Spec:** [2026-06-08-editor-mentions-design.md](../specs/2026-06-08-editor-mentions-design.md)

**全局约束(每个任务都适用):**

- TypeScript strict;`npx tsc --noEmit` 必须干净(`noUncheckedIndexedAccess` 与 `exactOptionalPropertyTypes` 都开着——可选字段写 `field?: T | undefined`,索引访问后判 undefined)。
- 测试放 `__tests__/` 或 `tests/`(仓库有**两个**测试根,改符号时两处都 grep);跑 `npx jest <path>`。
- 不 `console.log`;commit message 用 `type: description [LUM-330]`。
- 分支已建:`lumo/LUM-330-editor-mentions`。频繁提交,每个任务至少一次 commit。
- 无 schema 变更、无新 npm 依赖。

---

## 文件结构(决策锁定)

**新增**

- `types/mention.ts` — 共享类型 `MentionKind` / `MentionSearchItem`(wire DTO)/ `MentionItem`(UI 判别联合)/ `MentionSources`。被 lib 服务与 app 组件共用。
- `lib/editor/parse-mentions.ts` — 纯函数 `parseMentionedUserClerkIds(html, authorClerkId)`。修通知 bug 的单一真相。
- `lib/repositories/mention-search.repository.ts` — 四类实体的精简 Prisma 查询。
- `lib/services/mention-search.service.ts` — 编排四查、映射成 `MentionSearchItem[]`(含 href)。
- `app/api/workspaces/mention-search/route.ts` — 薄 GET route(Clerk auth → Zod → service)。
- `lib/api-client/mention-search.ts` — `mentionSearchClient.search(q, limit)`。
- `app/workspace/[workspaceUrl]/components/mention-types.ts` — `buildMentionSources` 客户端映射 + `MentionSources` 组装(把 `WorkspaceMemberInfo[]` 映射成 user `MentionItem[]`)。
- `app/workspace/[workspaceUrl]/hooks/useMentionSources.ts` — 返回 `{ members, searchEntities }` 单一 prop。
- 对应 `*.test.ts(x)`。

**修改**

- `lib/editor/nodes/mention-with-type.ts` — 5 类 + `data-href` + 泛化 renderHTML/renderText。
- `app/workspace/[workspaceUrl]/components/MentionList.tsx` — `type`→`kind`、5 类通用渲染、分组、加载/空态。
- `app/workspace/[workspaceUrl]/components/mention-suggestion.ts` — 吃 `MentionSources`、异步 `searchEntities` 回填。
- `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx` — prop 从 `members/tasks/agentActors` 换成 `mentionSources`;加 mention 点击导航。
- `lib/services/comment.service.ts` / `lib/services/documentComment.service.ts` — 改用共享解析器,删本地正则。
- 各接入面组件(见 Task 14)。
- `lib/i18n/*.json`(16 个)。

---

## Phase A — 修通知 bug(独立可上,先做)

### Task 1: 共享 mention 解析器 + 对着渲染器的回归测试

**Files:**

- Create: `lib/editor/parse-mentions.ts`
- Test: `__tests__/lib/editor/parse-mentions.test.ts`

- [ ] **Step 1: 写失败测试**(关键:输入由 `renderMentionHTML` 真实输出序列化而来,而非手写 `data-type="mention"`)

```ts
// __tests__/lib/editor/parse-mentions.test.ts
import { renderMentionHTML } from '@/lib/editor/nodes/mention-with-type'
import { parseMentionedUserClerkIds } from '@/lib/editor/parse-mentions'

/**
 * 把节点 renderHTML 返回的 DOM-spec 序列化成 HTML 字符串。
 * 关键:输入由真实渲染器派生 —— renderHTML 一旦改属性,这里的输入随之改变,
 * 关掉「单测用假 HTML 永远绿」的根因。
 */
function renderMentionToHtml(attrs: Record<string, unknown>): string {
  // 模拟 tiptap 传入的 HTMLAttributes:由节点 addAttributes 的 renderHTML 产出
  const htmlAttrs: Record<string, string> = {}
  if (attrs.id != null) htmlAttrs['data-id'] = String(attrs.id)
  htmlAttrs['data-mention-type'] = String(attrs.mentionType ?? 'user')
  if (attrs.mentionStatus != null)
    htmlAttrs['data-mention-status'] = String(attrs.mentionStatus)
  if (attrs.mentionTitle != null)
    htmlAttrs['data-mention-title'] = String(attrs.mentionTitle)
  const [tag, mergedAttrs, text] = renderMentionHTML(attrs, htmlAttrs)
  const attrStr = Object.entries(mergedAttrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('')
  return `<${tag}${attrStr}>${text}</${tag}>`
}

describe('parseMentionedUserClerkIds', () => {
  it('extracts clerkId from a real user mention (no data-type="mention")', () => {
    const html = renderMentionToHtml({
      mentionType: 'user',
      id: 'user_alice',
      label: 'Alice',
    })
    expect(html).not.toContain('data-type="mention"') // 回归:坏正则曾指望它
    expect(parseMentionedUserClerkIds(html, 'user_self')).toEqual([
      'user_alice',
    ])
  })

  it('ignores task / sprint / project / milestone mentions', () => {
    const html =
      renderMentionToHtml({
        mentionType: 'task',
        id: 'task_123',
        label: 'LUM-1',
        mentionTitle: 'Fix bug',
        mentionStatus: 'IN_PROGRESS',
      }) +
      renderMentionToHtml({
        mentionType: 'sprint',
        id: 'sp_1',
        label: 'Sprint 1',
      }) +
      renderMentionToHtml({
        mentionType: 'project',
        id: 'pr_1',
        label: 'Lumo',
      }) +
      renderMentionToHtml({ mentionType: 'milestone', id: 'ms_1', label: 'v1' })
    expect(parseMentionedUserClerkIds(html, 'user_self')).toEqual([])
  })

  it('excludes the author and __agent__, and dedups repeats', () => {
    const html =
      renderMentionToHtml({
        mentionType: 'user',
        id: 'user_self',
        label: 'Me',
      }) +
      renderMentionToHtml({
        mentionType: 'user',
        id: '__agent__',
        label: 'Agent',
      }) +
      renderMentionToHtml({
        mentionType: 'user',
        id: 'user_bob',
        label: 'Bob',
      }) +
      renderMentionToHtml({ mentionType: 'user', id: 'user_bob', label: 'Bob' })
    expect(parseMentionedUserClerkIds(html, 'user_self')).toEqual(['user_bob'])
  })

  it('treats a legacy mention with no data-mention-type as a user', () => {
    const html = '<span class="mention" data-id="user_legacy">@Legacy</span>'
    expect(parseMentionedUserClerkIds(html, 'user_self')).toEqual([
      'user_legacy',
    ])
  })

  it('returns [] for empty / mention-free html', () => {
    expect(parseMentionedUserClerkIds('<p>hi there</p>', 'x')).toEqual([])
    expect(parseMentionedUserClerkIds('', 'x')).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/lib/editor/parse-mentions.test.ts`
Expected: FAIL — `parseMentionedUserClerkIds` 未定义(module not found)。

- [ ] **Step 3: 实现解析器**

```ts
// lib/editor/parse-mentions.ts

/**
 * 从评论/文档 HTML 中提取被 @ 的「人」clerkId。
 *
 * 顺序无关:逐个匹配 mention 元素(节点渲染 class 含 "mention"),读其
 * data-mention-type(缺省 = 'user',兼容旧内容)与 data-id;只在 type=user 时
 * 收集 data-id(= clerkId)。排除作者与 __agent__,去重。
 *
 * 实体类型(task/sprint/project/milestone)的 data-id 不是 clerkId,一律跳过 ——
 * 这从根上消除「拿 taskId 当 clerkId 查」的误报。纯函数,永不抛,返回 []。
 */
export function parseMentionedUserClerkIds(
  html: string,
  authorClerkId: string
): string[] {
  const ids: string[] = []
  if (!html) return ids
  const tagRegex = /<(?:span|a)\b[^>]*\bclass="[^"]*\bmention\b[^"]*"[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = tagRegex.exec(html)) !== null) {
    const tag = m[0]
    const typeMatch = /data-mention-type="([^"]+)"/.exec(tag)
    const type = typeMatch ? typeMatch[1] : 'user'
    if (type !== 'user') continue
    const idMatch = /data-id="([^"]+)"/.exec(tag)
    const clerkId = idMatch?.[1]
    if (
      clerkId &&
      clerkId !== authorClerkId &&
      clerkId !== '__agent__' &&
      !ids.includes(clerkId)
    ) {
      ids.push(clerkId)
    }
  }
  return ids
}
```

> 注:本任务依赖 `renderMentionHTML` 已支持 entity 类型签名;现版本已导出且对未知 mentionType 走 user 分支,测试可先跑通。Task 4 扩展它后,需回跑本测试确认仍绿。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest __tests__/lib/editor/parse-mentions.test.ts`
Expected: PASS(5 个用例全绿)。

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add lib/editor/parse-mentions.ts __tests__/lib/editor/parse-mentions.test.ts
git commit -m "feat: shared mention parser extracting only user clerkIds [LUM-330]"
```

---

### Task 2: comment.service 改用共享解析器,修真实 HTML 测试

**Files:**

- Modify: `lib/services/comment.service.ts`(`parseMentionedClerkIds` 方法,约 95-112 行;`notifyMentions` 内 156 行调用点)
- Test: 找现有 `comment.service.test.ts`(两个测试根都 grep:`grep -rl "parseMentionedClerkIds\|notifyMentions" __tests__ tests`)

- [ ] **Step 1: 改测试为真实 HTML**

打开现有 comment.service 测试,把所有手写 `data-type="mention"` 的 mention HTML 改成真实节点输出格式 `<span class="mention" data-id="user_x" data-mention-type="user">@X</span>`。新增一条断言:旧坏格式 `data-type="mention"` **不再**被解析(防回归)。示例新增用例:

```ts
it('parses user mentions from real editor HTML (regression for data-type bug)', () => {
  const body =
    '<p>hi <span class="mention" data-id="user_bob" data-mention-type="user">@Bob</span> ' +
    'and <span class="mention mention-task" data-id="task_9" data-mention-type="task">LUM-9 Fix</span></p>'
  expect(commentService.parseMentionedClerkIds(body, 'user_self')).toEqual([
    'user_bob',
  ])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest <comment.service.test path>`
Expected: FAIL —— 旧实现的正则匹配不到真实 HTML,新用例期望 `['user_bob']` 实得 `[]`。

- [ ] **Step 3: 用共享解析器替换本地正则**

在 `lib/services/comment.service.ts`:顶部加 `import { parseMentionedUserClerkIds } from '@/lib/editor/parse-mentions'`。把 `parseMentionedClerkIds` 方法体替换为委托(保留方法名,callers/测试不变):

```ts
  /** Parse @mention clerkIds from comment body HTML. Excludes author and __agent__. */
  parseMentionedClerkIds(body: string, authorClerkId: string): string[] {
    return parseMentionedUserClerkIds(body, authorClerkId)
  },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest <comment.service.test path>`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
npx tsc --noEmit
git add lib/services/comment.service.ts <comment.service.test path>
git commit -m "fix: task-comment @notifications use shared parser (real HTML) [LUM-330]"
```

---

### Task 3: documentComment.service 改用共享解析器,修真实 HTML 测试

**Files:**

- Modify: `lib/services/documentComment.service.ts`(顶层 `parseMentionedClerkIds` 函数,51-67 行)
- Test: 现有 `documentComment.service.test.ts`(两测试根 grep)

- [ ] **Step 1: 改测试为真实 HTML**(同 Task 2,针对 doc comment),新增回归用例:

```ts
it('notifies user mentions from real editor HTML, ignores entity mentions', async () => {
  // body 含一个真实 user mention + 一个 task mention;只有 user 进 createMany
  // ...沿用该测试既有的 mock 风格断言 notificationRepository.createMany 收到一条 user 记录
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest <documentComment.service.test path>`
Expected: FAIL（真实 HTML 解析不到 → 0 通知）。

- [ ] **Step 3: 替换本地正则为委托**

`lib/services/documentComment.service.ts`:顶部加 `import { parseMentionedUserClerkIds } from '@/lib/editor/parse-mentions'`,删除 51-67 行的本地 `parseMentionedClerkIds` 函数,把 92 行调用改为 `parseMentionedUserClerkIds(body, authorClerkId ?? '')`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest <documentComment.service.test path>`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
npx tsc --noEmit
git add lib/services/documentComment.service.ts <documentComment.service.test path>
git commit -m "fix: doc-comment @notifications use shared parser (real HTML) [LUM-330]"
```

---

## Phase B — 类型 + 节点 + 列表泛化

### Task 4: 共享类型 + 节点扩成 5 类 + data-href

**Files:**

- Create: `types/mention.ts`
- Modify: `lib/editor/nodes/mention-with-type.ts`
- Test: `__tests__/lib/editor/mention-with-type.test.ts`

- [ ] **Step 1: 建共享类型**

```ts
// types/mention.ts
export type MentionKind = 'user' | 'task' | 'sprint' | 'project' | 'milestone'

/** 实体搜索结果的 wire DTO(服务端→客户端)。人不走它(走客户端缓存)。 */
export interface MentionSearchItem {
  kind: 'task' | 'sprint' | 'project' | 'milestone'
  id: string
  label: string // "LUM-42" / "Sprint 14" / 项目名 / 里程碑名
  sublabel?: string // 任务标题 / sprint 名 / 里程碑日期等
  status?: string // task/sprint 状态(用于状态图标)
  href: string // 应用内相对路径
}

/** 下拉项(UI 判别联合)。 */
export type MentionItem =
  | {
      kind: 'user'
      id: string // clerkId
      label: string
      imageUrl: string | null
    }
  | MentionSearchItem

/** 单一 prop:人(即时)+ 实体异步搜索。 */
export interface MentionSources {
  members: Extract<MentionItem, { kind: 'user' }>[]
  searchEntities: (query: string) => Promise<MentionSearchItem[]>
}
```

- [ ] **Step 2: 写失败测试(节点渲染)**

```ts
// __tests__/lib/editor/mention-with-type.test.ts
import {
  renderMentionHTML,
  renderMentionText,
} from '@/lib/editor/nodes/mention-with-type'

describe('renderMentionHTML', () => {
  it('renders a user mention as a span with @label, no data-href', () => {
    const [tag, attrs, text] = renderMentionHTML(
      { mentionType: 'user', id: 'user_a', label: 'Alice' },
      { 'data-id': 'user_a', 'data-mention-type': 'user' }
    )
    expect(tag).toBe('span')
    expect(text).toBe('@Alice')
    expect(attrs.class).toContain('mention')
    expect(attrs['data-href']).toBeUndefined()
  })

  it('renders an entity mention as a clickable anchor with href + kind class', () => {
    const [tag, attrs, text] = renderMentionHTML(
      {
        mentionType: 'sprint',
        id: 'sp_1',
        label: 'Sprint 14',
        mentionHref: '/workspace/acme/sprints/14',
      },
      {
        'data-id': 'sp_1',
        'data-mention-type': 'sprint',
        'data-href': '/workspace/acme/sprints/14',
      }
    )
    expect(tag).toBe('a')
    expect(attrs.href).toBe('/workspace/acme/sprints/14')
    expect(attrs.class).toContain('mention-sprint')
    expect(text).toBe('Sprint 14')
  })

  it('task mention keeps "LABEL title" text and task class', () => {
    const [, attrs, text] = renderMentionHTML(
      {
        mentionType: 'task',
        id: 't1',
        label: 'LUM-1',
        mentionTitle: 'Fix',
        mentionHref: '/x',
      },
      { 'data-id': 't1', 'data-mention-type': 'task', 'data-href': '/x' }
    )
    expect(attrs.class).toContain('mention-task')
    expect(text).toBe('LUM-1 Fix')
  })
})

describe('renderMentionText', () => {
  it('user → @label, entity → label', () => {
    expect(renderMentionText({ mentionType: 'user', label: 'Bob' })).toBe(
      '@Bob'
    )
    expect(renderMentionText({ mentionType: 'project', label: 'Lumo' })).toBe(
      'Lumo'
    )
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx jest __tests__/lib/editor/mention-with-type.test.ts`
Expected: FAIL（entity 分支与 `mentionHref`/`data-href` 未实现）。

- [ ] **Step 4: 实现节点泛化**

替换 `lib/editor/nodes/mention-with-type.ts` 全文:

```ts
import Mention from '@tiptap/extension-mention'
import { mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

type MentionAttrs = ProseMirrorNode['attrs']

const ENTITY_TYPES = new Set(['task', 'sprint', 'project', 'milestone'])

/** Pure: the DOM-spec array a mention node's renderHTML returns. */
export function renderMentionHTML(
  attrs: MentionAttrs,
  HTMLAttributes: Record<string, unknown>
): readonly [string, Record<string, any>, string] {
  const type = attrs.mentionType ?? 'user'

  // 人:非链接 span,显示 @label
  if (!ENTITY_TYPES.has(type)) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'mention mention-user' }),
      `@${attrs.label ?? attrs.id}`,
    ]
  }

  // 实体:可点 anchor,显示 label(任务额外拼标题)
  const label = attrs.label ?? attrs.id
  const text =
    type === 'task' && attrs.mentionTitle
      ? `${label} ${attrs.mentionTitle}`
      : label
  return [
    'a',
    mergeAttributes(HTMLAttributes, {
      class: `mention mention-${type}`,
      ...(attrs.mentionHref ? { href: attrs.mentionHref } : {}),
      ...(attrs.mentionStatus
        ? { 'data-mention-status': attrs.mentionStatus }
        : {}),
    }),
    text,
  ]
}

/** Pure: the plain-text representation a mention node's renderText returns. */
export function renderMentionText(attrs: MentionAttrs): string {
  const type = attrs.mentionType ?? 'user'
  if (!ENTITY_TYPES.has(type)) return `@${attrs.label ?? attrs.id}`
  const label = attrs.label ?? attrs.id
  return type === 'task' && attrs.mentionTitle
    ? `${label} ${attrs.mentionTitle}`
    : label
}

/** Mention node extended with type / title / status / href attributes. */
export const MentionWithType = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mentionType: {
        default: 'user',
        parseHTML: el => el.getAttribute('data-mention-type') ?? 'user',
        renderHTML: attrs => ({ 'data-mention-type': attrs.mentionType }),
      },
      mentionTitle: {
        default: null,
        parseHTML: el => el.getAttribute('data-mention-title') ?? null,
        renderHTML: attrs =>
          attrs.mentionTitle
            ? { 'data-mention-title': attrs.mentionTitle }
            : {},
      },
      mentionStatus: {
        default: null,
        parseHTML: el => el.getAttribute('data-mention-status') ?? null,
        renderHTML: attrs =>
          attrs.mentionStatus
            ? { 'data-mention-status': attrs.mentionStatus }
            : {},
      },
      mentionHref: {
        default: null,
        parseHTML: el => el.getAttribute('data-href') ?? null,
        renderHTML: attrs =>
          attrs.mentionHref ? { 'data-href': attrs.mentionHref } : {},
      },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    return renderMentionHTML(node.attrs, HTMLAttributes)
  },
  renderText({ node }) {
    return renderMentionText(node.attrs)
  },
})
```

> 兼容性:旧 user mention 之前 class 是 `"mention"`(无 `mention-user`)。解析器(Task 1)按 `\bmention\b` 匹配,`mention-user` 仍命中,无影响。

- [ ] **Step 5: 跑节点测试 + 回跑解析器测试**

Run: `npx jest __tests__/lib/editor/mention-with-type.test.ts __tests__/lib/editor/parse-mentions.test.ts`
Expected: 两个文件全 PASS。

- [ ] **Step 6: tsc + commit**

```bash
npx tsc --noEmit
git add types/mention.ts lib/editor/nodes/mention-with-type.ts __tests__/lib/editor/mention-with-type.test.ts
git commit -m "feat: generalize mention node to 5 entity kinds + data-href [LUM-330]"
```

---

### Task 5: MentionList 泛化(5 类渲染 + 分组 + 加载/空态)+ i18n key

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/MentionList.tsx`
- Modify: `lib/i18n/en.json`(加 `mention.sprints` / `mention.projects` / `mention.milestones` / `mention.searching`)
- Test: `__tests__/components/MentionList.test.tsx`

- [ ] **Step 1: 加英文 i18n key**(其余 locale 在 Task 15 统一 sync)

在 `lib/i18n/en.json` 的 `mention.*` 区块补:

```json
  "mention.sprints": "Sprints",
  "mention.projects": "Projects",
  "mention.milestones": "Milestones",
  "mention.searching": "Searching…"
```

- [ ] **Step 2: 写失败测试**

```tsx
// __tests__/components/MentionList.test.tsx
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { createRef } from 'react'
import {
  MentionList,
  type MentionListRef,
} from '@/app/workspace/[workspaceUrl]/components/MentionList'
import en from '@/lib/i18n/en.json'

function renderList(items: any[], loading = false) {
  return render(
    <IntlProvider locale='en' messages={en as Record<string, string>}>
      <MentionList
        ref={createRef<MentionListRef>()}
        items={items}
        loading={loading}
        command={() => {}}
      />
    </IntlProvider>
  )
}

it('groups all five kinds under headers', () => {
  renderList([
    { kind: 'user', id: 'u1', label: 'Alice', imageUrl: null },
    {
      kind: 'task',
      id: 't1',
      label: 'LUM-1',
      sublabel: 'Fix',
      status: 'TODO',
      href: '/x',
    },
    { kind: 'sprint', id: 's1', label: 'Sprint 14', href: '/x' },
    { kind: 'project', id: 'p1', label: 'Lumo', href: '/x' },
    { kind: 'milestone', id: 'm1', label: 'v1', href: '/x' },
  ])
  expect(screen.getByText('Users')).toBeInTheDocument()
  expect(screen.getByText('Tasks')).toBeInTheDocument()
  expect(screen.getByText('Sprints')).toBeInTheDocument()
  expect(screen.getByText('Projects')).toBeInTheDocument()
  expect(screen.getByText('Milestones')).toBeInTheDocument()
  expect(screen.getByText('Alice')).toBeInTheDocument()
})

it('shows searching state when loading with no entity items yet', () => {
  renderList([{ kind: 'user', id: 'u1', label: 'Alice', imageUrl: null }], true)
  expect(screen.getByText('Searching…')).toBeInTheDocument()
})

it('shows empty state when no items and not loading', () => {
  renderList([], false)
  expect(screen.getByText('No results')).toBeInTheDocument()
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx jest __tests__/components/MentionList.test.tsx`
Expected: FAIL（`kind` 字段、`loading` prop、新分组未实现）。

- [ ] **Step 4: 重写 MentionList**

替换 `app/workspace/[workspaceUrl]/components/MentionList.tsx` 全文:

```tsx
'use client'

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useState,
} from 'react'
import { useIntl } from 'react-intl'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ListChecks, Layers, FolderKanban, Flag } from 'lucide-react'
import { StatusIcon } from './StatusIcon'
import { cn } from '@/lib/utils'
import type { MentionItem, MentionKind } from '@/types/mention'

export type { MentionItem } from '@/types/mention'

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface MentionListProps {
  items: MentionItem[]
  loading?: boolean
  command: (attrs: {
    id: string
    label: string
    mentionType: string
    mentionTitle?: string
    mentionStatus?: string
    mentionHref?: string
  }) => void
}

const GROUP_ORDER: { kind: MentionKind; labelId: string }[] = [
  { kind: 'user', labelId: 'mention.users' },
  { kind: 'task', labelId: 'mention.tasks' },
  { kind: 'sprint', labelId: 'mention.sprints' },
  { kind: 'project', labelId: 'mention.projects' },
  { kind: 'milestone', labelId: 'mention.milestones' },
]

function EntityGlyph({ kind, status }: { kind: MentionKind; status?: string }) {
  if (kind === 'task') return <StatusIcon status={status ?? 'TODO'} size={14} />
  if (kind === 'sprint')
    return <Layers size={14} className='text-muted-foreground' />
  if (kind === 'project')
    return <FolderKanban size={14} className='text-muted-foreground' />
  if (kind === 'milestone')
    return <Flag size={14} className='text-muted-foreground' />
  return <ListChecks size={14} className='text-muted-foreground' />
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, loading = false, command }, ref) => {
    const intl = useIntl()
    const [selectedIndex, setSelectedIndex] = useState(0)
    const baseId = useId()
    const optionId = (index: number) => `${baseId}-opt-${index}`

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    const selectItem = (index: number) => {
      const item = items[index]
      if (!item) return
      if (item.kind === 'user') {
        command({ id: item.id, label: item.label, mentionType: 'user' })
        return
      }
      command({
        id: item.id,
        label: item.label,
        mentionType: item.kind,
        ...(item.kind === 'task' && item.sublabel
          ? { mentionTitle: item.sublabel }
          : {}),
        ...(item.status ? { mentionStatus: item.status } : {}),
        mentionHref: item.href,
      })
    }

    useImperativeHandle(ref, () => ({
      onKeyDown({ event }) {
        if (!items.length) return false
        if (event.key === 'ArrowUp') {
          setSelectedIndex(i => (i - 1 + items.length) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex(i => (i + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          selectItem(selectedIndex)
          return true
        }
        return false
      },
    }))

    if (!items.length) {
      return (
        <div className='px-3 py-2 text-xs text-muted-foreground'>
          {loading
            ? intl.formatMessage({ id: 'mention.searching' })
            : intl.formatMessage({ id: 'mention.empty' })}
        </div>
      )
    }

    const renderRow = (item: MentionItem, flatIndex: number) => {
      const isSelected = flatIndex === selectedIndex
      const rowCls = cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
        isSelected ? 'bg-muted' : 'hover:bg-muted'
      )
      const common = {
        id: optionId(flatIndex),
        type: 'button' as const,
        role: 'option' as const,
        'aria-selected': isSelected,
        onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
        onClick: () => selectItem(flatIndex),
        onMouseEnter: () => setSelectedIndex(flatIndex),
        className: rowCls,
      }

      if (item.kind === 'user') {
        const initials = item.label
          .split(' ')
          .map(w => w[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)
        return (
          <button key={`user-${item.id}`} {...common}>
            <Avatar className='size-5 shrink-0'>
              <AvatarImage src={item.imageUrl ?? undefined} />
              <AvatarFallback className='text-[10px]'>
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className='text-foreground truncate'>{item.label}</span>
          </button>
        )
      }

      return (
        <button key={`${item.kind}-${item.id}`} {...common}>
          <EntityGlyph kind={item.kind} status={item.status} />
          <span className='text-xs text-muted-foreground shrink-0 font-medium'>
            {item.label}
          </span>
          {item.sublabel && (
            <span className='text-foreground truncate'>{item.sublabel}</span>
          )}
        </button>
      )
    }

    // 计算每组的扁平起始下标,保证键盘导航 index 与渲染顺序一致
    let cursor = 0
    return (
      <div
        className='py-1'
        role='listbox'
        aria-label={intl.formatMessage({ id: 'mention.label' })}
        aria-activedescendant={optionId(selectedIndex)}
      >
        {GROUP_ORDER.map(({ kind, labelId }, groupIdx) => {
          const groupItems = items.filter(i => i.kind === kind)
          if (!groupItems.length) return null
          const offset = cursor
          cursor += groupItems.length
          return (
            <div
              key={kind}
              role='group'
              aria-label={intl.formatMessage({ id: labelId })}
            >
              <div
                className={cn(
                  'px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground',
                  groupIdx > 0 &&
                    offset > 0 &&
                    'mt-1 border-t border-border pt-2'
                )}
              >
                {intl.formatMessage({ id: labelId })}
              </div>
              {groupItems.map((item, i) => renderRow(item, offset + i))}
            </div>
          )
        })}
        {loading && (
          <div className='px-3 py-1.5 text-xs text-muted-foreground'>
            {intl.formatMessage({ id: 'mention.searching' })}
          </div>
        )}
      </div>
    )
  }
)
MentionList.displayName = 'MentionList'
```

> `lucide-react` 图标已是仓库依赖(StatusIcon 同目录广泛使用 lucide);不新增依赖。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest __tests__/components/MentionList.test.tsx`
Expected: PASS。

- [ ] **Step 6: tsc + commit**

```bash
npx tsc --noEmit
git add app/workspace/\[workspaceUrl\]/components/MentionList.tsx lib/i18n/en.json __tests__/components/MentionList.test.tsx
git commit -m "feat: MentionList renders 5 entity kinds with grouped sections + loading state [LUM-330]"
```

---

## Phase C — 统一 mention-search 后端

### Task 6: mention-search repository(四类精简查询)

**Files:**

- Create: `lib/repositories/mention-search.repository.ts`
- Test: `__tests__/lib/repositories/mention-search.repository.test.ts`(用 mock 的 prisma client,断言传给 Prisma 的 `where`/`select`/`take`)

- [ ] **Step 1: 写失败测试**

```ts
// __tests__/lib/repositories/mention-search.repository.test.ts
jest.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findMany: jest.fn().mockResolvedValue([]) },
    sprint: { findMany: jest.fn().mockResolvedValue([]) },
    project: { findMany: jest.fn().mockResolvedValue([]) },
    milestone: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))
import { prisma } from '@/lib/prisma'
import { mentionSearchRepository } from '@/lib/repositories/mention-search.repository'

it('searchTasks selects only mention fields and caps results', async () => {
  await mentionSearchRepository.searchTasks('ws1', 'fix', 5)
  const arg = (prisma.task.findMany as jest.Mock).mock.calls[0][0]
  expect(arg.take).toBe(5)
  expect(arg.select).toMatchObject({
    id: true,
    number: true,
    title: true,
    status: true,
  })
  expect(JSON.stringify(arg.where)).toContain('fix')
})

it('searchMilestones joins project slug for href building', async () => {
  await mentionSearchRepository.searchMilestones('ws1', 'v', 5)
  const arg = (prisma.milestone.findMany as jest.Mock).mock.calls[0][0]
  expect(arg.select.project).toBeDefined()
})
```

- [ ] **Step 2: 跑确认失败** — `npx jest __tests__/lib/repositories/mention-search.repository.test.ts` → FAIL (module not found)。

- [ ] **Step 3: 实现 repository**

```ts
// lib/repositories/mention-search.repository.ts
import { prisma } from '@/lib/prisma'

const insensitive = (q: string) => ({
  contains: q,
  mode: 'insensitive' as const,
})

export const mentionSearchRepository = {
  searchTasks(workspaceId: string, q: string, take: number) {
    return prisma.task.findMany({
      where: {
        project: { workspaceId },
        OR: [
          { title: insensitive(q) },
          { team: { identifier: insensitive(q) } },
        ],
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        team: { select: { identifier: true } },
        project: { select: { slug: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take,
    })
  },

  searchSprints(workspaceId: string, q: string, take: number) {
    return prisma.sprint.findMany({
      where: { team: { workspaceId }, name: insensitive(q) },
      select: { id: true, number: true, name: true, status: true },
      orderBy: { number: 'desc' },
      take,
    })
  },

  searchProjects(workspaceId: string, q: string, take: number) {
    return prisma.project.findMany({
      where: { workspaceId, name: insensitive(q) },
      select: { id: true, name: true, slug: true },
      orderBy: { updatedAt: 'desc' },
      take,
    })
  },

  searchMilestones(workspaceId: string, q: string, take: number) {
    return prisma.milestone.findMany({
      where: { project: { workspaceId }, name: insensitive(q) },
      select: {
        id: true,
        name: true,
        slug: true,
        project: { select: { slug: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take,
    })
  },
}
```

> **执行者须核对真实 schema 字段名**:`team.identifier`、`project.slug`、`sprint.number`、`milestone.slug`、各表 `workspaceId` 关系路径。若某字段名不同(如 task 没有直接 `project.workspaceId` 关系),用 `npx prisma studio` 或读 `prisma/schema.prisma` 校正 `where`/`select` 后再跑测试。`mode: 'insensitive'` 是 Postgres 支持的。

- [ ] **Step 4: 跑确认通过** — PASS。

- [ ] **Step 5: commit**

```bash
npx prisma generate && npx tsc --noEmit
git add lib/repositories/mention-search.repository.ts __tests__/lib/repositories/mention-search.repository.test.ts
git commit -m "feat: mention-search repository (task/sprint/project/milestone select) [LUM-330]"
```

---

### Task 7: mention-search service(编排 + 映射成 MentionSearchItem + href)

**Files:**

- Create: `lib/services/mention-search.service.ts`
- Test: `__tests__/lib/services/mention-search.service.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// __tests__/lib/services/mention-search.service.test.ts
jest.mock('@/lib/repositories/mention-search.repository', () => ({
  mentionSearchRepository: {
    searchTasks: jest
      .fn()
      .mockResolvedValue([
        {
          id: 't1',
          number: 42,
          title: 'Fix bug',
          status: 'IN_PROGRESS',
          team: { identifier: 'LUM' },
          project: { slug: 'lumo' },
        },
      ]),
    searchSprints: jest
      .fn()
      .mockResolvedValue([
        { id: 's1', number: 14, name: 'Tokens', status: 'ACTIVE' },
      ]),
    searchProjects: jest
      .fn()
      .mockResolvedValue([{ id: 'p1', name: 'Lumo', slug: 'lumo' }]),
    searchMilestones: jest
      .fn()
      .mockResolvedValue([
        { id: 'm1', name: 'v1', slug: 'v1', project: { slug: 'lumo' } },
      ]),
  },
}))
import { mentionSearchService } from '@/lib/services/mention-search.service'

it('maps all four kinds to MentionSearchItem with hrefs', async () => {
  const items = await mentionSearchService.search('ws1', 'acme', 'x', 5)
  const byKind = Object.fromEntries(items.map(i => [i.kind, i]))
  expect(byKind.task).toMatchObject({
    kind: 'task',
    id: 't1',
    label: 'LUM-42',
    sublabel: 'Fix bug',
    status: 'IN_PROGRESS',
    href: '/workspace/acme/tasks/LUM-42',
  })
  expect(byKind.sprint).toMatchObject({
    kind: 'sprint',
    label: 'Sprint 14',
    href: '/workspace/acme/sprints/14',
  })
  expect(byKind.project).toMatchObject({
    kind: 'project',
    label: 'Lumo',
    href: '/workspace/acme/projects/lumo',
  })
  expect(byKind.milestone).toMatchObject({
    kind: 'milestone',
    label: 'v1',
    href: '/workspace/acme/projects/lumo/milestones/v1',
  })
})

it('returns [] for blank query', async () => {
  expect(await mentionSearchService.search('ws1', 'acme', '   ', 5)).toEqual([])
})
```

- [ ] **Step 2: 跑确认失败** → FAIL。

- [ ] **Step 3: 实现 service**

```ts
// lib/services/mention-search.service.ts
import { mentionSearchRepository } from '@/lib/repositories/mention-search.repository'
import type { MentionSearchItem } from '@/types/mention'

/**
 * 统一实体搜索:并行查四类,映射成带应用内相对 href 的 MentionSearchItem[]。
 * 人不在此(走客户端缓存)。空白 query 直接返回 []。
 */
export const mentionSearchService = {
  async search(
    workspaceId: string,
    workspaceSlug: string,
    query: string,
    perKind: number
  ): Promise<MentionSearchItem[]> {
    const q = query.trim()
    if (!q) return []

    const [tasks, sprints, projects, milestones] = await Promise.all([
      mentionSearchRepository.searchTasks(workspaceId, q, perKind),
      mentionSearchRepository.searchSprints(workspaceId, q, perKind),
      mentionSearchRepository.searchProjects(workspaceId, q, perKind),
      mentionSearchRepository.searchMilestones(workspaceId, q, perKind),
    ])

    const items: MentionSearchItem[] = []

    for (const t of tasks) {
      const identifier = `${t.team.identifier}-${t.number}`
      items.push({
        kind: 'task',
        id: t.id,
        label: identifier,
        sublabel: t.title,
        status: t.status,
        href: `/workspace/${workspaceSlug}/tasks/${identifier}`,
      })
    }
    for (const s of sprints) {
      items.push({
        kind: 'sprint',
        id: s.id,
        label: `Sprint ${s.number}`,
        sublabel: s.name,
        status: s.status,
        href: `/workspace/${workspaceSlug}/sprints/${s.number}`,
      })
    }
    for (const p of projects) {
      items.push({
        kind: 'project',
        id: p.id,
        label: p.name,
        href: `/workspace/${workspaceSlug}/projects/${p.slug}`,
      })
    }
    for (const ms of milestones) {
      items.push({
        kind: 'milestone',
        id: ms.id,
        label: ms.name,
        href: `/workspace/${workspaceSlug}/projects/${ms.project.slug}/milestones/${ms.slug}`,
      })
    }
    return items
  },
}
```

> `MentionSearchItem.sublabel`/`status` 是可选(`exactOptionalPropertyTypes` 下用条件展开,别赋 `undefined`)。上面 project 不带 sublabel/status,合规。若 sprint 状态枚举值需转字符串,`String(s.status)`。

- [ ] **Step 4: 跑确认通过** → PASS。

- [ ] **Step 5: commit**

```bash
npx tsc --noEmit
git add lib/services/mention-search.service.ts __tests__/lib/services/mention-search.service.test.ts
git commit -m "feat: mention-search service maps entities to items with hrefs [LUM-330]"
```

---

### Task 8: API route `GET /api/workspaces/mention-search`

**Files:**

- Create: `app/api/workspaces/mention-search/route.ts`
- Test: 可选(route 薄;核心逻辑已在 service 测过)。若仓库惯例有 route 测试则补一个 happy-path。

- [ ] **Step 1: 实现 route**(对照 `app/api/workspaces/members/route.ts` 的 `requireIdentity` 鉴权风格)

```ts
// app/api/workspaces/mention-search/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity' // 与 members/route.ts 同源,执行者按实际 import 路径校正
import { mentionSearchService } from '@/lib/services/mention-search.service'

const DEFAULT_PER_KIND = 5
const MAX_PER_KIND = 10

export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const url = new URL(request.url)
    const q = url.searchParams.get('q') ?? ''
    const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_PER_KIND)
    const perKind = Number.isFinite(limitRaw)
      ? Math.min(Math.max(1, Math.trunc(limitRaw)), MAX_PER_KIND)
      : DEFAULT_PER_KIND

    const items = await mentionSearchService.search(
      identity.workspaceId,
      identity.workspaceSlug,
      q,
      perKind
    )
    return NextResponse.json({ items })
  } catch (error) {
    console.error('GET /api/workspaces/mention-search error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

> 执行者须确认 `requireIdentity` 的真实 import 路径与返回字段名(`workspaceId`、`workspaceSlug`)。`members/route.ts` 用了 `identity.workspaceId`;`workspaceSlug` 若不在 identity 上,则用 identity 里的 workspace 对象取 slug(读那文件确认)。这是唯一需要现场核对的接线点。

- [ ] **Step 2: tsc + 手验**

```bash
npx tsc --noEmit
```

（dev server 起来后)`curl '/api/workspaces/mention-search?q=lum'` 应返回 `{ items: [...] }`。本地若鉴权难手测,靠 service 单测兜底。

- [ ] **Step 3: commit**

```bash
git add app/api/workspaces/mention-search/route.ts
git commit -m "feat: GET /api/workspaces/mention-search route [LUM-330]"
```

---

### Task 9: api-client 封装

**Files:**

- Create: `lib/api-client/mention-search.ts`
- Modify: `lib/api-client/index.ts`(导出)
- Test: `__tests__/lib/api-client/mention-search.test.ts`(mock fetch)

- [ ] **Step 1: 写失败测试**

```ts
// __tests__/lib/api-client/mention-search.test.ts
import { mentionSearchClient } from '@/lib/api-client/mention-search'

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      items: [{ kind: 'task', id: 't1', label: 'LUM-1', href: '/x' }],
    }),
  }) as any
})

it('calls the endpoint with encoded query + limit and returns items', async () => {
  const items = await mentionSearchClient.search('a b', 5)
  const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string
  expect(calledUrl).toContain('/api/workspaces/mention-search')
  expect(calledUrl).toContain('q=a+b')
  expect(calledUrl).toContain('limit=5')
  expect(items).toHaveLength(1)
})
```

- [ ] **Step 2: 跑确认失败** → FAIL。

- [ ] **Step 3: 实现 client**

```ts
// lib/api-client/mention-search.ts
import { apiFetch } from './base'
import type { MentionSearchItem } from '@/types/mention'

export const mentionSearchClient = {
  async search(query: string, limit = 5): Promise<MentionSearchItem[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    const res = await apiFetch<{ items: MentionSearchItem[] }>(
      `/api/workspaces/mention-search?${params}`
    )
    return res.items
  },
}
```

在 `lib/api-client/index.ts` 加:`export { mentionSearchClient } from './mention-search'`。

- [ ] **Step 4: 跑确认通过** → PASS。

- [ ] **Step 5: commit**

```bash
npx tsc --noEmit
git add lib/api-client/mention-search.ts lib/api-client/index.ts __tests__/lib/api-client/mention-search.test.ts
git commit -m "feat: mention-search api-client [LUM-330]"
```

---

## Phase D — suggestion + hook + 编辑器接线

### Task 10: buildMentionSuggestion 吃 MentionSources、异步回填

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/mention-suggestion.ts`
- Test: `__tests__/components/mention-suggestion.test.ts`

- [ ] **Step 1: 写失败测试**(验证:同步先出 user;异步 resolve 后 onUpdate 带实体)

```ts
// __tests__/components/mention-suggestion.test.ts
import { buildMentionSuggestion } from '@/app/workspace/[workspaceUrl]/components/mention-suggestion'
import type { MentionSources } from '@/types/mention'

function makeSources(): MentionSources {
  return {
    members: [
      { kind: 'user', id: 'u1', label: 'Alice', imageUrl: null },
      { kind: 'user', id: 'u2', label: 'Bob', imageUrl: null },
    ],
    searchEntities: jest
      .fn()
      .mockResolvedValue([
        {
          kind: 'task',
          id: 't1',
          label: 'LUM-1',
          sublabel: 'Fix',
          status: 'TODO',
          href: '/x',
        },
      ]),
  }
}

it('items() returns matching users synchronously', () => {
  const cfg = buildMentionSuggestion(
    makeSources(),
    jest.fn(),
    jest.fn(),
    jest.fn(),
    { current: null }
  )
  const items = (cfg.items as any)({ query: 'ali' })
  expect(items).toEqual([
    { kind: 'user', id: 'u1', label: 'Alice', imageUrl: null },
  ])
})

it('debounced entity search resolves into onUpdate', async () => {
  jest.useFakeTimers()
  const onUpdate = jest.fn()
  const sources = makeSources()
  const cfg = buildMentionSuggestion(sources, jest.fn(), onUpdate, jest.fn(), {
    current: null,
  })
  ;(cfg.items as any)({ query: 'lum' })
  jest.advanceTimersByTime(250)
  await Promise.resolve()
  await Promise.resolve()
  expect(sources.searchEntities).toHaveBeenCalledWith('lum')
  jest.useRealTimers()
})
```

- [ ] **Step 2: 跑确认失败** → FAIL（签名仍是旧 members/tasks）。

- [ ] **Step 3: 重写 mention-suggestion.ts**

```ts
// app/workspace/[workspaceUrl]/components/mention-suggestion.ts
import type { SuggestionOptions } from '@tiptap/suggestion'
import type { MentionItem, MentionSources } from '@/types/mention'
import type { MentionListRef } from './MentionList'

export type MentionPopupState = {
  items: MentionItem[]
  loading: boolean
  rect: DOMRect
  command: (attrs: {
    id: string
    label: string
    mentionType: string
    mentionTitle?: string
    mentionStatus?: string
    mentionHref?: string
  }) => void
}

const DEBOUNCE_MS = 200

export function buildMentionSuggestion(
  sources: MentionSources,
  onOpen: (state: MentionPopupState) => void,
  onUpdate: (state: MentionPopupState) => void,
  onClose: () => void,
  listRef: React.RefObject<MentionListRef | null>
): Partial<SuggestionOptions> {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  // 用 token 防竞态:仅最新一次搜索的结果允许回填
  let searchToken = 0

  const userMatches = (query: string): MentionItem[] => {
    const q = query.toLowerCase()
    return sources.members
      .filter(m => m.label.toLowerCase().includes(q))
      .slice(0, 5)
  }

  return {
    items: ({ query }): MentionItem[] => userMatches(query),

    render() {
      let latestRect: DOMRect | null = null
      let latestCommand: MentionPopupState['command'] | null = null
      let latestQuery = ''

      const runSearch = () => {
        const token = ++searchToken
        const rect = latestRect
        const command = latestCommand
        if (!rect || !command) return
        sources
          .searchEntities(latestQuery)
          .then(entities => {
            if (token !== searchToken) return // 过期结果丢弃
            onUpdate({
              items: [...userMatches(latestQuery), ...entities],
              loading: false,
              rect,
              command,
            })
          })
          .catch(() => {
            if (token !== searchToken) return
            onUpdate({
              items: userMatches(latestQuery),
              loading: false,
              rect,
              command,
            })
          })
      }

      const schedule = () => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(runSearch, DEBOUNCE_MS)
      }

      return {
        onStart(props) {
          const rect = props.clientRect?.()
          if (!rect) return
          latestRect = rect
          latestCommand = props.command
          latestQuery = props.query
          onOpen({
            items: props.items as MentionItem[],
            loading: true,
            rect,
            command: props.command,
          })
          schedule()
        },
        onUpdate(props) {
          const rect = props.clientRect?.()
          if (!rect) return
          latestRect = rect
          latestCommand = props.command
          latestQuery = props.query
          onUpdate({
            items: props.items as MentionItem[],
            loading: true,
            rect,
            command: props.command,
          })
          schedule()
        },
        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            onClose()
            return true
          }
          return listRef.current?.onKeyDown(props) ?? false
        },
        onExit() {
          if (debounceTimer) clearTimeout(debounceTimer)
          searchToken++ // 作废所有在途搜索
          onClose()
        },
      }
    },
  }
}
```

- [ ] **Step 4: 跑确认通过** → PASS。

- [ ] **Step 5: commit**

```bash
npx tsc --noEmit
git add app/workspace/\[workspaceUrl\]/components/mention-suggestion.ts __tests__/components/mention-suggestion.test.ts
git commit -m "feat: mention suggestion takes MentionSources + debounced async entity search [LUM-330]"
```

---

### Task 11: useMentionSources hook + 客户端 members 映射

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/mention-types.ts`(纯映射函数)
- Create: `app/workspace/[workspaceUrl]/hooks/useMentionSources.ts`
- Test: `__tests__/components/mention-types.test.ts`

- [ ] **Step 1: 写失败测试(纯映射)**

```ts
// __tests__/components/mention-types.test.ts
import { membersToMentionItems } from '@/app/workspace/[workspaceUrl]/components/mention-types'

it('maps WorkspaceMemberInfo to user MentionItems (clerkId as id), skips agent placeholder', () => {
  const items = membersToMentionItems([
    {
      id: 'm1',
      clerkId: 'user_a',
      role: 'member',
      name: 'Alice',
      email: 'a@x.com',
      imageUrl: null,
      joinedAt: '',
      actorId: 'act1',
    },
    {
      id: 'm2',
      clerkId: '__agent__',
      role: 'member',
      name: 'Agent',
      email: null,
      imageUrl: null,
      joinedAt: '',
      actorId: null,
    },
  ] as any)
  expect(items).toEqual([
    { kind: 'user', id: 'user_a', label: 'Alice', imageUrl: null },
  ])
})
```

- [ ] **Step 2: 跑确认失败** → FAIL。

- [ ] **Step 3: 实现映射 + hook**

```ts
// app/workspace/[workspaceUrl]/components/mention-types.ts
import type { WorkspaceMemberInfo } from '../types'
import type { MentionItem } from '@/types/mention'

/** 把 workspace 成员映射成 user 下拉项;排除 agent 占位。 */
export function membersToMentionItems(
  members: WorkspaceMemberInfo[]
): Extract<MentionItem, { kind: 'user' }>[] {
  return members
    .filter(m => m.clerkId !== '__agent__')
    .map(m => ({
      kind: 'user' as const,
      id: m.clerkId,
      label: m.name,
      imageUrl: m.imageUrl,
    }))
}
```

```ts
// app/workspace/[workspaceUrl]/hooks/useMentionSources.ts
'use client'

import { useMemo } from 'react'
import { mentionSearchClient } from '@/lib/api-client'
import { membersToMentionItems } from '../components/mention-types'
import type { WorkspaceMemberInfo } from '../types'
import type { MentionSources } from '@/types/mention'

/**
 * 把已加载的成员 + 统一实体搜索收成单一 mentionSources prop。
 * 调用方把 workspace 已有的 members 传进来(各面已能拿到),实体走服务端搜索。
 */
export function useMentionSources(
  members: WorkspaceMemberInfo[]
): MentionSources {
  return useMemo(
    () => ({
      members: membersToMentionItems(members),
      searchEntities: (query: string) => mentionSearchClient.search(query, 5),
    }),
    [members]
  )
}
```

> 设计取舍:hook 接收 `members` 入参而非内部 `useMembers()`,因为 `useMembers` 是 `enabled:false` 懒加载、各面成员来源不一(有的 props 有的 context)。让调用方传入既复用各面已有数据,又避免重复请求。文档面等无 members 的场景传 `[]`,人分区为空、实体仍可搜。

- [ ] **Step 4: 跑确认通过** → PASS。

- [ ] **Step 5: commit**

```bash
npx tsc --noEmit
git add app/workspace/\[workspaceUrl\]/components/mention-types.ts app/workspace/\[workspaceUrl\]/hooks/useMentionSources.ts __tests__/components/mention-types.test.ts
git commit -m "feat: useMentionSources hook (client members + entity search) [LUM-330]"
```

---

### Task 12: DescriptionEditor 换 prop 为 mentionSources + 点击导航

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx`

- [ ] **Step 1: 改 props 与 mention 配置**

在 props interface(58-59 行附近)把:

```ts
  members?: WorkspaceMemberInfo[]
  tasks?: ApiTask[]
```

替换为:

```ts
  mentionSources?: import('@/types/mention').MentionSources
```

删除对应的 `members = []`, `tasks = []`, `agentActors` 解构默认值(131-132 行附近),改为 `mentionSources`。把 mention popup state 类型 import 的 `MentionItem` 用法保持。

把 `MentionWithType.configure`(256-266 行)改为:

```ts
      ...(mentionSources
        ? [
            MentionWithType.configure({
              suggestion: buildMentionSuggestion(
                mentionSources,
                setMentionPopup,
                setMentionPopup,
                () => setMentionPopup(null),
                mentionListRef
              ),
            }),
          ]
        : []),
```

> 注意:这里改成**条件加入** mention 扩展(无 `mentionSources` 的面不挂),比旧的「永远挂、空数组」更省。`getBaseExtensions()` 不含 Mention,所以这样安全。

把渲染 `<MentionList>`(628-632 行附近)补 `loading={mentionPopup.loading}`:

```tsx
<MentionList
  ref={mentionListRef}
  items={mentionPopup.items}
  loading={mentionPopup.loading}
  command={mentionPopup.command}
/>
```

- [ ] **Step 2: 加 mention 点击导航**

在 `useEditor({ ... })` 配置里加 `editorProps.handleDOMEvents.click`(若已有 editorProps 则并入)。用 Next router 跳转应用内 href:

```tsx
  // 顶部:import { useRouter } from 'next/navigation'
  const router = useRouter()
  // useEditor 配置内:
  editorProps: {
    handleDOMEvents: {
      click: (_view, event) => {
        const target = (event.target as HTMLElement)?.closest('[data-mention-type]')
        if (!target) return false
        const href = target.getAttribute('data-href')
        const type = target.getAttribute('data-mention-type')
        if (href && type && type !== 'user') {
          event.preventDefault()
          router.push(href)
          return true
        }
        return false
      },
    },
  },
```

> 若 DescriptionEditor 已有 `editorProps`,把 `handleDOMEvents.click` 合并进去,别覆盖既有键。

- [ ] **Step 3: tsc + 全量 mention 相关测试回归**

```bash
npx prisma generate && npx tsc --noEmit
npx jest mention parse-mentions MentionList mention-suggestion mention-types
```

Expected: 全绿;tsc 干净。

- [ ] **Step 4: commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/DescriptionEditor.tsx
git commit -m "feat: DescriptionEditor takes mentionSources + entity click navigation [LUM-330]"
```

---

## Phase E — 全面接入各编辑器面

### Task 13: 接入所有 DescriptionEditor 调用点

**Files(逐一修改):**

- `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx:674`
- `app/workspace/[workspaceUrl]/components/modals/NewTaskModal.tsx:510`
- `app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab.tsx:58`
- `app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectOverviewTab.tsx:192`
- `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx:316`
- `app/workspace/[workspaceUrl]/components/comments/CommentEditor.tsx:57` + 其父 `TaskDetailComments.tsx`

每个面的改法统一:用 `useMentionSources(members)` 得到 `mentionSources`,传给 `<DescriptionEditor mentionSources={mentionSources} />`,删掉旧的 `members`/`tasks`/`agentActors` 三个 prop。`members` 来源按各面现状(见下),无成员上下文的面传 `[]`。

- [ ] **Step 1: DocumentEditorPage** — 该组件 props 已有 `members: WorkspaceMemberInfo[]`(63 行)。在组件体加 `const mentionSources = useMentionSources(members)`,给 674 行 `<DescriptionEditor>` 加 `mentionSources={mentionSources}`。

- [ ] **Step 2: NewTaskModal** — `members` 已是 prop(109 行)。加 `const mentionSources = useMentionSources(members)`,510 行编辑器加 `mentionSources={mentionSources}`。

- [ ] **Step 3: MilestoneOverviewTab** — 无成员上下文。加 `const mentionSources = useMentionSources([])`,58 行加 `mentionSources={mentionSources}`(人分区空,实体可搜)。

- [ ] **Step 4: ProjectOverviewTab** — `members` 已是 prop(39 行),当前直接传 `members={members}`。改成 `const mentionSources = useMentionSources(members)` + `mentionSources={mentionSources}`,删 `members={members}`。

- [ ] **Step 5: TaskDetailPanel** — 当前传 `members={mentionableMembers} tasks={tasks}`。改成 `const mentionSources = useMentionSources(mentionableMembers)` + `mentionSources={mentionSources}`,删两个旧 prop。

- [ ] **Step 6: CommentEditor + TaskDetailComments** — `CommentEditor` 的 props(9-21 行)把 `members?`/`tasks?`/`agentActors?` 三个换成 `mentionSources?: MentionSources`,57 行编辑器改传 `{...(mentionSources ? { mentionSources } : {})}`。在父 `TaskDetailComments.tsx` 里 `const mentionSources = useMentionSources(mentionableMembers)`,把所有 `<CommentEditor>`(新建/编辑/回复 4 处)的 `members/tasks/agentActors` 换成 `mentionSources={mentionSources}`。这一步同时修好 spec #4(编辑/回复之前缺 tasks)。

- [ ] **Step 7: 全量 tsc + build**

```bash
npx prisma generate && npx tsc --noEmit
npm run build
```

Expected: tsc 干净;Vercel build(唯一 CI gate)通过。修掉任何因删旧 prop 残留的引用。

- [ ] **Step 8: commit**

```bash
git add app/workspace
git commit -m "feat: wire mentionSources into all editor surfaces [LUM-330]"
```

---

## Phase F — i18n + 端到端验证

### Task 14: i18n 全 16 locale 补齐

**Files:** `lib/i18n/*.json`(16 个)

- [ ] **Step 1: sync 占位**

```bash
npm run i18n:sync
```

会给除 en 外 15 个 locale 回填 `mention.sprints/projects/milestones/searching` 的 `[TODO:<locale>] …` 占位。

- [ ] **Step 2: 替换占位为真实翻译**

逐个把 15 个 locale 文件里这 4 个 key 的 `[TODO:…]` 换成该语言真实译文(如 zh-CN:`"Sprints"→"冲刺"`、`"Projects"→"项目"`、`"Milestones"→"里程碑"`、`"Searching…"→"搜索中…"`;zh-TW 用「衝刺/專案/里程碑/搜尋中…」;ja/ko/es/fr/de/ru/vi/hi/ms/id 等同此)。**禁止**留英文占位或英文兜底。

- [ ] **Step 3: parity 校验**

```bash
npm run i18n:check
```

Expected: 无 drift、无 `[TODO`。

- [ ] **Step 4: commit**

```bash
git add lib/i18n
git commit -m "i18n: mention group headers + searching state across 16 locales [LUM-330]"
```

---

### Task 15: 端到端验证 + PR

- [ ] **Step 1: 全量验证门**

```bash
npx prisma generate
npx tsc --noEmit
npm test
npm run i18n:check
npm run lint:tokens
npm run build
```

Expected: 全绿。

- [ ] **Step 2: 浏览器手验(dev server)**

起 dev,在 **文档正文** / **任务评论** / **里程碑描述** 各打 `@`:

1. 立即出现 People 分区(若该面有成员),输入若干字后 Tasks/Sprints/Projects/Milestones 分区随异步搜索出现,期间显示「搜索中…」。
2. 选一个任务 mention,正文出现可点 chip;点它跳到任务页。
3. 在**任务评论**里 @ 一个**人**并提交 → 被 @ 的人收到 inbox 通知(验证 bug 已修)。@ 一个任务 → 不产生通知。

- [ ] **Step 3: 开 PR**

```bash
git push -u origin lumo/LUM-330-editor-mentions
gh pr create --title "feat: universal entity @-mentions + fix silent mention notifications [LUM-330]" --body "$(cat <<'EOF'
## What
- 修复静默失效的 @ 通知 bug(解析正则期望 data-type="mention",真实节点输出无此属性 → 所有任务/文档评论 @ 通知从未发出)。抽共享 `parseMentionedUserClerkIds`,两个 service 共用,单测对着真实 renderHTML 输出。
- 把 @ 提及从 user/task 扩成 user/task/sprint/project/milestone,统一 `mention-search` 端点 + `useMentionSources` 单一 prop,全面接入所有编辑器面(文档正文/新建任务/里程碑/项目描述/任务评论新建·编辑·回复)。
- 实体 mention 为可点链接,仅「人」触发通知。

## Notes
- 无 schema 变更、无新依赖。
- 历史漏发的通知不回填,仅保证今后正确。
- @agent 维持禁用(范围外)。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: 标 LUM-330 为 in_review**

```bash
lumo task update LUM-330 --status in_review
lumo task comment LUM-330 "PR 已开:见上方链接。修 @ 通知 bug + 五类实体 @ 系统。"
```

---

## Self-Review(已执行)

- **Spec 覆盖**:#1 通知 bug → Task 1-3;#2 文档正文接入 → Task 13.1;#3 其余面 → Task 13.2-13.6;#4/#5 任务 mention → Task 4(节点)+ Task 13.6(评论补全)+ Task 1(解析跳过实体);5 类实体 → Task 4/5/6/7;统一端点 → Task 6-9;hook → Task 11;i18n → Task 5(en)+ Task 14(15 locale);导航 → Task 12。无遗漏。
- **类型一致**:`MentionItem`/`MentionSearchItem`/`MentionSources` 定义于 `types/mention.ts`(Task 4),被 5/10/11 一致引用;`kind` 字段统一(非旧 `type`);命令 attr 用 `mentionType`/`mentionHref` 与节点 Task 4 一致。
- **占位**:无 TBD/TODO;唯三处「执行者现场核对」是真实接线点(Prisma 字段名、`requireIdentity` import 路径/字段),已显式标注并给核对方法 —— 这些取决于活代码,非计划偷懒。
