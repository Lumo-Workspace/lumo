# Milestone 详情页 tab 布局改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把里程碑详情页从「单页 + 弹窗编辑」改为 `DetailLayout` 内的「概览 / 任务」双 tab + 内联编辑，对齐项目详情页交互。

**Architecture:** 保留共享 `DetailLayout` 三栏壳。主内容区放一个纯展示组件 `MilestoneDetailTabs`（持本地 tab state，渲染 `MilestoneOverviewTab` / `MilestoneTasksTab`）。右侧 `MilestoneSidebar` 由只读改为内联可编辑（状态 Select + 日期输入）。所有写操作经页面持有的单个 `useMutation` → `milestonesClient.update` → `PATCH /api/milestones/{id}`，**零后端改动、零 schema 改动**。

**Tech Stack:** Next.js 14 App Router、TypeScript（strict）、@tanstack/react-query、react-intl、shadcn/ui、Jest + @testing-library/react（jsdom）。

**工作目录：** worktree `.worktrees/LUM-193`，分支 `lumo/LUM-193-milestone-detail-tabs`。所有 `npx`/jest 命令都要 `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193` 后执行（见踩坑记忆：jest 必须在 worktree 内跑，否则命中主检出的 haste 冲突）。

**关键约束（来自踩坑记忆）：**
- Radix `Select` 在 jsdom 开不了下拉 —— 测试里 mock `@/components/ui/select` 为原生 `<select>`，用 change 事件断言回调入参，不模拟真实打开。
- jest（SWC）抓不到类型错误，每个任务末尾都要单独 `npx tsc --noEmit`。
- i18n 改 key 必须覆盖 `lib/i18n/` **全部 17 个** locale 文件，不用英文兜底。

---

## File Structure

**新建：**
- `app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab.tsx` — 概览 tab：内联标题 + 描述编辑器。
- `app/workspace/[workspaceUrl]/components/milestones/MilestoneTasksTab.tsx` — 任务 tab：Sprint 覆盖分解 + 任务列表。
- `app/workspace/[workspaceUrl]/components/milestones/MilestoneDetailTabs.tsx` — tab nav + 切换（纯展示，无数据 hook，便于隔离测试）。
- `__tests__/components/MilestoneOverviewTab.test.tsx`
- `__tests__/components/MilestoneTasksTab.test.tsx`
- `__tests__/components/MilestoneDetailTabs.test.tsx`

**修改：**
- `lib/i18n/*.json`（17 个）— 加 `milestone.tab.overview` / `milestone.tab.tasks`。
- `app/workspace/[workspaceUrl]/components/milestones/MilestoneActionsMenu.tsx` — `onEdit` 改为可选；详情页不再传它，Edit 项隐藏。
- `app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar.tsx` — 改为内联可编辑（状态/日期），移除描述 section。
- `app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx` — 装配 tab + update mutation，移除编辑弹窗。
- `__tests__/components/MilestoneSidebar.test.tsx` — 重写为可编辑版断言。

**不改：** `DetailLayout.tsx`、`MilestoneFormDialog.tsx`（新建流程仍用）、`MilestoneSprintCoverage.tsx`、`TaskListByMilestone.tsx`、任何 `lib/services` / `lib/repositories` / `app/api`、Prisma schema。

---

## Task 1: i18n — 新增里程碑 tab 文案（全 17 locale）

`milestone.tab.overview` / `milestone.tab.tasks` 复用每个 locale **已存在**的 `project.tab.overview` / `project.tab.tasks` 值，保证翻译正确、零自造翻译。

**Files:**
- Modify: `lib/i18n/de.json`, `en-AU.json`, `en-GB.json`, `en.json`, `es-419.json`, `es.json`, `fr.json`, `hi.json`, `id.json`, `ja.json`, `ko.json`, `ms.json`, `ru.json`, `vi.json`, `zh-CN.json`, `zh-TW.json`, `en.json`（即 `lib/i18n/*.json`）

- [ ] **Step 1: 写一次性脚本，给每个 locale 注入两个 key（镜像 project.tab.*）**

新建临时文件 `scripts/_add-milestone-tab-keys.mjs`：

