# LUM-226 文档选区锚定评论 — Plan #2（编辑器层：CommentMark + bubble 动作）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Tiptap 编辑器里支持文档评论锚点：一个 `CommentMark` 标记把 `<span data-comment-id>` 渲染成高亮文本，并提供 `setComment(id)` / `unsetComment(id)` 命令；在划词 BubbleMenu 上加一个"评论"按钮，点击时把选区 `{from,to,quotedText}` 通过回调上抛给宿主，供后续 UI 接管。

**Architecture:** `CommentMark` 镜像现有 `lib/editor/marks/task-link.ts`，注册进 `getBaseExtensions()`。基础高亮由 `renderHTML` 加 `class="comment-highlight"` 免费获得（无需 decoration）。BubbleMenuBar 加一个 gated 按钮，通过新增的 `onRequestComment` prop（`DescriptionEditor → BubbleMenuBar`）上抛选区，不触碰任务描述编辑器的用法。

**Tech Stack:** Tiptap (`@tiptap/core` Mark）, ProseMirror, React, TypeScript strict, Jest (SWC, jsdom for component test).

**前置依赖（已在 main）:** Plan #1 后端已合并——`lib/editor/comment-mark-html.ts` 的 `data-comment-id` span 契约（`COMMENT_SPAN_SELECTOR = 'span[data-comment-id]'`）就是本计划 mark 的 HTML 形态，两端必须一致。

**Out of scope（后续 plan）:**

- 划词后真正的"创建评论"流程（composer 弹窗、调 api-client、生成 cuid、`editor.chain().setComment(id)` 落 mark、把新 content POST 上去）——**Plan #3**（UI/hook）。
- active/hover 强调高亮、点击联动、scroll-to-flash、孤儿样式的 **ProseMirror decoration 插件**——这些由侧栏 React 状态驱动，放 **Plan #3**。
- @提及通知（Plan #4）、i18n 全量补齐（Plan #5）。本计划只新增 1~2 个编辑器 i18n key（按现有方式落到 en + zh-CN，其余 locale 在 Plan #5 统一补——**在 PR 描述里注明这笔欠账**）。

---

## 关键约定（每个 Task 都遵守）

- 测试 cwd 必须在仓库内：`cd /Users/chaoli/Desktop/lumo/lumo && npx jest <path>`。
- 当前分支应为 `lumo/LUM-226-doc-comments-editor`（已创建，off origin/main）。验证 `git branch --show-current`；NEVER git checkout/switch/reset/stash；只 add/commit 本任务文件。
- TS strict：可选字段 `field?: T | undefined`；数组下标先取值再判空。
- 编辑器测试不实例化完整 `Editor`——断言 mark 的静态属性 / 纯函数（镜像 `__tests__/editor/callout.test.ts`）；组件测试用 mock 的 editor + `fireEvent.mouseDown`（镜像 `__tests__/components/BubbleMenuBarTable.test.tsx`，因为 ToolbarButton 用 `onMouseDown`+`preventDefault`）。
- 改完跑测试通过才 commit；message：`type: desc [LUM-226]` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

## 文件结构

**新建：**

- `lib/editor/marks/comment-mark.ts` — `CommentMark` 标记。
- `__tests__/editor/comment-mark.test.ts` — mark 静态属性 + 命令存在性测试。
- `__tests__/components/BubbleMenuBarComment.test.tsx` — bubble "评论" 按钮组件测试。

**修改：**

- `lib/editor/extensions.ts` — 注册 `CommentMark`。
- `app/globals.css`（或编辑器样式所在文件）— `.comment-highlight` 样式。
- `app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx` — 新增 `onRequestComment` prop + "评论"按钮。
- `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx` — 新增 `onRequestComment` prop 并透传给 BubbleMenuBar。
- `lib/i18n/en.json` + `lib/i18n/zh-CN.json` — 新增 `editor.comment` key（其余 locale 留给 Plan #5）。

---

## Task 1: `CommentMark` 标记 + 注册 + 高亮样式

**Files:**

- Create: `lib/editor/marks/comment-mark.ts`
- Modify: `lib/editor/extensions.ts`
- Modify: 编辑器全局样式文件（见 Step 4）
- Test: `__tests__/editor/comment-mark.test.ts`

- [ ] **Step 1: 先读模板**

读 `lib/editor/marks/task-link.ts`（完整 58 行）确认 `Mark.create` 的写法（`addAttributes`/`parseHTML`/`renderHTML`/`mergeAttributes` 用法）。读 `lib/editor/extensions.ts` 确认 `getBaseExtensions()` 的 import + 数组注册位置（TaskLink 在 import line 18 / 数组 line 54 附近）。读 `__tests__/editor/callout.test.ts` 确认 mock + 静态断言风格。

- [ ] **Step 2: 写失败测试**

```typescript
// __tests__/editor/comment-mark.test.ts
import { CommentMark } from '@/lib/editor/marks/comment-mark'
import { getBaseExtensions } from '@/lib/editor/extensions'

describe('CommentMark', () => {
  it('is a mark named "comment"', () => {
    expect(CommentMark.name).toBe('comment')
    expect(CommentMark.type).toBe('mark')
  })

  it('is not inclusive (typing at the boundary does not extend the mark)', () => {
    // configured via the create() config object
    expect(CommentMark.config.inclusive).toBe(false)
  })

  it('parses span[data-comment-id]', () => {
    const rules = CommentMark.config.parseHTML?.call(CommentMark as never)
    expect(rules).toEqual([{ tag: 'span[data-comment-id]' }])
  })

  it('exposes setComment and unsetComment commands', () => {
    const cmds = CommentMark.config.addCommands?.call(CommentMark as never)
    expect(typeof cmds?.setComment).toBe('function')
    expect(typeof cmds?.unsetComment).toBe('function')
  })

  it('is registered in getBaseExtensions()', () => {
    const names = getBaseExtensions().map(e => e.name)
    expect(names).toContain('comment')
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/editor/comment-mark.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: 实现 `lib/editor/marks/comment-mark.ts`**

```typescript
import { Mark, mergeAttributes } from '@tiptap/core'

export interface CommentMarkOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      /** Apply a comment anchor over the current selection. */
      setComment: (commentId: string) => ReturnType
      /** Remove every comment-anchor span carrying this id across the doc. */
      unsetComment: (commentId: string) => ReturnType
    }
  }
}

