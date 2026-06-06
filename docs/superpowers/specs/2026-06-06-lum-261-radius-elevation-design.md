# LUM-261 — 圆角档位与 Elevation 体系

**Status**: Approved (design)
**Milestone**: Design System Rework
**Date**: 2026-06-06

## Problem

`app/globals.css` 已用 `--radius: 0.75rem` 派生 `--radius-sm/md/lg/xl`,但实际使用混乱:

- **裸 `rounded`**(= Tailwind 内置默认 `0.25rem`,绕过 token)有 **130 处**,而它比 `rounded-sm`(`0.5rem`)还小 —— 档位倒挂、语义不清。
- 圆角档位无"哪类元素用哪档"的规则;`landing.css` 另用 `--radius: 0.625rem` 分叉。
- 阴影**完全没有 token / elevation 语义**(仅 landing 的 `--shadow-mockup`):全部直接用 Tailwind 内置 `shadow-xs`…`shadow-2xl`,凭感觉选;另有 **2 处硬编码 box-shadow `shadow-[...]`**(均在 `sidebar/menu.tsx:50`)。`components/landing/.../stats/default.tsx:58` 的 `drop-shadow-[2px_1px_24px_var(--brand-foreground)]` 是 **filter**(非 box-shadow)、已正确用 `var()`,不在收敛范围。

阴影使用分布(app+components+lib):`shadow-lg`×22、`shadow-md`×16、`shadow-xs`×12、`shadow-sm`×12、裸 `shadow`×11、`shadow-xl`×6、`shadow-2xl`×4。

### 顺带发现的潜在 bug

`components/ui/sidebar/menu.tsx:50` 的 `shadow-[0_0_0_1px_hsl(var(--sidebar-border))]`:LUM-257 把 token 迁到 **oklch** 后,`hsl(var(--sidebar-border))` 是非法 CSS,这条 1px 描边已被浏览器静默丢弃(命中 `hsl(var())` 铁律)。本任务一并修掉。

## Goals

1. 定义干净的圆角档位规则(哪类元素用哪档),消除裸 `rounded`。
2. 建立 token 化的 elevation 分级语义(`shadow-elevation-1/2/3`,暗色单独调强)。
3. 消除硬编码 `shadow-[...]`。
4. 规则文档化 + 接入 lint 防回流;核心组件改用规范档位。

## Non-Goals

- 不一次性扫完全部 130 处裸 `rounded` 和全部裸 shadow —— 存量进 lint baseline,后续渐进。本 PR 只改 `components/ui/*` 核心原子组件 + 3 处硬编码。
- 不改 `--radius` 基准值(`0.75rem` 不动,保持核心表面圆角零视觉变化)。
- 不收敛 landing 的 `--radius: 0.625rem` 分叉(landing 自有 token 体系,超出本任务范围)。

## Design

### ① 圆角 token(`app/globals.css`)

保留 `--radius: 0.75rem` 作单一来源,只把 `@theme inline` 里的 calc 偏移调成干净的 **4px 步进**:

| 档位          | 现值                           | 新值                                    | px   |
| ------------- | ------------------------------ | --------------------------------------- | ---- |
| `--radius-sm` | `calc(--radius − 4px)` = 0.5   | `calc(--radius − 8px)` = **0.25rem**    | 4px  |
| `--radius-md` | `calc(--radius − 2px)` = 0.625 | `calc(--radius − 4px)` = **0.5rem**     | 8px  |
| `--radius-lg` | `var(--radius)` = 0.75         | `var(--radius)` = **0.75rem**(不变)     | 12px |
| `--radius-xl` | `calc(--radius + 4px)` = 1     | `calc(--radius + 4px)` = **1rem**(不变) | 16px |

> 净效果:`rounded-sm` 由 0.5→0.25,`rounded-md` 由 0.625→0.5;`lg`/`xl` 不变。控件/小件略微收紧,表面零变化。

### ② 圆角档位映射规则(3 个工作档)

| 元素类                                                  | 档位           | 值         |
| ------------------------------------------------------- | -------------- | ---------- |
| inline 小件:chip / badge / tag / 内联 token             | `rounded-sm`   | 0.25rem    |
| 控件:button / input / select / dropdown-item            | `rounded-md`   | 0.5rem     |
| 表面:card / dialog / popover / dropdown / sheet / panel | `rounded-lg`   | 0.75rem    |
| pill / 头像 / 圆形图标按钮                              | `rounded-full` | 9999px     |
| 大容器 / 特例                                           | `rounded-xl`   | 1rem(保留) |

裸 `rounded` 永久禁用(其值现等于 `rounded-sm`,语义重复)。方向性圆角(`rounded-t/l/r/b/tl…`)不受规则约束,按需使用。

### ③ Elevation token(`app/globals.css`)

`:root` 与 `.dark` 各定义一组(暗色更强 —— 深色背景上阴影几乎不可见),`@theme inline` 注册成工具类 `shadow-elevation-1/2/3`。利用 colors 同款间接引用,使 `.dark` 覆盖在运行时生效:

```css
:root {
  --elevation-1: 0 1px 2px 0 rgb(0 0 0 / 0.06), 0 1px 3px 0 rgb(0 0 0 / 0.1);
  --elevation-2:
    0 2px 4px -1px rgb(0 0 0 / 0.08), 0 4px 8px -1px rgb(0 0 0 / 0.12);
  --elevation-3:
    0 8px 16px -4px rgb(0 0 0 / 0.12), 0 12px 24px -6px rgb(0 0 0 / 0.18);
}
.dark {
  --elevation-1: 0 1px 2px 0 rgb(0 0 0 / 0.4), 0 1px 3px 0 rgb(0 0 0 / 0.5);
  --elevation-2:
    0 2px 4px -1px rgb(0 0 0 / 0.45), 0 4px 8px -1px rgb(0 0 0 / 0.55);
  --elevation-3:
    0 8px 16px -4px rgb(0 0 0 / 0.55), 0 12px 24px -6px rgb(0 0 0 / 0.65);
}
@theme inline {
  --shadow-elevation-1: var(--elevation-1); /* → utility .shadow-elevation-1 */
  --shadow-elevation-2: var(--elevation-2);
  --shadow-elevation-3: var(--elevation-3);
}
```

> 数值是按 Tailwind 内置 sm/md/lg 比例推导的基线,合并后可在真机微调;结构(双层 + 偏移)固定。raw `rgb(...)` 出现在 token 定义处属允许(token source),不受 color-lint 约束。

### ④ Elevation 映射(3 级按交互层级)

| 级别                 | 用途     | 组件                                                   | ≈旧值     |
| -------------------- | -------- | ------------------------------------------------------ | --------- |
| `shadow-elevation-1` | 静态抬起 | card / panel / sticky header                           | shadow-sm |
| `shadow-elevation-2` | 锚定浮层 | popover / dropdown / hovercard / select / context-menu | shadow-md |
| `shadow-elevation-3` | 顶级浮层 | dialog / sheet / command 面板 / toast                  | shadow-lg |

### ⑤ Lint 接入(`scripts/lint-tokens.ts`,baseline 模式)

新增规则,存量进 `lint-tokens.baseline.json`、只挡新增违规(与 color-lint 同节奏):

- ❌ 裸 `rounded`(无档位后缀)—— 必须用 `rounded-{sm,md,lg,xl,full}` 或方向性档位。
- ❌ 硬编码 `shadow-[...]`。
- ❌ Tailwind 内置 `shadow` / `shadow-xs` / `shadow-sm` / `shadow-md` / `shadow-lg` / `shadow-xl` / `shadow-2xl` —— 改用 `shadow-elevation-*`(`shadow-none` 允许)。

实现注意:正则需精确匹配 class token 边界,避免误伤 `rounded-md`(对裸 `rounded`)、`shadow-elevation-1`/`shadow-none`/`shadow-mockup`(对裸 shadow 族)、以及 `drop-shadow-*`(filter,前缀有 `-`,用负向后顾 `(?<![-\w])` 排除)。`rounded-[..]` / `drop-shadow-[..]` 等带前缀或方向的 arbitrary 值不在禁用之列。先跑 `lint:tokens:update` 重建 baseline 吸收存量,再确认核心组件改动不引入新增。

### ⑥ 迁移范围(本 PR)

- `components/ui/*` 核心原子组件改用新档位 + `shadow-elevation-*`:card / dialog / popover / dropdown-menu / sheet / button / input / badge / sidebar/menu / tooltip / command 等(凡含 radius/shadow 的原子组件)。
- 修 2 处硬编码 box-shadow `shadow-[...]`:`components/ui/sidebar/menu.tsx:50` ×2 → 改 `ring-1 ring-sidebar-border` + `hover:ring-sidebar-accent`(同时修掉 oklch 后 `hsl(var())` 失效的描边 bug)。
- landing `stats/default.tsx` 的 `drop-shadow-[...]`(filter,用 var 合法)保持不动。
- 其余存量进 baseline,后续渐进收敛。

### ⑦ 文档(`docs/design-system.md`)

把现有的描述性 **Radius** 与 **Shadows** 小节重写为**规范**:档位映射表(②)、elevation 映射表(④)、lint 规则说明(⑤)。

## Testing

- **globals.css token 守护测试**(仿 `__tests__/styles/globals-css-color-tokens.test.ts`):断言 `--radius-sm/md/lg/xl` 的 calc 表达式、`--elevation-1/2/3` 在 `:root` 与 `.dark` 均定义且暗色 alpha 更高、`@theme inline` 注册了 `--shadow-elevation-*`。
- **lint-tokens 新规则单测**(扩 `__tests__/scripts/lint-tokens.test.ts`):裸 `rounded` 命中、`rounded-md` 不命中;硬编码 `shadow-[...]` 命中;裸 `shadow-md` 命中、`shadow-elevation-2`/`shadow-none` 不命中。
- `npx tsc --noEmit` 无错;`npm run lint:tokens` 不因核心组件改动而 regression。
- 视觉:本环境 preview 浏览器够不到 dev server —— 以 token 守护测试 + 组件单测 + lint 为验证手段(参照既往设计系统任务)。

## Acceptance

- [ ] radius/elevation 规则在 `docs/design-system.md` 文档化。
- [ ] `--radius-sm/md/lg/xl` 调为 4px 步进;裸 `rounded` 不再用于核心组件。
- [ ] `shadow-elevation-1/2/3` token + 工具类落地,暗色单独调强。
- [ ] 核心原子组件改用规范档位 + elevation。
- [ ] 2 处硬编码 box-shadow `shadow-[...]` 消除(含 sidebar oklch 描边 bug)。
- [ ] lint-tokens 接入新规则 + baseline;新增违规被拦截。
- [ ] 守护测试 + lint 单测通过;`tsc --noEmit` 干净。