```js
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'lib/i18n'
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.json')) continue
  const path = join(dir, file)
  const json = JSON.parse(readFileSync(path, 'utf8'))
  if (json['milestone.tab.overview'] && json['milestone.tab.tasks']) continue
  const overview = json['project.tab.overview'] ?? 'Overview'
  const tasks = json['project.tab.tasks'] ?? 'Tasks'
  // Insert right after milestone.tab.title if present, else append.
  const next = {}
  let inserted = false
  for (const [k, v] of Object.entries(json)) {
    next[k] = v
    if (k === 'milestone.tab.title') {
      next['milestone.tab.overview'] = overview
      next['milestone.tab.tasks'] = tasks
      inserted = true
    }
  }
  if (!inserted) {
    next['milestone.tab.overview'] = overview
    next['milestone.tab.tasks'] = tasks
  }
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8')
  console.log(`patched ${file}: ${overview} / ${tasks}`)
}
```

- [ ] **Step 2: 跑脚本**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && node scripts/_add-milestone-tab-keys.mjs`
Expected: 打印 16~17 行 `patched <file>: ...`（每个 locale 一行）。

- [ ] **Step 3: 校验所有 locale 都有这两个 key**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && grep -L 'milestone.tab.overview' lib/i18n/*.json`
Expected: 无输出（所有文件都含该 key）。

- [ ] **Step 4: 确认 JSON 合法**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && node -e "const fs=require('fs');for(const f of fs.readdirSync('lib/i18n')){if(f.endsWith('.json'))JSON.parse(fs.readFileSync('lib/i18n/'+f))}console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: 删除临时脚本**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && rm scripts/_add-milestone-tab-keys.mjs`

- [ ] **Step 6: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193
git add lib/i18n
git commit -m "i18n: add milestone.tab.overview/tasks keys [LUM-193]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: MilestoneActionsMenu — `onEdit` 改可选

向后兼容的加法改动：`onEdit` 可选；不传时隐藏 Edit 项。`MilestoneCard` 等现有调用方仍传 `onEdit`，行为不变。

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/milestones/MilestoneActionsMenu.tsx:20-26`, `:55-60`
- Test: `__tests__/components/MilestoneActionsMenu.test.tsx`

- [ ] **Step 1: 写失败测试 —— 不传 onEdit 时无 Edit 项**

在 `__tests__/components/MilestoneActionsMenu.test.tsx` 末尾加：

```tsx
it('hides the Edit item when onEdit is not provided', async () => {
  const user = userEvent.setup()
  render(
    <MilestoneActionsMenu
      archived={false}
      disabled={false}
      onArchiveToggle={() => {}}
      onDelete={() => {}}
    />
  )
  await user.click(screen.getByRole('button', { name: 'Actions' }))
  expect(screen.queryByText('Edit')).toBeNull()
  expect(screen.getByText('Archive')).toBeTruthy()
})
```

> 注：若该测试文件顶部还没 import `userEvent`，加 `import userEvent from '@testing-library/user-event'`；`'Actions'` / `'Edit'` / `'Archive'` 文案以文件现有 intl mock 的映射为准（沿用文件里已有用法，不要新造）。

- [ ] **Step 2: 跑测试确认失败（类型 + 断言）**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx jest __tests__/components/MilestoneActionsMenu.test.tsx`
Expected: FAIL —— 当前 `onEdit` 必填，TS/渲染报错或 Edit 项仍在。

- [ ] **Step 3: 改 props 为可选 + 条件渲染**

`MilestoneActionsMenu.tsx`：把接口改为

```tsx
interface MilestoneActionsMenuProps {
  archived: boolean
  disabled: boolean
  onEdit?: () => void
  onArchiveToggle: () => void
  onDelete: () => void
}
```

解构默认值保持：`onEdit` 可为 undefined。把 Edit 项的渲染条件由 `!archived` 改为 `!archived && onEdit`：

```tsx
{!archived && onEdit ? (
  <DropdownMenuItem onSelect={onEdit}>
    <Pencil className='size-4 mr-2' />
    {intl.formatMessage({ id: 'milestone.edit' })}
  </DropdownMenuItem>
) : null}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx jest __tests__/components/MilestoneActionsMenu.test.tsx`
Expected: PASS（含原有用例）。

