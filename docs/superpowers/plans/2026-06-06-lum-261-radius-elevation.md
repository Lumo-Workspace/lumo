# 圆角档位与 Elevation 体系 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把圆角调成干净的 4px 步进档位、建立 token 化的 `shadow-elevation-1/2/3` 分级,核心组件改用规范档位,并接入 lint 防回流。

**Architecture:** 全部 token 改动集中在 `app/globals.css`(单一 Tailwind 入口,`@theme inline` 注册工具类);lint 规则扩 `scripts/lint-tokens.ts`(baseline 模式吸收存量);核心原子组件 `components/ui/*` 改 className。视觉验证靠 globals.css 守护测试 + lint 单测 + tsc(本环境 preview 浏览器够不到 dev server)。

**Tech Stack:** Next.js 14 / Tailwind CSS v4 / shadcn/ui / TypeScript / Jest (SWC) / tsx。

参考设计:`docs/superpowers/specs/2026-06-06-lum-261-radius-elevation-design.md`

---

## File Structure

| 文件                                                                                                     | 改动                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `app/globals.css`                                                                                        | radius calc 偏移调整(`@theme inline`);新增 `--elevation-1/2/3`(`:root`+`.dark`)+ `--shadow-elevation-*` 注册 |
| `__tests__/styles/globals-css-radius-elevation.test.ts`                                                  | **新建** — radius/elevation token 守护测试                                                                   |
| `scripts/lint-tokens.ts`                                                                                 | 新增 `radius` + `shadow` 两条规则,扩 `Rule` 类型与输出标签                                                   |
| `__tests__/scripts/lint-tokens.test.ts`                                                                  | 扩单测覆盖新规则                                                                                             |
| `scripts/lint-tokens.baseline.json`                                                                      | `lint:tokens:update` 重新快照(吸收存量裸 rounded / 内置 shadow)                                              |
| `components/ui/{card,dialog,popover,dropdown-menu,select,command,tooltip,button,input,sheet,sonner}.tsx` | radius 档位归位 + `shadow-*` → `shadow-elevation-*`                                                          |
| `components/ui/sidebar/menu.tsx`                                                                         | 2 处硬编码 `shadow-[...]` → `ring-1 ring-sidebar-border` / `hover:ring-sidebar-accent`                       |
| `docs/design-system.md`                                                                                  | 重写 Radius / Shadows 小节为规范                                                                             |

---

## Task 1: 圆角 token 调成 4px 步进

**Files:**

- Modify: `app/globals.css:603-606`
- Test: `__tests__/styles/globals-css-radius-elevation.test.ts`(本任务新建,先只放 radius 部分)

- [ ] **Step 1: 写失败测试**

Create `__tests__/styles/globals-css-radius-elevation.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

describe('radius tokens (LUM-261)', () => {
  it('--radius base stays 0.75rem', () => {
    expect(css).toMatch(/--radius:\s*0\.75rem;/)
  })

  // 4px steps: sm=−8px(0.25), md=−4px(0.5), lg=base(0.75), xl=+4px(1)
  it('--radius-sm = calc(var(--radius) - 8px)', () => {
    expect(css).toMatch(/--radius-sm:\s*calc\(var\(--radius\)\s*-\s*8px\);/)
  })
  it('--radius-md = calc(var(--radius) - 4px)', () => {
    expect(css).toMatch(/--radius-md:\s*calc\(var\(--radius\)\s*-\s*4px\);/)
  })
  it('--radius-lg = var(--radius)', () => {
    expect(css).toMatch(/--radius-lg:\s*var\(--radius\);/)
  })
  it('--radius-xl = calc(var(--radius) + 4px)', () => {
    expect(css).toMatch(/--radius-xl:\s*calc\(var\(--radius\)\s*\+\s*4px\);/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/styles/globals-css-radius-elevation.test.ts`
Expected: FAIL — `--radius-sm` 当前是 `calc(var(--radius) - 4px)`,`--radius-md` 是 `- 2px`。

