# LUM-284 — 动效 token（duration/easing）并收敛散落时长

**Milestone:** Design System Rework
**Status:** Design approved, pending spec review → writing-plans
**Date:** 2026-06-06

## 问题

- `app/globals.css` 没有 `--duration` / `--ease` token。
- 组件散落 `duration-100/120/150/200/300/500`；`globals.css` 里 transition 时长硬编码 `0.12s / 0.15s / 0.3s`。
- 动效语言无单一来源，时长/缓动靠各处手写，易漂移、不可统一调参。

## 目标 / 验收

- 定义 `--duration-fast/base/slow` + `--ease-*` token，经 `@theme` 暴露为 Tailwind utility。
- 核心交互（hover / 弹层 / 折叠 / 高亮）改用 token。
- 动效时长/缓动单一来源；防回归守卫存在。

## 范围决策

- **仅 app 业务代码。** `components/ui/*`（vendored shadcn：dialog/sheet/alert-dialog/navigation-menu/sidebar/item）与 `components/landing/*` 保持原样——与 LUM-264 颜色迁移把 vendored/landing 列为例外一致，避免 upstream 同步冲突。
- duration 三档：`fast=150ms / base=200ms / slow=300ms`；现状 100/120ms 向 fast 收齐，500ms 仅存在于 vendored sheet（不在范围内）。
- ease 两档语义 token：`standard` + `emphasized`；`linear` 等沿用 Tailwind v4 内置。

## 技术依据（已验证）

Tailwind v4.2.2 的 functional utility：

- `duration-*` 的命名值从 `--transition-duration-*` theme namespace 解析（`valueThemeKeys: ["--transition-duration"]`）。
- `ease-*` 从 `--ease-*` 解析（`themeKeys: ["--ease"]`），v4 内置 `ease-in/out/in-out/linear`。

因此纯 `@theme` 注册即可生成原生 utility，**不需要** `@utility` 自定义或 `duration-[var(--…)]` 任意值写法，与现有 color/typography token 注册方式完全一致。

## 设计

### 1. Token 定义（`app/globals.css` 的 `@theme inline` 块内）

紧贴现有 color/typography token 注册处新增：

```css
/* Motion tokens (LUM-284): single source for transition duration and easing.
   duration-* utilities resolve named values from --transition-duration-*;
   ease-* utilities from --ease-* (Tailwind v4 native namespaces).
     duration-fast  : hover / color / small state changes
     duration-base  : default; popover / dropdown / menus
     duration-slow  : collapse-expand / highlight fade / larger moves
     ease-standard  : calm decelerate; default for most transitions
     ease-emphasized: snappier settle; entering surfaces */
--transition-duration-fast: 150ms;
--transition-duration-base: 200ms;
--transition-duration-slow: 300ms;
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-emphasized: cubic-bezier(0.32, 0.72, 0, 1);
```

生成 utility：`duration-fast/base/slow`、`ease-standard/emphasized`。

- 两条缓动均**无 overshoot**，对 layout 属性安全。
- 备选：若需 emphasized 带回弹，改 `cubic-bezier(0.34, 1.56, 0.64, 1)`（spec review 时可调）。
- 注释中**不得**出现 `{` `}` 或字面量 `@theme inline`——`__tests__/styles/` 守卫用 `[^}]*` + `indexOf('@theme inline')` 解析，会被误伤（见过往 globals.css 守卫坑）。

### 2. 收敛散落时长（仅 app 业务代码）

组件（6 处）：

| 文件 | 现状 | 改为 |
|---|---|---|
| `app/workspace/[workspaceUrl]/components/TaskDetailComments.tsx:113,290` | `transition-colors duration-300` | `duration-slow` |
| `app/workspace/[workspaceUrl]/components/comments/CommentItem.tsx:64` | `transition-colors duration-300` | `duration-slow` |
| `app/workspace/[workspaceUrl]/components/comments/ReplyItem.tsx:76` | `transition-colors duration-300` | `duration-slow` |
| `app/workspace/[workspaceUrl]/components/document/GlobalDocTree.tsx:181` | `transition-all duration-150` | `duration-fast` |
| `app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx:469` | `transition-transform duration-150` | `duration-fast` |

`globals.css` 硬编码（4 处，均为 app 编辑器/文档 UI）：

| 选择器 | 现状 | 改为 |
|---|---|---|
| `.code-block-language-select` | `opacity 0.12s ease-in-out` | `opacity var(--transition-duration-fast) var(--ease-standard)` |
| `.toggle-chevron` | `transform 0.15s ease` | `transform var(--transition-duration-fast) var(--ease-standard)` |
| `.toc-scroll::-webkit-scrollbar-thumb` | `background 0.3s ease` | `background var(--transition-duration-slow) var(--ease-standard)` |
| `.comment-highlight--active` | `background-color 0.3s ease` | `background-color var(--transition-duration-slow) var(--ease-standard)` |

**明确不动**：`components/ui/*`、`components/landing/*`。

### 3. 防回归守卫测试

新增 `__tests__/styles/motion-tokens.test.ts`，仿现有把 globals.css 当文本解析的守卫：

- 断言 `@theme inline` 块内存在 `--transition-duration-fast/base/slow`，值匹配 `\d+ms`。
- 断言存在 `--ease-standard` / `--ease-emphasized`，值匹配 `cubic-bezier(...)`。
- **不**扩展 `lint:tokens` 去拦截 raw `duration-150/300`（易误伤 vendored/landing，且边界判定复杂）——只做 token 存在性守卫。

## 验证

- `npx tsc --noEmit`（worktree 内，generate+tsc 原子化一次性收尾）。
- `cd` 进 worktree 跑**完整** `__tests__/styles/` 套件（globals.css 一改即跑全套）。
- 相关组件测试（评论高亮 / doc tree / task-columns）保持绿。
- 视觉无回归：fast/base/slow 与原 150/200/300 数值对齐，缓动从 `ease`/`ease-in-out` 收敛到 `ease-standard`（计算曲线接近，非像素级一致但语义统一）。

## 非目标（YAGNI）

- 不迁移 vendored shadcn / landing 时长。
- 不扩展 lint:tokens 拦截 raw duration。
- 不引入 motion/动画库或 prefers-reduced-motion 处理（另议）。
