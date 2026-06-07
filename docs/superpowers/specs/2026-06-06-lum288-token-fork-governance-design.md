# LUM-288 — 治理 landing↔app token 分叉与遗留分类 hex（hljs/radius）

**Status**: Approved design (brainstorming output)
**Date**: 2026-06-06
**Milestone**: Design System Rework
**Branch**: `lumo/LUM-288-governance-token-fork`

## 背景

设计系统重构已把颜色模型统一为 oklch，但仍有两处治理空白：

1. **landing↔app token 分叉**：`components/landing/landing.css` 在 `.landing` 作用域内整体覆写 base
   token，且 `--radius: 0.625rem` 与 app 的 `0.75rem` 分叉。分叉本身合理（landing 是品牌营销面），
   但缺少文档化的理由与范围声明，`--radius` 的分叉也无品牌依据。
2. **hljs 语法高亮裸 hex**：`app/globals.css` 内 highlight.js 主题有 14 个裸 hex（7 light + 7 dark），
   镜像 GitHub light/dark 主题。它们只是因为整个 `app/globals.css` 被 `scripts/lint-tokens.ts` 的
   `ALLOWLIST` 整文件豁免而通过 lint——属"隐性豁免"，未被显式归类。

**验收**：landing 分叉有据可查；遗留 hex 例外有明确归类，不再是隐性豁免。

## 现状核实（关键事实）

- landing 的覆写**运行时仅作用于 `.landing` DOM**，不污染 app 外壳。
- 逐 token 比对 landing vs app 的 light + dark 两个模式：**没有任何 token 在两个模式下都与 app 同值**。
  因此"收紧 scope"**不能**靠删除冗余覆写——landing 的每个覆写至少在一个模式下是真实品牌差异。
  唯一无品牌依据、纯结构性的分叉是 `--radius`。
- landing 的 `--destructive-foreground` 在两个模式下都等于 `--destructive`，被 landing `button`/`badge`
  的 `destructive` 变体（`bg-destructive/30 text-destructive-foreground`）消费，呈"软红"样式。两模式
  一致 ⇒ 判定为 vendored 模板的刻意选择，非显式 bug。**本任务不改动，仅在注释中标注为已知 landing 选择。**
- `--hljs-*` token 化不会触动 `__tests__/styles/globals-css-color-tokens.test.ts` 的 oklch 断言
  （该测试只检查固定 token 列表，hljs 不在其中）；且 `app/globals.css` 仍 allowlisted，hex 值留在
  token 定义处不违反 lint。

## 设计

### Part A — landing 分叉：保留 + 文档化 + 收敛 radius

- **A1 文档化**：将 `landing.css` 顶部单行注释重写为正式治理块，声明：
  - 这是**有意的、`.landing` 作用域内**的品牌分叉；
  - 差异项与理由：橙色 `--primary`（品牌色）、zinc 中性色阶（app 用 slate 系）、营销浅色 `--background`；
  - 为何分叉而非消费 app base token：品牌识别面 ≠ app 中性产品 UI；
  - 标注 `--destructive-foreground == --destructive` 为已知 landing"软红"选择。
- **A2 收敛 radius**：删除 landing light block 的 `--radius: 0.625rem`，使 `.landing` 继承 app 的
  `0.75rem`（landing dark block 无 radius 覆写，无需改动）。消除唯一无品牌依据的结构性分叉。
- **A3 不删冗余**：如实记录无两模式皆同值的 token 可删；destructive-foreground 不改、仅注释。

**视觉影响**：landing 圆角由 0.625rem 变为 0.75rem（略大），已获用户接受；preview 够不到 dev server，
作人工/快照确认。

### Part B — hljs 14 hex：token 化为命名 `--hljs-*` token

- **B1 定义 token**：在 `app/globals.css` 的 `:root` 加 7 个、`.dark` 加 7 个 `--hljs-*` token，
  **保留现有 GitHub hex 值**（不重新调色），配多行 rationale 注释（分类语法调色板，文档化例外，
  平行于 `--priority-*` 的做法）。命名按现有语义分组：

  | token | 现有 light hex | 现有 dark hex | 映射的 `.hljs-*` 类 |
  |---|---|---|---|
  | `--hljs-comment` | `#6a737d` | `#8b949e` | comment, quote |
  | `--hljs-keyword` | `#d73a49` | `#ff7b72` | keyword, selector-tag, literal, type |
  | `--hljs-string` | `#032f62` | `#a5d6ff` | string, attr, template-tag, regexp, addition |
  | `--hljs-number` | `#005cc5` | `#79c0ff` | number, meta, built_in, builtin-name, symbol |
  | `--hljs-title` | `#6f42c1` | `#d2a8ff` | title, section, function .title, name |
  | `--hljs-attribute` | `#e36209` | `#ffa657` | attribute, variable, tag |
  | `--hljs-deletion` | `#b31d28` | `#ffa198` | deletion |

  （映射保持与现状字节级一致，仅 hex→var，不改任何渲染颜色。）

- **B2 改写规则**：把 `.hljs-*` 颜色规则的 `color: #...` 改为 `color: var(--hljs-…)`。
  非颜色规则（`.hljs-emphasis` 斜体、`.hljs-strong` 字重）不动。
- **B3 文档化豁免**：改写 `scripts/lint-tokens.ts` 中 `app/globals.css` 的 ALLOWLIST 注释，列明该文件内
  合法 hex 的类别——(a) oklch token 的 `/* #… */` round-trip 注释、(b) `--hljs-*` 分类语法调色板、
  (c) elevation rgba 阴影。使整文件豁免**有明确归类**，不再是隐性豁免。
- **B4 guard test**：新增 `__tests__/styles/` 测试，断言：
  - 7 个 `--hljs-*` token 在 `:root` 与 `.dark` 两个块中均有定义；
  - `.hljs-*` 颜色规则使用 `var(--hljs-…)`，hljs 区块内不再有裸 hex。
  写法仿 `globals-css-color-tokens.test.ts` 的 priority 段。

### 文档载体

沿用仓库惯例：**inline 注释 + guard test**（priority / feedback / status 皆如此）。本 spec 文档另作审计记录。
不另写独立 governance md。

## 受影响文件

- `components/landing/landing.css` — A1 注释、A2 删 radius
- `app/globals.css` — B1 加 `--hljs-*` token + rationale、B2 改写 `.hljs-*` 规则
- `scripts/lint-tokens.ts` — B3 改 ALLOWLIST 注释
- `__tests__/styles/hljs-syntax-tokens.test.ts`（新增）— B4

## 验证

- `npx tsc --noEmit`
- `npx jest __tests__/styles`（含新 guard + 既有 color-tokens/status 守卫）
- `npm run lint:tokens`（应保持绿：globals.css/landing.css 仍 allowlisted；hljs 规则已 var() 化）
- landing 圆角视觉变化作人工/快照确认

## 非目标（Out of scope）

- 不收敛 landing 的品牌色分叉（橙色 primary、zinc 色阶等）——有意保留。
- 不修 `--destructive-foreground` 异常——判定为模板刻意选择，仅注释。
- 不审计/删除 landing 组件文件（`components/landing/ui/*`、`logos/*`）已有的 baseline 违规。
- 不改 landing dark 模式其他疑似模板瑕疵（如 dark `--border: 0.885` 偏亮）。