- [ ] **Step 3: 改 globals.css**

`app/globals.css:603-604`,把:

```css
--radius-sm: calc(var(--radius) - 4px);
--radius-md: calc(var(--radius) - 2px);
```

改为:

```css
--radius-sm: calc(var(--radius) - 8px);
--radius-md: calc(var(--radius) - 4px);
```

(`--radius-lg: var(--radius);` 和 `--radius-xl: calc(var(--radius) + 4px);` 两行不动。)

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest __tests__/styles/globals-css-radius-elevation.test.ts`
Expected: PASS(radius 4 项全绿)。

- [ ] **Step 5: 提交**

```bash
git add app/globals.css __tests__/styles/globals-css-radius-elevation.test.ts
git commit -m "refactor: retune radius tiers to clean 4px steps [LUM-261]"
```

---

## Task 2: Elevation token + 工具类

**Files:**

- Modify: `app/globals.css`(`:root` 块结尾、`.dark` 块结尾、`@theme inline` 块)
- Test: `__tests__/styles/globals-css-radius-elevation.test.ts`(追加 elevation describe)

- [ ] **Step 1: 写失败测试**

在 `__tests__/styles/globals-css-radius-elevation.test.ts` 末尾追加:

```ts
describe('elevation tokens (LUM-261)', () => {
  // 取某 token 的全部定义值(:root 与 .dark 各一次)
  const defs = (name: string) =>
    [...css.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, 'g'))].map(m =>
      (m[1] ?? '').trim()
    )

  it.each(['elevation-1', 'elevation-2', 'elevation-3'])(
    '--%s is defined in both :root and .dark',
    name => {
      expect(defs(name).length).toBe(2)
    }
  )

  it('dark elevations are stronger (higher max alpha) than light', () => {
    const maxAlpha = (v: string) =>
      Math.max(
        ...[...v.matchAll(/rgb\(0 0 0 \/ ([\d.]+)\)/g)].map(m =>
          parseFloat(m[1] ?? '0')
        )
      )
    for (const name of ['elevation-1', 'elevation-2', 'elevation-3']) {
      const [light, dark] = defs(name)
      expect(maxAlpha(dark ?? '')).toBeGreaterThan(maxAlpha(light ?? ''))
    }
  })

  it.each(['1', '2', '3'])(
    '@theme registers --shadow-elevation-%s → utility',
    n => {
      expect(css).toMatch(
        new RegExp(`--shadow-elevation-${n}:\\s*var\\(--elevation-${n}\\);`)
      )
    }
  )
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/styles/globals-css-radius-elevation.test.ts`
Expected: FAIL — elevation token 尚未定义。

- [ ] **Step 3: 改 globals.css —— `:root` 块**

在 `app/globals.css` 的 `:root` 块里,`--radius: 0.75rem;`(第 520 行)之后插入:

```css
/* Elevation — semantic shadow tiers (LUM-261). Registered as
     shadow-elevation-{1,2,3} utilities via @theme inline below.
     ev1 resting raised (card/panel), ev2 anchored overlay
     (popover/dropdown), ev3 top floating (dialog/sheet/toast). */
--elevation-1: 0 1px 2px 0 rgb(0 0 0 / 0.06), 0 1px 3px 0 rgb(0 0 0 / 0.1);
--elevation-2:
  0 2px 4px -1px rgb(0 0 0 / 0.08), 0 4px 8px -1px rgb(0 0 0 / 0.12);
--elevation-3:
  0 8px 16px -4px rgb(0 0 0 / 0.12), 0 12px 24px -6px rgb(0 0 0 / 0.18);
```

- [ ] **Step 4: 改 globals.css —— `.dark` 块**

在 `.dark` 块内(`--sidebar-ring: ...` 行之后、status 注释之前的位置即可),插入暗色更强的同名 token:

```css
/* Elevation — stronger on dark, where shadows barely register (LUM-261). */
--elevation-1: 0 1px 2px 0 rgb(0 0 0 / 0.4), 0 1px 3px 0 rgb(0 0 0 / 0.5);
--elevation-2:
  0 2px 4px -1px rgb(0 0 0 / 0.45), 0 4px 8px -1px rgb(0 0 0 / 0.55);