- [ ] **Step 5: 类型检查**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193
git add "app/workspace/[workspaceUrl]/components/milestones/MilestoneActionsMenu.tsx" __tests__/components/MilestoneActionsMenu.test.tsx
git commit -m "feat: make MilestoneActionsMenu onEdit optional [LUM-193]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: MilestoneSidebar — 内联可编辑

状态用 shadcn `Select`，开始/目标日期用 `Input type=date`，改动经 `onUpdate` 回调。移除描述 section（描述移到概览 tab）。归档态下控件禁用（只读）。

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar.tsx`（整体替换）
- Test: `__tests__/components/MilestoneSidebar.test.tsx`（整体重写）

- [ ] **Step 1: 重写测试（mock Select 为原生 select；断言回调入参）**

整体替换 `__tests__/components/MilestoneSidebar.test.tsx`：

```tsx
/** @jest-environment jsdom */

const en: Record<string, string> = {
  'milestone.field.status': 'Status',
  'milestone.field.startDate': 'Start date',
  'milestone.field.targetDate': 'Target date',
  'milestone.status.ACTIVE': 'Active',
  'milestone.status.PLANNED': 'Planned',
  'milestone.status.COMPLETED': 'Completed',
  'milestone.status.CANCELLED': 'Cancelled',
  'milestone.archived': 'Archived',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

// Radix Select can't open in jsdom — render a native <select> so onValueChange
// fires on change and we can assert the callback payload.
jest.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
    disabled,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
    disabled?: boolean
  }) => (
    <select
      data-testid='status-select'
      value={value}
      disabled={disabled}
      onChange={e => onValueChange(e.target.value)}
    >
      {['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'].map(s => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { MilestoneSidebar } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar'

function setup(overrides: Partial<React.ComponentProps<typeof MilestoneSidebar>> = {}) {
  const onUpdate = jest.fn()
  render(
    <MilestoneSidebar
      status='ACTIVE'
      startDate='2026-06-01T00:00:00.000Z'
      targetDate='2026-08-31T00:00:00.000Z'
      archived={false}
      onUpdate={onUpdate}
      {...overrides}
    />
  )
  return { onUpdate }
}

test('changing status calls onUpdate with { status }', () => {
  const { onUpdate } = setup()
  fireEvent.change(screen.getByTestId('status-select'), {
    target: { value: 'COMPLETED' },
  })
  expect(onUpdate).toHaveBeenCalledWith({ status: 'COMPLETED' })
})

test('editing start date calls onUpdate with { startDate }', () => {
  const { onUpdate } = setup()
  fireEvent.change(screen.getByLabelText('Start date'), {
    target: { value: '2026-07-01' },
  })
  expect(onUpdate).toHaveBeenCalledWith({ startDate: '2026-07-01' })
})

test('clearing target date calls onUpdate with { targetDate: null }', () => {
  const { onUpdate } = setup()
  fireEvent.change(screen.getByLabelText('Target date'), {
    target: { value: '' },
  })
  expect(onUpdate).toHaveBeenCalledWith({ targetDate: null })
})

test('date inputs prefill from ISO values (sliced to yyyy-mm-dd)', () => {
  setup()
  expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe(
    '2026-06-01'
  )
  expect((screen.getByLabelText('Target date') as HTMLInputElement).value).toBe(
    '2026-08-31'
  )
})

test('archived disables the controls', () => {
  setup({ archived: true })
  expect((screen.getByTestId('status-select') as HTMLSelectElement).disabled).toBe(true)
  expect((screen.getByLabelText('Start date') as HTMLInputElement).disabled).toBe(true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx jest __tests__/components/MilestoneSidebar.test.tsx`
Expected: FAIL —— 当前组件无 `onUpdate`、无可编辑控件。

- [ ] **Step 3: 重写 MilestoneSidebar 为可编辑版**

整体替换 `MilestoneSidebar.tsx`：

```tsx
'use client'

import { useId } from 'react'
import { useIntl } from 'react-intl'
import type { ApiMilestone, MilestoneUpdateInput } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MilestoneStatus } from '@prisma/client'

const STATUSES: MilestoneStatus[] = [
  'PLANNED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
]

interface MilestoneSidebarProps {
  status: ApiMilestone['status']
  startDate: string | null
  targetDate: string | null
  archived: boolean
  onUpdate: (fields: MilestoneUpdateInput) => void
}

/**
 * Milestone metadata rail. Inline-editable status + dates; receives only flat
 * fields (ISP/LoD) and reports single-field patches via onUpdate. Read-only
 * when archived.
 */
export function MilestoneSidebar({
  status,
  startDate,
  targetDate,
  archived,
  onUpdate,
}: MilestoneSidebarProps) {
  const intl = useIntl()
  const fieldId = useId()
  return (
    <div className='flex flex-col gap-4 px-4 pb-6 text-sm lg:px-0'>
      <section>
        <label
          htmlFor={`${fieldId}-status`}
          className='text-xs font-medium text-muted-foreground'
        >
          {intl.formatMessage({ id: 'milestone.field.status' })}
        </label>
        <div className='mt-1 flex items-center gap-2'>
          <Select
            value={status}
            onValueChange={v => onUpdate({ status: v as MilestoneStatus })}
            disabled={archived}
          >
            <SelectTrigger id={`${fieldId}-status`} className='h-7 w-full text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map(s => (
                <SelectItem key={s} value={s}>
                  {intl.formatMessage({ id: `milestone.status.${s}` })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {archived ? (
            <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
              {intl.formatMessage({ id: 'milestone.archived' })}
            </span>
          ) : null}
        </div>
      </section>

      <section>
        <label
          htmlFor={`${fieldId}-start`}
          className='text-xs font-medium text-muted-foreground'
        >
          {intl.formatMessage({ id: 'milestone.field.startDate' })}
        </label>
        <Input
          id={`${fieldId}-start`}
          type='date'
          className='mt-1 h-7 text-xs'
          value={startDate?.slice(0, 10) ?? ''}
          disabled={archived}
          onChange={e => onUpdate({ startDate: e.target.value || null })}
        />
      </section>

      <section>
        <label
          htmlFor={`${fieldId}-target`}
          className='text-xs font-medium text-muted-foreground'
        >
          {intl.formatMessage({ id: 'milestone.field.targetDate' })}
        </label>
        <Input
          id={`${fieldId}-target`}
          type='date'
          className='mt-1 h-7 text-xs'
          value={targetDate?.slice(0, 10) ?? ''}
          disabled={archived}
          onChange={e => onUpdate({ targetDate: e.target.value || null })}
        />
      </section>
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx jest __tests__/components/MilestoneSidebar.test.tsx`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 类型检查（此步会因 MilestoneDetailPage 仍传旧 props 而报错 —— 预期，Task 6 修复）**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx tsc --noEmit 2>&1 | grep -i MilestoneSidebar || echo "no sidebar-self errors"`
Expected: 仅 `MilestoneDetailPage.tsx` 处报 `onUpdate` 缺失 / `description` 多余（调用点未更新），组件自身无错。该残留在 Task 6 清掉。

- [ ] **Step 6: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193
git add "app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar.tsx" __tests__/components/MilestoneSidebar.test.tsx
git commit -m "feat: inline-editable MilestoneSidebar (status + dates) [LUM-193]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: MilestoneOverviewTab（新）

内联标题（仿 ProjectOverviewTab 的 contentEditable）+ 描述编辑器（复用 `DescriptionEditor`）。

**Files:**
- Create: `app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab.tsx`
- Test: `__tests__/components/MilestoneOverviewTab.test.tsx`

- [ ] **Step 1: 写失败测试（mock 掉重型 DescriptionEditor）**

新建 `__tests__/components/MilestoneOverviewTab.test.tsx`：

```tsx
/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

// DescriptionEditor pulls Tiptap — stub it to a button that fires onCommit.
jest.mock('@/app/workspace/[workspaceUrl]/components/DescriptionEditor', () => ({
  DescriptionEditor: ({
    value,
    onCommit,
  }: {
    value: string | null
    onCommit: (html: string | null) => void
  }) => (
    <button data-testid='desc' onClick={() => onCommit('<p>new body</p>')}>
      {value ?? 'empty'}
    </button>
  ),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { MilestoneOverviewTab } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab'

function setup(name = 'Beta release', description: string | null = 'Old body') {
  const onUpdate = jest.fn()
  render(
    <MilestoneOverviewTab
      milestone={{ id: 'm1', name, description }}
      onUpdate={onUpdate}
    />
  )
  return { onUpdate }
}

test('renders the milestone name and current description', () => {
  setup()
  expect(screen.getByText('Beta release')).toBeTruthy()
  expect(screen.getByTestId('desc').textContent).toBe('Old body')
})

test('committing description calls onUpdate with { description }', () => {
  const { onUpdate } = setup()
  fireEvent.click(screen.getByTestId('desc'))
  expect(onUpdate).toHaveBeenCalledWith({ description: '<p>new body</p>' })
})

test('renaming via title blur calls onUpdate with trimmed { name }', () => {
  const { onUpdate } = setup()
  const title = screen.getByText('Beta release')
  title.textContent = '  Gamma  '
  fireEvent.blur(title)
  expect(onUpdate).toHaveBeenCalledWith({ name: 'Gamma' })
})

test('blurring an unchanged title does not call onUpdate', () => {
  const { onUpdate } = setup()
  const title = screen.getByText('Beta release')
  fireEvent.blur(title)
  expect(onUpdate).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx jest __tests__/components/MilestoneOverviewTab.test.tsx`
Expected: FAIL —— 组件不存在（模块解析报错）。

- [ ] **Step 3: 实现组件**

新建 `app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab.tsx`：

```tsx
'use client'

import { useIntl } from 'react-intl'
import type { ApiMilestone, MilestoneUpdateInput } from '@/lib/api-client'
import { DescriptionEditor } from '../DescriptionEditor'
import { TypographyH3 } from '@/components/ui/typography'

interface MilestoneOverviewTabProps {
  milestone: Pick<ApiMilestone, 'id' | 'name' | 'description'>
  onUpdate: (fields: MilestoneUpdateInput) => void
}

/** Overview tab: inline-editable name + description. Mirrors ProjectOverviewTab. */
export function MilestoneOverviewTab({
  milestone,
  onUpdate,
}: MilestoneOverviewTabProps) {
  const intl = useIntl()
  return (
    <div className='px-4 md:px-8 py-8'>
      <div className='mb-8'>
        <TypographyH3
          key={milestone.id}
          contentEditable
          suppressContentEditableWarning
          onBlur={e => {
            const trimmed = e.currentTarget.textContent?.trim() ?? ''
            if (!trimmed || trimmed === milestone.name) {
              e.currentTarget.textContent = milestone.name
              return
            }
            onUpdate({ name: trimmed })
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              e.currentTarget.textContent = milestone.name
              e.currentTarget.blur()
            }
          }}
          className='outline-none cursor-text focus:outline-none'
        >
          {milestone.name}
        </TypographyH3>
      </div>

      <div className='max-w-3xl'>
        <p className='text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3'>
          {intl.formatMessage({ id: 'milestone.field.description' })}
        </p>
        <DescriptionEditor
          key={milestone.id}
          value={milestone.description}
          onCommit={html => onUpdate({ description: html || null })}
          documentId={milestone.id}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx jest __tests__/components/MilestoneOverviewTab.test.tsx`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 类型检查**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx tsc --noEmit 2>&1 | grep -i MilestoneOverviewTab || echo "no overview-tab errors"`
Expected: `no overview-tab errors`。

- [ ] **Step 6: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193
git add "app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab.tsx" __tests__/components/MilestoneOverviewTab.test.tsx
git commit -m "feat: MilestoneOverviewTab with inline name + description [LUM-193]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: MilestoneTasksTab（新）

把现有「Sprint 覆盖分解 + 任务列表」抽成任务 tab（仅迁移位置，复用现有子组件）。

**Files:**
- Create: `app/workspace/[workspaceUrl]/components/milestones/MilestoneTasksTab.tsx`
- Test: `__tests__/components/MilestoneTasksTab.test.tsx`

- [ ] **Step 1: 写失败测试（mock 两个子组件）**

新建 `__tests__/components/MilestoneTasksTab.test.tsx`：

```tsx
/** @jest-environment jsdom */

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneSprintCoverage',
  () => ({
    MilestoneSprintCoverage: ({ coverage }: { coverage: unknown }) => (
      <div data-testid='coverage'>{coverage ? 'has-coverage' : 'no-coverage'}</div>
    ),
  })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/TaskListByMilestone',
  () => ({
    TaskListByMilestone: ({
      projectId,
      milestoneId,
    }: {
      projectId: string
      milestoneId: string
    }) => <div data-testid='tasklist'>{`${projectId}:${milestoneId}`}</div>,
  })
)

import { render, screen } from '@testing-library/react'
import { MilestoneTasksTab } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneTasksTab'

test('renders sprint coverage and the milestone task list', () => {
  render(
    <MilestoneTasksTab projectId='p1' milestoneId='m1' sprintCoverage={null} />
  )
  expect(screen.getByTestId('coverage').textContent).toBe('no-coverage')
  expect(screen.getByTestId('tasklist').textContent).toBe('p1:m1')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx jest __tests__/components/MilestoneTasksTab.test.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现组件**

新建 `app/workspace/[workspaceUrl]/components/milestones/MilestoneTasksTab.tsx`：

```tsx
'use client'

import type { ApiMilestone } from '@/lib/api-client'
import { MilestoneSprintCoverage } from './MilestoneSprintCoverage'
import { TaskListByMilestone } from './TaskListByMilestone'

interface MilestoneTasksTabProps {
  projectId: string
  milestoneId: string
  sprintCoverage: ApiMilestone['sprintCoverage']
}

/** Tasks tab: sprint coverage breakdown + the milestone's task list. */
export function MilestoneTasksTab({
  projectId,
  milestoneId,
  sprintCoverage,
}: MilestoneTasksTabProps) {
  return (
    <div className='space-y-6 px-4 md:px-8 py-8'>
      <MilestoneSprintCoverage coverage={sprintCoverage} />
      <TaskListByMilestone projectId={projectId} milestoneId={milestoneId} />
    </div>
  )
}
```

> 注：`MilestoneSprintCoverage` 的 `coverage` prop 类型须与 `ApiMilestone['sprintCoverage']` 一致。若 tsc 报 `coverage` 类型不匹配（如组件要求非空），改用组件实际的 prop 类型签名（读 `MilestoneSprintCoverage.tsx` 确认）并据此调整 `MilestoneTasksTabProps.sprintCoverage` 的类型 —— 不要用 `as`/`any` 绕过。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx jest __tests__/components/MilestoneTasksTab.test.tsx`
Expected: PASS。

- [ ] **Step 5: 类型检查**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx tsc --noEmit 2>&1 | grep -i MilestoneTasksTab || echo "no tasks-tab errors"`
Expected: `no tasks-tab errors`。

- [ ] **Step 6: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193
git add "app/workspace/[workspaceUrl]/components/milestones/MilestoneTasksTab.tsx" __tests__/components/MilestoneTasksTab.test.tsx
git commit -m "feat: MilestoneTasksTab (coverage + task list) [LUM-193]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: MilestoneDetailTabs（新）— tab nav + 切换

纯展示组件，持本地 tab state，渲染两个 tab。便于隔离测试 tab 逻辑。

**Files:**
- Create: `app/workspace/[workspaceUrl]/components/milestones/MilestoneDetailTabs.tsx`
- Test: `__tests__/components/MilestoneDetailTabs.test.tsx`

- [ ] **Step 1: 写失败测试（mock 两个 tab body，断言切换）**

新建 `__tests__/components/MilestoneDetailTabs.test.tsx`：

```tsx
/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) =>
      ({
        'milestone.tab.overview': 'Overview',
        'milestone.tab.tasks': 'Tasks',
      })[id] ?? id,
  }),
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab',
  () => ({
    MilestoneOverviewTab: () => <div data-testid='overview-body'>overview</div>,
  })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneTasksTab',
  () => ({
    MilestoneTasksTab: () => <div data-testid='tasks-body'>tasks</div>,
  })
)

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MilestoneDetailTabs } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneDetailTabs'

const milestone = {
  id: 'm1',
  projectId: 'p1',
  name: 'Beta',
  description: null,
  sprintCoverage: null,
} as never

test('defaults to the overview tab', () => {
  render(<MilestoneDetailTabs milestone={milestone} onUpdate={() => {}} />)
  expect(screen.getByTestId('overview-body')).toBeTruthy()
  expect(screen.queryByTestId('tasks-body')).toBeNull()
})

test('clicking Tasks switches to the tasks body, and back', async () => {
  const user = userEvent.setup()
  render(<MilestoneDetailTabs milestone={milestone} onUpdate={() => {}} />)

  await user.click(screen.getByRole('button', { name: 'Tasks' }))
  expect(screen.getByTestId('tasks-body')).toBeTruthy()
  expect(screen.queryByTestId('overview-body')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Overview' }))
  expect(screen.getByTestId('overview-body')).toBeTruthy()
  expect(screen.queryByTestId('tasks-body')).toBeNull()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx jest __tests__/components/MilestoneDetailTabs.test.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现组件（tab nav 样式仿 ProjectDetailPage）**

新建 `app/workspace/[workspaceUrl]/components/milestones/MilestoneDetailTabs.tsx`：

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import type { ApiMilestone, MilestoneUpdateInput } from '@/lib/api-client'
import { MilestoneOverviewTab } from './MilestoneOverviewTab'
import { MilestoneTasksTab } from './MilestoneTasksTab'

type Tab = 'overview' | 'tasks'

interface MilestoneDetailTabsProps {
  milestone: ApiMilestone
  onUpdate: (fields: MilestoneUpdateInput) => void
}

/** Tab nav + bodies for the milestone detail page (overview / tasks). */
export function MilestoneDetailTabs({
  milestone,
  onUpdate,
}: MilestoneDetailTabsProps) {
  const intl = useIntl()
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <div className='flex flex-1 flex-col lg:overflow-y-auto'>
      <div className='mt-4 flex shrink-0 items-center gap-1 px-4 md:px-8'>
        {(['overview', 'tasks'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-300'
            )}
          >
            {intl.formatMessage({ id: `milestone.tab.${t}` })}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <MilestoneOverviewTab milestone={milestone} onUpdate={onUpdate} />
      ) : (
        <MilestoneTasksTab
          projectId={milestone.projectId}
          milestoneId={milestone.id}
          sprintCoverage={milestone.sprintCoverage}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx jest __tests__/components/MilestoneDetailTabs.test.tsx`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 类型检查**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx tsc --noEmit 2>&1 | grep -i MilestoneDetailTabs || echo "no detail-tabs errors"`
Expected: `no detail-tabs errors`。

- [ ] **Step 6: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193
git add "app/workspace/[workspaceUrl]/components/milestones/MilestoneDetailTabs.tsx" __tests__/components/MilestoneDetailTabs.test.tsx
git commit -m "feat: MilestoneDetailTabs nav + switching [LUM-193]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 装配 MilestoneDetailPage（mutation + tabs，移除编辑弹窗）

把 update mutation 接上，主内容区换成 `MilestoneDetailTabs`，侧栏改传 `onUpdate`，移除 `editing` state / `MilestoneFormDialog` / `onEdit`。

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx`

- [ ] **Step 1: 改 imports**

`MilestoneDetailPage.tsx` 顶部：
- 删除 `import { MilestoneFormDialog } from '../milestones/MilestoneFormDialog'`
- 删除 `import { MilestoneSprintCoverage } from '../milestones/MilestoneSprintCoverage'`
- 删除 `import { TaskListByMilestone } from '../milestones/TaskListByMilestone'`
- 新增 `import { MilestoneDetailTabs } from '../milestones/MilestoneDetailTabs'`
- 把 `import { milestonesClient } from '@/lib/api-client'` 改为 `import { milestonesClient, type MilestoneUpdateInput } from '@/lib/api-client'`

- [ ] **Step 2: 移除 editing state，新增 update mutation + handleUpdate**

- 删除 `const [editing, setEditing] = useState(false)`（`useState` 若不再被用到，从 react import 里移除）。
- 在 `deleteMutation` 之后、`const { archive, unarchive } = useMilestoneArchive()` 附近，新增：

```tsx
  const updateMutation = useMutation({
    mutationFn: (fields: MilestoneUpdateInput) =>
      milestonesClient.update(milestone!.id, fields),
    onSuccess: () => {
      if (!milestone) return
      qc.invalidateQueries({
        queryKey: queryKeys.milestones.detail(milestone.id),
      })
      qc.invalidateQueries({
        queryKey: queryKeys.milestones.byProject(milestone.projectId),
      })
    },
  })
```

- 在 `archived` / `mutating` 计算附近，新增（`milestone` 已非空，因为前面有 `if (!milestone) return …`）：

```tsx
  const handleUpdate = (fields: MilestoneUpdateInput) =>
    updateMutation.mutate(fields)
```

- [ ] **Step 3: 去掉 actions 菜单的 onEdit**

把 `<MilestoneActionsMenu .../>` 调用里的 `onEdit={() => setEditing(true)}` 整行删除（Task 2 已让该 prop 可选，Edit 项自动隐藏）。

- [ ] **Step 4: 侧栏改可编辑 + 主内容换 tabs + 删弹窗**

把 `return ( <> ... </> )` 块替换为：

```tsx
  return (
    <DetailLayout
      breadcrumb={breadcrumb}
      sidebar={
        <MilestoneSidebar
          status={milestone.status}
          startDate={milestone.startDate}
          targetDate={milestone.targetDate}
          archived={archived}
          onUpdate={handleUpdate}
        />
      }
    >
      <MilestoneDetailTabs milestone={milestone} onUpdate={handleUpdate} />
    </DetailLayout>
  )
```

（即：移除外层 `<>...</>` Fragment、移除原 `<div className='space-y-6 p-4 md:p-8 ...'>` 包裹及其中的 `MilestoneSprintCoverage` / `TaskListByMilestone`、移除末尾 `{editing ? <MilestoneFormDialog .../> : null}`。）

- [ ] **Step 5: 全量类型检查（应彻底清零）**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: 全量相关测试**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx jest __tests__/components/Milestone`
Expected: 全部 PASS（含 Sidebar / OverviewTab / TasksTab / DetailTabs / ActionsMenu / Card / SprintCoverage）。

- [ ] **Step 7: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193
git add "app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx"
git commit -m "feat: milestone detail page tabs + inline editing [LUM-193]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: 全量验证

**Files:** 无（仅校验）

- [ ] **Step 1: 全量类型检查**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 2: 全量测试**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npx jest`
Expected: 全绿（无新失败）。

- [ ] **Step 3: token lint（若有彩色硬编码会拦）**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && npm run lint:tokens`
Expected: PASS。本任务未引入新硬编码颜色（沿用既有 zinc/muted token 类）。

- [ ] **Step 4: 无 console.log 残留**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-193 && grep -rn 'console.log' "app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab.tsx" "app/workspace/[workspaceUrl]/components/milestones/MilestoneTasksTab.tsx" "app/workspace/[workspaceUrl]/components/milestones/MilestoneDetailTabs.tsx" || echo "clean"`
Expected: `clean`

---

## 验证策略小结

- **概览 tab**：渲染名称 + 描述；标题 blur 改名、描述 commit 都断言 `onUpdate` 单字段入参（Task 4）。
- **任务 tab**：渲染覆盖分解 + 任务列表（Task 5）。
- **侧栏内联编辑**：状态（mock 原生 select）/ 日期断言 `onUpdate` 入参与禁用态（Task 3）。
- **tab 切换**：默认概览，点击切到任务再切回（Task 6）。
- **页面装配**：靠 `tsc` + 全量 jest 兜底（Task 7/8）—— 详情页本身数据 hook 多，不单测，逻辑已下沉到可测的子组件。

## 不做（YAGNI）
- 不加 owner / 风险阈值（里程碑无此 schema）。
- 不加 summary / memory tab。
- 不改 `DetailLayout`。
- 不删 `MilestoneFormDialog`（新建流程仍用）。
- tab 状态用本地 state，不进 URL（与项目页一致）。

## 与 spec 的一处实现细节差异
spec 写「移除详情页 Edit 按钮」。实现上通过把 `MilestoneActionsMenu.onEdit` 改为**可选**（向后兼容的加法）来达成 —— 详情页不再传 `onEdit`，kebab 里的 Edit 项自动隐藏；`MilestoneCard` 等其他调用方不受影响。比直接删更安全（不破坏共享组件契约）。
