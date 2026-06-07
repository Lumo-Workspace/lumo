# LUM-290 — 风险/图表组件消费语义色 + 建数据可视化调色板，堵住 brand-palette 漏网

**Date:** 2026-06-06
**Milestone:** Design System Rework
**Status:** Approved

## 背景 / 问题

LUM-258 已建 `--success/--warning/--danger/--info` feedback token，但仍有组件用裸 Tailwind brand 色：

- `RiskBadge` 用 `bg-emerald-50 / text-amber-700 / bg-red-500 / dark:*` 等裸色。
- `CompletionTrendChart` 用 `bg-green-400`；`MemberWorkloadChart` 用 `bg-blue-500`。

`scripts/lint-tokens.ts` 的 `palette` 规则只禁 5 个中性色族（zinc/slate/gray/neutral/stone），**放行所有 brand 色族**，所以 baseline 归零也拦不住这些违规。

## 目标 / 验收

1. RiskBadge 改用 `--success/--warning/--danger`，无裸 brand 色。
2. 为多系列数据可视化建 `--chart-*` 分类调色板，趋势/负载图改用 token。
3. lint 对『图表外』brand-palette 滥用告警（图表用 token 调色板天然豁免）。
4. 风险/趋势/负载组件无裸 brand 色；新调色板有文档与守护测试。

## 设计

### 1. RiskBadge → feedback 语义色（镜像 callout）

`RiskBadge.tsx` 的 `STYLES` 三态重映射，照搬 callout（`globals.css` `.callout[data-variant]`）的 token 用法：`-subtle` 底 + `-border` 边框 + accent 圆点，**文字保持中性 `text-foreground`**。

理由：亮 feedback accent 在自身 `-subtle` 底上对比 ~2:1，做文字色过不了 WCAG AA；callout 本身也用中性文字，色彩信号由底色 + 边框 + 圆点承载。

| 态 | dot | bg | border | text |
|---|---|---|---|---|
| healthy | `bg-success` | `bg-success-subtle` | `border border-success-border` | `text-foreground` |
| watch | `bg-warning` | `bg-warning-subtle` | `border border-warning-border` | `text-foreground` |
| at-risk | `bg-danger` | `bg-danger-subtle` | `border border-danger-border` | `text-foreground` |
| null | `bg-muted-foreground` | `bg-transparent` | （无） | `text-muted-foreground` |

`-subtle`/`-border` 为半透明 `color-mix`，自适应明暗 → 删除全部 `dark:` 变体。

**视觉变化**：标签文字由彩色（emerald-700 等）变为中性 foreground（可访问、与 callout 一致）。

### 2. `--chart-1..5` 分类调色板（对齐 shadcn 约定）

`globals.css` 在 `:root` + `.dark` 各定义 `--chart-1..5`（oklch），5 个区分度高的色相绕色轮铺开；light 压暗 / dark 提亮，**每个都满足 3:1 graphics 对比**（与 status/priority 同档）。`@theme inline` 注册 `--color-chart-1..5`，生成 `bg-chart-*` / `text-chart-*` / `fill-chart-*` / `stroke-chart-*` 工具类。

消费约定（写进 globals.css 注释）：第 `i` 系列用 `--chart-((i-1) % 5 + 1)`；单系列图用 `chart-1`。

- `CompletionTrendChart`：`bg-green-400` → `bg-chart-1`
- `MemberWorkloadChart`：`bg-blue-500` → `bg-chart-1`

确切 oklch 值在 TDD 中调到守护测试转绿。

### 3. lint `brand` 规则 + baseline 快照

`scripts/lint-tokens.ts` 新增 `BRAND_CLASS_RE`，覆盖 brand 色族：
`red/orange/amber/yellow/lime/green/emerald/teal/cyan/sky/blue/indigo/violet/purple/fuchsia/pink/rose`
（**不含** `palette` 已管的中性 5 族；**不含** `chart-*`——那是 token 非 brand 族）。命中记为 `rule: 'brand'`。

- 迁移后图表/RiskBadge 走 token → 0 brand 违规。
- 其余存量（非 allowlist 文件中的 brand 色）用 `npm run lint:tokens -- --update` 快照进 `lint-tokens.baseline.json` 冻结，只拦新增回归——即"堵漏"。
- 已 allowlist 的文件（landing/icons/tag-colors/agent badge/email…）天然豁免，不进 baseline。

### 4. 守护测试

- `__tests__/styles/feedback-contrast.test.ts`：`chart-1..5` 加入 `GRAPHIC_TOKENS`（3:1 on `--background`，双模式）。
- 新增 `__tests__/styles/chart-palette-tokens.test.ts`：`chart-1..5` 在 `:root`+`.dark` 均定义、均 oklch、`@theme` 已注册；CompletionTrendChart/MemberWorkloadChart 用 `bg-chart-*` 非裸 brand 色。
- `token-parity.test.ts` 自动覆盖（chart 在 :root 有 .dark override，无需进 SINGLE_SOURCE_ALLOWLIST）。
- lint 单测：`brand` 规则命中 `bg-blue-500`，放行 `bg-chart-1` 与中性色（中性归 `palette`）。
- RiskBadge 渲染测试：断言无裸 brand 类、走 token。

## 工作流

worktree-per-task（`.worktrees/LUM-290-*`）。TDD：先写/扩守护测试 → 调 token 值与组件到绿 → `tsc --noEmit` + `jest`（worktree 内）+ `lint:tokens` → 合 origin/main → PR（标题含 `[LUM-290]`）。

## Out of scope

- 不动既有 brand 存量的迁移（仅 baseline 冻结）。
- 不为 feedback 族新增"subtle 底上的深色文字"token（RiskBadge 用中性文字规避）。
- 不引入图表库；现有为手写 div/SVG 图。