export const CommentMark = Mark.create<CommentMarkOptions>({
  name: 'comment',

  // Boundary typing must not extend a comment anchor.
  inclusive: false,
  // Comments may overlap each other and coexist with formatting marks.
  excludes: '',

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: el => el.getAttribute('data-comment-id'),
        renderHTML: attrs =>
          attrs.commentId ? { 'data-comment-id': attrs.commentId } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'comment-highlight',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setComment:
        (commentId: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId }),

      unsetComment:
        (commentId: string) =>
        ({ tr, state, dispatch }) => {
          const markType = state.schema.marks[this.name]
          if (!markType) return false
          let changed = false
          state.doc.descendants((node, pos) => {
            if (!node.isText) return
            const mark = node.marks.find(
              m => m.type === markType && m.attrs.commentId === commentId
            )
            if (mark) {
              tr.removeMark(pos, pos + node.nodeSize, mark)
              changed = true
            }
          })
          if (changed && dispatch) dispatch(tr)
          return changed
        },
    }
  },
})
```

> 注意：`renderHTML` 输出的 `<span data-comment-id=... class="comment-highlight">` 必须与 `lib/editor/comment-mark-html.ts` 的 `'span[data-comment-id]'` 选择器一致——服务端守卫靠它 strip。不要改成别的 tag/属性。

- [ ] **Step 5: 注册进 `getBaseExtensions()`**

`lib/editor/extensions.ts`：加 `import { CommentMark } from './marks/comment-mark'`（与 TaskLink import 同区），并把 `CommentMark,` 加进返回数组（紧邻 `TaskLink,`）。

- [ ] **Step 6: 高亮样式**

找到编辑器全局样式（grep `task-link` 的 class 定义位置，通常 `app/globals.css` 或编辑器专用 css）。在同处加（用语义 token，遵守 lint:tokens，**不要**硬编码调色板色，参考 memory：用 `bg-*/text-*` 语义类或现有高亮变量）：

```css
.comment-highlight {
  background-color: hsl(
    var(--comment-highlight, 48 96% 89%)
  ); /* 若已有 highlight token 用它 */
  border-bottom: 2px solid hsl(var(--comment-highlight-border, 38 92% 50%));
  cursor: pointer;
}
```

> 执行时：先 grep 现有是否已有评论/高亮相关 CSS 变量或 `.highlight` 类可复用；若 `lint:tokens` 报硬编码色，按 memory 用语义 token，必要时 `npm run lint:tokens -- --update` 记录基线并 stage（仅当确属 sanctioned 例外）。

- [ ] **Step 7: 跑测试 + 类型**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/editor/comment-mark.test.ts` → all PASS。
Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit 2>&1 | grep -i "comment-mark\|extensions.ts" || echo clean` → clean。

> 若 `CommentMark.config.inclusive` / `.parseHTML` / `.addCommands` 的访问方式因 Tiptap 版本不同而取不到，改测试为可用的等价静态断言（例如通过 `CommentMark.config` 实际结构），但**不要**放宽 `name === 'comment'` 与"已注册"两条核心断言。

- [ ] **Step 8: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add lib/editor/marks/comment-mark.ts lib/editor/extensions.ts __tests__/editor/comment-mark.test.ts
git add -A  # 若改了 css 文件
git commit -m "feat: CommentMark editor mark + highlight [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: BubbleMenu "评论" 按钮 + `onRequestComment` 透传

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/zh-CN.json`
- Test: `__tests__/components/BubbleMenuBarComment.test.tsx`