--elevation-3:
  0 8px 16px -4px rgb(0 0 0 / 0.55), 0 12px 24px -6px rgb(0 0 0 / 0.65);
```

- [ ] **Step 5: 改 globals.css —— `@theme inline` 块**

在 `@theme inline` 块里、`--radius-xl: ...`(第 606 行)之后插入注册行:

```css
/* Elevation utilities: generates .shadow-elevation-1/2/3 (LUM-261). */
--shadow-elevation-1: var(--elevation-1);
--shadow-elevation-2: var(--elevation-2);
--shadow-elevation-3: var(--elevation-3);
```

- [ ] **Step 6: 跑测试确认通过 + 验证工具类真生成**

Run: `npx jest __tests__/styles/globals-css-radius-elevation.test.ts`
Expected: PASS(radius + elevation 全绿)。

Run: `npx @tailwindcss/cli -i app/globals.css -o /tmp/lum261.css 2>/dev/null && grep -c "shadow-elevation-1" /tmp/lum261.css`
Expected: 出现 `.shadow-elevation-1` 工具类(grep 计数 ≥ 1)。若 Tailwind CLI 未装可跳过此条,以 jest 为准。

- [ ] **Step 7: 提交**

```bash
git add app/globals.css __tests__/styles/globals-css-radius-elevation.test.ts
git commit -m "feat: add shadow-elevation-1/2/3 tokens (dark-aware) [LUM-261]"
```

---

## Task 3: lint-tokens 新增 `radius` 规则(禁裸 rounded)

**Files:**

- Modify: `scripts/lint-tokens.ts`
- Test: `__tests__/scripts/lint-tokens.test.ts`

- [ ] **Step 1: 写失败测试**

在 `__tests__/scripts/lint-tokens.test.ts` 的 `describe('lint-tokens / detectViolations', ...)` 内追加:

```ts
it('flags bare `rounded` (no tier suffix)', () => {
  const v = detectViolations(
    'components/foo.tsx',
    `<div className="rounded border p-2" />`
  )
  expect(v).toHaveLength(1)
  expect(v[0]).toMatchObject({ match: 'rounded', rule: 'radius' })
})

it('does NOT flag tiered/directional/arbitrary rounded', () => {
  const v = detectViolations(
    'app/foo.tsx',
    `<div className="rounded-md rounded-full rounded-l-lg rounded-[2px]" />`
  )
  expect(v).toEqual([])
})

it('does NOT flag `rounded` inside another word (surrounded)', () => {
  const v = detectViolations('lib/foo.ts', `const s = 'surrounded'`)
  expect(v).toEqual([])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/scripts/lint-tokens.test.ts -t "bare"`
Expected: FAIL — `rule: 'radius'` 还不存在,无命中。

- [ ] **Step 3: 实现 radius 规则**

在 `scripts/lint-tokens.ts`:

(a) 扩类型(第 30 行):

```ts
export type Rule = 'hex' | 'palette' | 'radius' | 'shadow'
```

(b) 在 `PALETTE_CLASS_RE` 定义之后新增正则:

```ts
// Bare `rounded` (no tier suffix) bypasses the radius scale — its value
// (0.25rem) now equals rounded-sm, so it's semantically redundant. Tiered
// (rounded-md), directional (rounded-l), and arbitrary (rounded-[2px])
// forms are allowed. `(?![-\w])` blocks rounded-md / roundedness;
// `\b` blocks surrounded.
const BARE_ROUNDED_RE = /\brounded(?![-\w])/g
```

(c) 在 `detectViolations` 的 per-line 循环里,`PALETTE_CLASS_RE` 的 while 块之后追加:

```ts
BARE_ROUNDED_RE.lastIndex = 0
while ((m = BARE_ROUNDED_RE.exec(line)) !== null) {
  out.push({
    file: relPath,
    line: i + 1,
    col: m.index + 1,
    match: m[0],
    rule: 'radius',
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest __tests__/scripts/lint-tokens.test.ts`
Expected: PASS(原有用例 + 3 条新用例全绿)。

- [ ] **Step 5: 提交**

```bash
git add scripts/lint-tokens.ts __tests__/scripts/lint-tokens.test.ts
git commit -m "feat: lint-tokens flags bare rounded [LUM-261]"
```

---

## Task 4: lint-tokens 新增 `shadow` 规则(禁内置/硬编码 shadow)

**Files:**

- Modify: `scripts/lint-tokens.ts`
- Test: `__tests__/scripts/lint-tokens.test.ts`

- [ ] **Step 1: 写失败测试**

在 `describe('lint-tokens / detectViolations', ...)` 内追加:

```ts
it('flags Tailwind built-in shadow scale and arbitrary shadow', () => {
  const v = detectViolations(
    'components/foo.tsx',
    `<div className="shadow shadow-md hover:shadow-lg shadow-[0_0_0_1px_red]" />`
  )
  expect(v.map(x => x.match).sort()).toEqual([
    'shadow',
    'shadow-[0_0_0_1px_red]',
    'shadow-lg',
    'shadow-md',
  ])
  expect(v.every(x => x.rule === 'shadow')).toBe(true)
})

it('does NOT flag shadow-elevation-*, shadow-none, shadow-mockup, drop-shadow', () => {
  const v = detectViolations(
    'app/foo.tsx',
    `<div className="shadow-elevation-1 shadow-none shadow-mockup drop-shadow-[2px_1px_24px_var(--x)]" />`
  )
  expect(v).toEqual([])
})

it('does NOT flag the `shadow` inside box-shadow CSS property', () => {
  const v = detectViolations('components/foo.css', `.x { box-shadow: 0 0 0; }`)
  expect(v).toEqual([])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/scripts/lint-tokens.test.ts -t "shadow"`
Expected: FAIL — `rule: 'shadow'` 未实现。

- [ ] **Step 3: 实现 shadow 规则**

在 `scripts/lint-tokens.ts`,`BARE_ROUNDED_RE` 之后新增:

```ts
// Tailwind built-in shadow scale (`shadow`, `shadow-xs|sm|md|lg|xl|2xl`)
// and arbitrary `shadow-[...]` bypass the elevation system — use
// shadow-elevation-{1,2,3} (shadow-none stays allowed). `(?<![-\w])`
// skips drop-shadow / box-shadow; the optional group means a bare
// `shadow` matches only when NOT followed by another `-segment`
// (so shadow-elevation-1 / shadow-none / shadow-mockup are left alone).
const SHADOW_RE =
  /(?<![-\w])shadow(?:-(?:xs|sm|md|lg|xl|2xl)|-\[[^\]]*\])?(?![-\w])/g
```

在 `detectViolations` 循环里,radius 的 while 块之后追加:

```ts
SHADOW_RE.lastIndex = 0
while ((m = SHADOW_RE.exec(line)) !== null) {
  out.push({
    file: relPath,
    line: i + 1,
    col: m.index + 1,
    match: m[0],
    rule: 'shadow',
  })
}
```

- [ ] **Step 4: 更新输出标签(3 处)**

`scripts/lint-tokens.ts` 里有 3 处 `v.rule === 'hex' ? 'hex literal  ' : 'palette class'`(`--full` 文本分支、默认 stderr 分支)。在文件顶部(`detectViolations` 之前)加一个 helper:

```ts
const RULE_LABELS: Record<Rule, string> = {
  hex: 'hex literal  ',
  palette: 'palette class',
  radius: 'bare rounded ',
  shadow: 'raw shadow   ',
}
```

把那 3 处三元表达式 `const label = v.rule === 'hex' ? 'hex literal  ' : 'palette class'` 全部替换为:

```ts
const label = RULE_LABELS[v.rule]
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest __tests__/scripts/lint-tokens.test.ts`
Expected: PASS(全部用例绿)。

Run: `npx tsc --noEmit`
Expected: 无错(`Rule` 联合类型扩展后 `RULE_LABELS` 覆盖全 4 值)。

- [ ] **Step 6: 提交**

```bash
git add scripts/lint-tokens.ts __tests__/scripts/lint-tokens.test.ts
git commit -m "feat: lint-tokens flags raw/built-in shadow [LUM-261]"
```

---

## Task 5: 快照 baseline(吸收存量违规)

新增的 radius/shadow 规则会把全仓 ~130 处裸 `rounded` 与 ~80 处内置 shadow 标为违规。先快照进 baseline,避免阻塞;后续组件迁移只会减少计数。

**Files:**

- Modify: `scripts/lint-tokens.baseline.json`

- [ ] **Step 1: 重建 baseline**

Run: `npm run lint:tokens:update`
Expected: 输出 `✓ baseline updated … (N violations across M files)`,N 比改动前大幅增加(纳入了 rounded/shadow)。

- [ ] **Step 2: 确认无回归**

Run: `npm run lint:tokens`
Expected: `✓ lint-tokens: no regressions against baseline`。

- [ ] **Step 3: 提交**

```bash
git add scripts/lint-tokens.baseline.json
git commit -m "chore: snapshot lint-tokens baseline with radius/shadow rules [LUM-261]"
```

---

## Task 6: 迁移核心组件 — radius 档位 + elevation

按设计映射逐文件改。**只改 className 字符串,不动逻辑。** 每个 Edit 的 old→new 如下(其余 class 原样保留)。

映射依据:

- 表面浮层 popover/dropdown/select-content/command-root:`rounded-md`→`rounded-lg`
- 菜单项 dropdown/select/command-item、dialog/sheet 关闭按钮:`rounded-sm`→`rounded-md`(新值 0.5,与旧 `rounded-sm` 0.5 等值,无视觉变化,仅档位归位)
- shadow 就近映射:`shadow`/`shadow-xs`/`shadow-sm`→`shadow-elevation-1`;`shadow-md`→`shadow-elevation-2`;`shadow-lg`→`shadow-elevation-3`;dropdown 主面板 `shadow-lg`→`shadow-elevation-2`(下拉=ev2)

**Files:**

- Modify: `components/ui/card.tsx`, `dialog.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `select.tsx`, `command.tsx`, `tooltip.tsx`, `button.tsx`, `input.tsx`, `sheet.tsx`, `sonner.tsx`

- [ ] **Step 1: card.tsx** — `shadow-sm` → `shadow-elevation-1`

`components/ui/card.tsx:12`:
`'rounded-lg border bg-card text-card-foreground shadow-sm'`
→ `'rounded-lg border bg-card text-card-foreground shadow-elevation-1'`

- [ ] **Step 2: dialog.tsx** — content `shadow-lg`→`shadow-elevation-3`,close `rounded-sm`→`rounded-md`

`dialog.tsx:39`:把该 className 中的 `shadow-lg` 替换为 `shadow-elevation-3`(其余不变)。
`dialog.tsx:45`:把开头的 `absolute right-4 top-4 rounded-sm` 中的 `rounded-sm` 替换为 `rounded-md`。

- [ ] **Step 3: popover.tsx** — `rounded-md`→`rounded-lg`,`shadow-md`→`shadow-elevation-2`

`popover.tsx:24`:`rounded-md` → `rounded-lg`;`shadow-md` → `shadow-elevation-2`。

- [ ] **Step 4: dropdown-menu.tsx** — items `rounded-sm`→`rounded-md`,content radius+shadow

逐行(`dropdown-menu.tsx`):

- `:30` item:`rounded-sm` → `rounded-md`
- `:50` content:`rounded-md` → `rounded-lg`;`shadow-lg` → `shadow-elevation-2`
- `:68` sub-content:`rounded-md` → `rounded-lg`;`shadow-md` → `shadow-elevation-2`
- `:87` item:`rounded-sm` → `rounded-md`
- `:103` item:`rounded-sm` → `rounded-md`
- `:127` item:`rounded-sm` → `rounded-md`

(用 `replace_all` 谨慎:`rounded-sm` 在本文件出现多次且语义一致,可一次性 `rounded-sm`→`rounded-md`;但 `rounded-md`→`rounded-lg` 只在 content 行,逐行精确替换以免误改。)

- [ ] **Step 5: select.tsx**

`select.tsx`:

- `:22` trigger:`shadow-xs` → `shadow-elevation-1`(radius `rounded-md` 保留=控件档)
- `:78` content:`rounded-md` → `rounded-lg`;`shadow-md` → `shadow-elevation-2`
- `:121` item:`rounded-sm` → `rounded-md`

- [ ] **Step 6: command.tsx**

`command.tsx`:

- `:18` root:`rounded-md` → `rounded-lg`(命令面板=表面)
- `:47` input:`rounded-md` 保留(控件档,无 shadow)
- `:118` item:`rounded-sm` → `rounded-md`

- [ ] **Step 7: tooltip.tsx** — 不改

`tooltip.tsx:49` 用 `rounded-md`(小浮层,保留控件档);`:55` arrow 用 `rounded-[2px]`(arbitrary,允许)。无 `shadow-*`。**本文件无改动**,跳过。

- [ ] **Step 8: button.tsx** — 所有变体 shadow → `shadow-elevation-1`

`button.tsx`:

- `:13` `'bg-primary text-primary-foreground shadow hover:bg-primary/90'` → `'bg-primary text-primary-foreground shadow-elevation-1 hover:bg-primary/90'`
- `:15` `shadow-xs` → `shadow-elevation-1`
- `:17` `shadow-xs` → `shadow-elevation-1`
- `:19` `shadow-xs` → `shadow-elevation-1`
- radius `rounded-md`(:8/:25/:26)保留(控件档)。

(`:15/:17/:19` 三行均含 `shadow-xs`,可 `replace_all: true` 把 `shadow-xs`→`shadow-elevation-1`;`:13` 的裸 `shadow ` 单独精确替换 `shadow hover:` → `shadow-elevation-1 hover:`。)

- [ ] **Step 9: input.tsx** — `shadow-xs` → `shadow-elevation-1`

`input.tsx:11`:`shadow-xs` → `shadow-elevation-1`(`rounded-md` 保留)。

- [ ] **Step 10: sheet.tsx** — `shadow-lg`→`shadow-elevation-3`,close `rounded-sm`→`rounded-md`

`sheet.tsx:34`:`shadow-lg` → `shadow-elevation-3`。
`sheet.tsx:68`:`rounded-sm` → `rounded-md`。

- [ ] **Step 11: sonner.tsx** — toast `shadow-lg`→`shadow-elevation-3`

`sonner.tsx:32`:`group-[.toaster]:shadow-lg` → `group-[.toaster]:shadow-elevation-3`。

- [ ] **Step 12: tsc + lint 校验**

Run: `npx tsc --noEmit`
Expected: 无错。

Run: `npm run lint:tokens`
Expected: `✓ no regressions`(组件计数只减不增;若因某行同时改动触发 stale,Step 13 重快照修正)。

- [ ] **Step 13: 重快照 baseline(锁定更低计数)**

Run: `npm run lint:tokens:update && npm run lint:tokens`
Expected: baseline 计数下降,`✓ no regressions`。

- [ ] **Step 14: 提交**

```bash
git add components/ui scripts/lint-tokens.baseline.json
git commit -m "refactor: migrate core ui to radius tiers + shadow-elevation [LUM-261]"
```

---

## Task 7: 修 sidebar 硬编码 shadow(顺带修 oklch 描边 bug)

`shadow-[0_0_0_1px_hsl(var(--sidebar-border))]`:oklch 迁移后 `hsl(var(--sidebar-border))` 非法、描边被静默丢弃。改用 `ring` 工具类(`ring-1` = `box-shadow 0 0 0 1px`,等价且无 hsl 包裹),`--color-sidebar-border` / `--color-sidebar-accent` 已注册,故 `ring-sidebar-border` / `ring-sidebar-accent` 可用。

**Files:**

- Modify: `components/ui/sidebar/menu.tsx:50`

- [ ] **Step 1: 替换 className**

`components/ui/sidebar/menu.tsx:50`,把:

```
'bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]',
```

替换为:

```
'bg-background ring-1 ring-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:ring-sidebar-accent',
```

- [ ] **Step 2: 校验**

Run: `npx tsc --noEmit`
Expected: 无错。

Run: `grep -n "shadow-\[" components/ui/sidebar/menu.tsx`
Expected: 无输出(两处硬编码 box-shadow 已消除)。

Run: `npx @tailwindcss/cli -i app/globals.css -o /tmp/lum261.css 2>/dev/null && grep -c "ring-sidebar-border" /tmp/lum261.css || true`
Expected: 工具类存在(或 jest/构建期生成);CLI 缺失可跳过。

- [ ] **Step 3: 重快照 + 校验**

Run: `npm run lint:tokens:update && npm run lint:tokens`
Expected: `✓ no regressions`(sidebar 两处 shadow-[...] 违规消失)。

- [ ] **Step 4: 提交**

```bash
git add components/ui/sidebar/menu.tsx scripts/lint-tokens.baseline.json
git commit -m "fix: sidebar outline uses ring not invalid hsl(var()) box-shadow [LUM-261]"
```

---

## Task 8: 文档 — 重写 design-system.md Radius / Shadows 小节

**Files:**

- Modify: `docs/design-system.md`(Radius 小节 137-147 行、Shadows 小节 198-203 行)

- [ ] **Step 1: 重写 Radius 小节**

把 `## Radius` 整节(到 `Use rounded-md for inputs / chips, rounded-lg for cards.` 为止)替换为:

```markdown
## Radius

单一来源 `--radius: 0.75rem`;`@theme inline` 派生干净的 4px 步进档位。

| Token / utility              | calc                   | 值        |
| ---------------------------- | ---------------------- | --------- |
| `rounded-sm` (`--radius-sm`) | `calc(--radius − 8px)` | `0.25rem` |
| `rounded-md` (`--radius-md`) | `calc(--radius − 4px)` | `0.5rem`  |
| `rounded-lg` (`--radius-lg`) | `var(--radius)`        | `0.75rem` |
| `rounded-xl` (`--radius-xl`) | `calc(--radius + 4px)` | `1rem`    |

**档位映射规则(哪类元素用哪档):**

| 元素类                                                  | 档位           |
| ------------------------------------------------------- | -------------- |
| inline 小件:chip / tag / 内联 token                     | `rounded-sm`   |
| 控件:button / input / select / 菜单项                   | `rounded-md`   |
| 表面:card / dialog / popover / dropdown / sheet / panel | `rounded-lg`   |
| pill / badge / 头像 / 圆形图标按钮                      | `rounded-full` |
| 大容器 / 特例                                           | `rounded-xl`   |

裸 `rounded`(= `0.25rem`,与 `rounded-sm` 同值)**禁用** —— 由 `lint:tokens` 拦截。
方向性圆角(`rounded-t/l/r/b/tl…`)与 arbitrary `rounded-[..]` 按需使用,不受档位约束。
```

- [ ] **Step 2: 重写 Shadows 小节**

把 `## Shadows` 整节替换为:

```markdown
## Shadows / Elevation

阴影走 token 化的 elevation 分级 —— `:root` 与 `.dark` 各定义一组(暗色更强,
因深色背景上阴影几乎不可见),`@theme inline` 注册成工具类。**禁止**直接用
Tailwind 内置 `shadow` / `shadow-xs…2xl` 或硬编码 `shadow-[..]`(由 `lint:tokens`
拦截);`shadow-none` 允许;`drop-shadow-*`(filter)不受此规则约束。

| 工具类               | 用途     | 组件                                                           |
| -------------------- | -------- | -------------------------------------------------------------- |
| `shadow-elevation-1` | 静态抬起 | card / panel / 抬起控件(button/input) / sticky header          |
| `shadow-elevation-2` | 锚定浮层 | popover / dropdown / select-content / hovercard / context-menu |
| `shadow-elevation-3` | 顶级浮层 | dialog / sheet / command 面板 / toast                          |

底层值在 `app/globals.css` 的 `--elevation-1/2/3`(`:root`/`.dark`)。调整观感改
那里即可,组件不碰。landing 专用的 `--shadow-mockup` 仍在 `landing.css`。

1px 描边(border 替代)用 `ring-1 ring-<token>`,**不要**用 `shadow-[0_0_0_1px_…]`
(且 `hsl(var(--token))` 在 oklch token 下是非法 CSS)。
```

- [ ] **Step 3: 校验文档无残留旧表述**

Run: `grep -nE "shadow-md for hovered|rounded-md for inputs" docs/design-system.md`
Expected: 无输出(旧描述已替换)。

- [ ] **Step 4: 提交**

```bash
git add docs/design-system.md
git commit -m "docs: document radius tiers + elevation system [LUM-261]"
```

---

## Task 9: 终检

- [ ] **Step 1: 全量类型检查**

Run: `npx tsc --noEmit`
Expected: 无错。

- [ ] **Step 2: 跑相关测试**

Run: `npx jest __tests__/styles/globals-css-radius-elevation.test.ts __tests__/styles/globals-css-color-tokens.test.ts __tests__/scripts/lint-tokens.test.ts`
Expected: 全绿。

- [ ] **Step 3: token lint**

Run: `npm run lint:tokens`
Expected: `✓ lint-tokens: no regressions against baseline`。

- [ ] **Step 4: 确认核心组件再无裸 rounded / 内置 shadow / 硬编码 box-shadow**

Run: `npx tsx scripts/lint-tokens.ts --full --json | npx tsx -e "const v=JSON.parse(require('fs').readFileSync(0,'utf8')); const ui=v.filter(x=>x.file.startsWith('components/ui/')&&(x.rule==='radius'||x.rule==='shadow')); console.log(ui.length, 'radius/shadow violations remain in components/ui')"`
Expected: 0(或仅剩 arbitrary `rounded-[..]` 这类允许项 —— 它们不计入 radius/shadow rule)。

- [ ] **Step 5: 推分支 + 开 PR**(经用户确认后)

```bash
git push -u origin lumo/LUM-261-radius-elevation-tokens
gh pr create --title "refactor: standardize radius tiers + elevation system [LUM-261]" --body "..."
```

PR body 要点:radius 档位调成 4px 步进(`rounded-sm` 0.5→0.25、`rounded-md` 0.625→0.5,全仓轻微视觉变化);新增 `shadow-elevation-1/2/3`(暗色调强);核心组件迁移;修 sidebar oklch 描边 bug;lint 接入 radius/shadow 规则 + baseline。无 schema 改动,无新依赖。

```

---

## Self-Review notes

- **Spec 覆盖**:① radius token→T1;② 档位映射→T6+T8;③ elevation token→T2;④ elevation 映射→T6+T8;⑤ lint→T3/T4/T5;⑥ 迁移+sidebar→T6/T7;⑦ 文档→T8;Testing→T1/T2/T3/T4/T9。全覆盖。
- **类型一致**:`Rule` 联合在 T3 扩 `radius`、T4 扩 `shadow`,`RULE_LABELS` 在 T4 覆盖全 4 值;正则名 `BARE_ROUNDED_RE`/`SHADOW_RE` 前后一致。
- **无占位符**:每步含具体 old→new 字符串与命令。
- **风险**:radius 档位值变化影响全仓所有 `rounded-sm/md` 使用(用户在设计阶段已接受);elevation 数值是基线、合并后真机可微调(改 globals.css 即可,不动组件)。
```