- [ ] **Step 1: 先读现状**

读 `BubbleMenuBar.tsx`：确认 props 签名（当前 `{ editor, openLinkInputRef, onInsertImage }`，line ~91）、`selectionEmpty` 的来源（line ~145：`ctx.editor.state.selection.empty`）、以及一个现有 ToolbarButton 调用（line ~409）。读 `app/workspace/[workspaceUrl]/components/bubble-menu/ToolbarButton.tsx` 确认 `title→Tooltip`（无 aria-label，LUM-217）。读 `DescriptionEditor.tsx` 的 props（line ~48-93）与 `createPortal(<BubbleMenuBar .../>)`（line ~539）。读 `__tests__/components/BubbleMenuBarTable.test.tsx` 的 mock-editor 风格。

- [ ] **Step 2: 写失败测试**

```tsx
/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { BubbleMenuBar } from '@/app/workspace/[workspaceUrl]/components/BubbleMenuBar'

// Mock tiptap react state hook to a flat, non-empty-selection state.
jest.mock('@tiptap/react', () => ({
  useEditorState: ({ selector }: { selector: (ctx: unknown) => unknown }) =>
    selector({ editor: mockEditor }),
}))

const mockEditor: any = {
  isEditable: true,
  state: {
    selection: { empty: false, from: 7, to: 12 },
    doc: { textBetween: () => 'brave' },
  },
  isActive: () => false,
  chain: () => ({ focus: () => ({ run: () => true }) }),
}

function renderBar(
  onRequestComment?: (f: number, t: number, q: string) => void
) {
  return render(
    <IntlProvider locale='en' messages={{ 'editor.comment': 'Comment' }}>
      <BubbleMenuBar
        editor={mockEditor}
        openLinkInputRef={{ current: null }}
        onInsertImage={() => {}}
        onRequestComment={onRequestComment}
      />
    </IntlProvider>
  )
}

describe('BubbleMenuBar comment button', () => {
  it('fires onRequestComment with the selection range + quoted text', () => {
    const spy = jest.fn()
    renderBar(spy)
    // ToolbarButton uses Tooltip for the label "Comment"
    const btn = screen.getByRole('button', { name: 'Comment' })
    fireEvent.mouseDown(btn)
    expect(spy).toHaveBeenCalledWith(7, 12, 'brave')
  })

  it('does not render the comment button when onRequestComment is absent', () => {
    renderBar(undefined)
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull()
  })
})
```

> 若 `screen.getByRole('button', { name: 'Comment' })` 因 Tooltip 不暴露 accessible name 而取不到（LUM-217），改用 `data-testid="bubble-comment"` 放到 ToolbarButton 并用 `getByTestId`；相应在实现里加 testid。先按 role 试，取不到再退 testid。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/components/BubbleMenuBarComment.test.tsx`
Expected: FAIL（按钮不存在 / prop 未支持）。

- [ ] **Step 4: 改 `BubbleMenuBar.tsx`**

1. 扩展 props 签名：

```tsx
export function BubbleMenuBar({
  editor,
  openLinkInputRef,
  onInsertImage,
  onRequestComment,
}: {
  editor: Editor
  openLinkInputRef: React.MutableRefObject<(() => void) | null>
  onInsertImage: () => void
  onRequestComment?: ((from: number, to: number, quotedText: string) => void) | undefined
}) {
```

2. 在主工具栏（非 table、非 link-panel 的返回分支）末尾，加一个 gated 按钮（用现有 `Divider`/`ToolbarButton` 与 `intl`，图标用 `lucide-react` 的 `MessageSquare`）：

```tsx
{
  onRequestComment && !state.selectionEmpty && (
    <>
      <Divider />
      <ToolbarButton
        onClick={() => {
          const { from, to } = editor.state.selection
          const quotedText = editor.state.doc.textBetween(from, to, ' ')
          onRequestComment(from, to, quotedText)
        }}
        title={intl.formatMessage({ id: 'editor.comment' })}
      >
        <MessageSquare size={14} />
      </ToolbarButton>
    </>
  )
}
```

> 确认 `state.selectionEmpty` 在该组件的 `useEditorState` selector 里已暴露（line ~145）；若没有则加进 selector。`MessageSquare` 加进现有 lucide import。`Divider`/`ToolbarButton` 用文件里已 import 的。

- [ ] **Step 5: 改 `DescriptionEditor.tsx`**

1. props 接口加：

```ts
  onRequestComment?: (from: number, to: number, quotedText: string) => void
```

2. 透传进 `createPortal` 的 `<BubbleMenuBar .../>`：

```tsx
<BubbleMenuBar
  editor={editor}
  openLinkInputRef={openLinkInputRef}
  onInsertImage={handleInsertImage}
  onRequestComment={onRequestComment}
/>
```

> 任务描述编辑器不传 `onRequestComment` → 按钮不渲染，零影响（LSP/不破坏现有调用方）。

- [ ] **Step 6: i18n key（仅 en + zh-CN）**

`lib/i18n/en.json` 加 `"editor.comment": "Comment"`；`lib/i18n/zh-CN.json` 加 `"editor.comment": "评论"`。其余 14 个 locale 留给 Plan #5（**PR 描述里写明这笔欠账**，避免"全 locale 同步"约定被误判违反）。

- [ ] **Step 7: 跑测试 + 类型**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/components/BubbleMenuBarComment.test.tsx` → PASS。
Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit 2>&1 | tail -15` → 0 error。
Run（若有）：`cd /Users/chaoli/Desktop/lumo/lumo && npm run lint:tokens 2>&1 | tail -5`（Task 1 的 CSS 若触发，处理基线）。

- [ ] **Step 8: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add "app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx" \
        "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx" \
        lib/i18n/en.json lib/i18n/zh-CN.json \
        __tests__/components/BubbleMenuBarComment.test.tsx
git commit -m "feat: bubble-menu comment action wiring [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 收尾验证（全部 Task 后）

- [ ] `cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit` → 0。
- [ ] `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/editor/comment-mark.test.ts __tests__/components/BubbleMenuBarComment.test.tsx` → 全绿。
- [ ] 无 `console.log`；无新 npm 包（`lucide-react`/`@tiptap/core` 已在用）。
- [ ] PR 描述注明：①`editor.comment` 仅加了 en/zh-CN，**其余 14 locale 欠账留 Plan #5**；②本计划是纯编辑器层，创建评论的完整闭环（composer+API+落 mark）在 Plan #3。

## 自查（spec coverage）

| Spec / 设计要求                                             | 本计划                           | 备注                                 |
| ----------------------------------------------------------- | -------------------------------- | ------------------------------------ |
| Tiptap CommentMark（data-comment-id span，inclusive:false） | Task 1                           | 与服务端 strip 选择器一致            |
| 注册进编辑器 + 基础高亮                                     | Task 1（renderHTML class + css） |                                      |
| setComment/unsetComment 命令                                | Task 1                           | Plan #3 创建/删除时调用              |
| BubbleMenu "评论" 按钮 → 上抛选区                           | Task 2（onRequestComment）       |                                      |
| active/hover/orphan decoration + scroll-to                  | ❌ → **Plan #3**（侧栏状态驱动） | 设计原列 Plan #2，重新归到 #3 更内聚 |
| 创建评论闭环（composer/api/落 mark）                        | ❌ → **Plan #3**                 |                                      |
| 全量 i18n                                                   | ❌ → **Plan #5**                 | 本计划仅 en/zh-CN 占位               |
