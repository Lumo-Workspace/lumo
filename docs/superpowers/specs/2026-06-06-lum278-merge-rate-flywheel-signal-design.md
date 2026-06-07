# LUM-278 — Prove the flywheel: per-fragment merge-rate in task context

**Date**: 2026-06-06
**Milestone**: Context Lineage (System of Record)
**DoD covered**: ⑤ 可见回报 — `lumo task context` 末尾给每个 fragment 附历史 merge 贡献信号。

## Goal

用已累积的 `LineageEdge` 数据,在 `lumo task context` 输出末尾,为每个达到样本阈值的 context fragment 打印一条「历史 merge 贡献」信号(例:`出现在 5 个已闭合任务·4 merged (80%)`)。这是 Context Lineage MVP 最小可见回报,证明边数据真实可用。

## Scope

**In scope** (本任务):
- 按任务去重的聚合查询(repository)
- 服务端口径 + 渲染 + 冷启动门控
- API 字段 + CLI 末尾渲染
- 测试

**Out of scope**(消费其产物,不实现):
- ② 边的出生 / 注入路径落边 (LUM-275)
- ③ outcome 盖戳 PR merged / task done (LUM-277)
- ④ 成本 join token/循环 (LUM-281)
- ⑥ `lumo task lineage <id>` 审计命令
- 真因果(对照重跑)、lineage-aware 排序/裁剪 (LUM-279)、计费 UI、删除/GDPR 传播

依赖说明:边出生(②)与 outcome 盖戳(③)在生产代码中**尚未接线**(仅有 schema + repository)。本任务可独立开发并用 fixture/单测验证;线上信号会在上游落地后才点亮。冷启动门控保证上游未就绪期间不打印任何误导信号。

## 口径(写死,单一真相源)

任务明确警告:「一旦打印 'merge 率 80%' 人就会当因果读,口径不清 = 误导数字」。因此口径在服务端写死:

| 维度 | 决定 |
|---|---|
| **分母** | 该 fragment 出现过、且 `outcome` 已确定(非 `UNKNOWN`)的**去重任务数**(resolvedTasks) |
| **分子** | 上述任务中 `outcome = MERGED` 的**去重任务数**(mergedTasks) |
| **去重粒度** | 按 `taskId` 去重——同一任务多次 run/session 产生的多条边只算一次(不用按边计数的 `aggregateByFragments`) |
| **(fragment, task) 判定** | resolved = 该对含任一非 UNKNOWN 边;merged = 该对含任一 MERGED 边 |
| **在途任务** | 显式排除(`outcome = UNKNOWN` 不进分母)——信号是「已结案历史里的相关性」,不被在途工作稀释 |
| **冷启动阈值** | `MIN_RESOLVED_TASKS = 3`;`resolvedTasks < 3` 的 fragment **整条不显示**(连计数都不显示,「别承诺智能」) |
| **展示** | 百分比 + 分式兜底:`出现在 5 个已闭合任务·4 merged (80%)`。百分比四舍五入,但永远带 `4/5` 形式,避免 `80%(4/5)` 与 `80%(40/50)` 视觉等价 |
| **因果免责** | 段首 caveat 行声明「历史相关性,非因果」 |

## Components

数据流遵循 CLAUDE.md 分层:`Repository → Service → API Route → CLI`。

### 1. Repository — `mergeRateByFragments`

`lib/repositories/lineage-edge.repository.ts` 新增:

```ts
export interface FragmentMergeRate {
  fragmentType: LineageFragmentType
  fragmentId: string
  resolvedTasks: number   // 去重任务数,outcome 已确定
  mergedTasks: number     // 去重任务数,outcome = MERGED
}

async mergeRateByFragments(
  fragments: FragmentRef[],
  tx?: Prisma.TransactionClient
): Promise<FragmentMergeRate[]>
```

实现:
- 空输入短路返回 `[]`。
- `groupBy(['fragmentType','fragmentId','taskId','outcome'])`,`where` = OR(fragments)。
- JS 归约:对每个 `(fragmentType, fragmentId, taskId)`,收集出现过的 outcome 集合。
  - 该对 resolved ⟺ 集合含 `MERGED|REJECTED|REWORKED` 任一。
  - 该对 merged ⟺ 集合含 `MERGED`。
- 每 fragment 汇总:`resolvedTasks` = resolved 的任务数,`mergedTasks` = merged 的任务数。
- 只返回请求过的 fragment;无边的省略(由 caller 做阈值门控)。

**不复用** `aggregateByFragments`(按边计数,同任务多 run 重复算 → 口径错误)。两者并存:`aggregateByFragments` 服务 audit/其它消费方,`mergeRateByFragments` 专供本信号。

### 2. Type 映射 helper(可共享)

服务层 `ContextFragmentType` 与 schema `LineageFragmentType` 不一致,需映射:

```ts
function toLineageFragmentType(t: ContextFragmentType): LineageFragmentType | null
```

| ContextFragmentType | LineageFragmentType |
|---|---|
| MEMORY | MEMORY |
| SLACK_CONTEXT | SLACK_CONTEXT |
| WEB_LINK | WEB_LINK |
| FIGMA_LINK | FIGMA |
| PULL_REQUEST | PR |
| PR_REVIEW_TODO | PR_REVIEW_TODO |
| SESSION | SESSION |
| ARTIFACT / DOCUMENT / COMMENT | `null`(无对应边,跳过) |

放在可被未来 LUM-275 边出生复用的位置(如 `lib/lineage/fragment-type.ts` 或 repository 旁),避免读/写两侧映射漂移。

### 3. Canonical 解析

读侧对 `MEMORY` fragment 先过 `memoryProvenanceRepository.resolveCanonicalFragment(type, id)`,与边出生的 keying 口径对齐(promoted memory 的历史汇总到 canonical id)。非 MEMORY 原样返回。

### 4. Service — `lineageSection`

`lib/services/task-context.service.ts`:
- 取已组装的 `fragments` 清单 → `toLineageFragmentType` 过滤(丢 null)→ MEMORY 过 canonical → 构造 `FragmentRef[]`。
- 调 `lineageEdgeRepository.mergeRateByFragments`。
- 门控 `MIN_RESOLVED_TASKS = 3`:`resolvedTasks < 3` 丢弃。
- 为合格 fragment 构造标签(best-effort,从服务已有的源对象取):
  - MEMORY:memory 文本/标题截断 ~60 字
  - PULL_REQUEST:`#<number> <title>`
  - SLACK_CONTEXT:线程标题
  - WEB_LINK:title/url
  - FIGMA_LINK:name
  - PR_REVIEW_TODO:todo 文本截断
  - SESSION:`<id 前缀> <headline>`
  - 取不到则回退 `[TYPE] <fragmentId 前缀>`
- 渲染 markdown `lineageSection`(字符串,口径与门控全在服务端);**无合格 fragment → 返回 `""`**(整段省略)。

渲染样式:
```
## 飞轮信号 · 历史 merge 贡献

> 口径:分母 = 该片段出现过且 outcome 已确定(merged/否)的去重任务数;分子 = 其中已 merged 的。仅显示样本 ≥ 3 个已闭合任务。这是历史相关性,非因果。

- [MEMORY] "用 color-mix 不要 hsl(var())…" — 出现在 5 个已闭合任务·4 merged (80%)
- [PR] #123 "fix auth" — 出现在 3 个已闭合任务·3 merged (100%)
```

`TaskContext` 接口加 `lineageSection: string`(与 `memorySection` 等同模式,server 预渲染)。

### 5. API + CLI

- API route(task context)透传 `lineageSection`;`TaskContextResponse` 加该字段。
- `cli/src/commands/task-context.ts` `formatTaskContextMarkdown`:
  - **修掉 `data.sessions.length === 0` 的早返回**,改为统一 fall-through。
  - 在 Previous Sessions 块**之后、最末尾**追加:`if (data.lineageSection?.trim()) { lines.push(sanitizeField(data.lineageSection.trimEnd())); lines.push('') }`。
  - 两条 sessions 分支(0 与 >0)都要拼上。

## 错误处理

- 聚合查询失败/边表为空:`mergeRateByFragments` 返回 `[]`,`lineageSection = ""`,context 输出无该段——绝不因 lineage 失败而拖垮 task context 主体。服务层对 lineage 计算包裹 try/catch,失败降级为空段并记日志(不 throw)。
- canonical 解析已有深度/环守卫(max 16 hops),沿用。

## 测试

- **repo**(`__tests__` jest,mock Prisma):
  - 同任务多边只算一次(去重)。
  - resolved 仅含 UNKNOWN → 不计入分母。
  - merged 判定(任一 MERGED 边即 merged)。
  - 阈值边界由 caller 控,repo 返回原始计数。
- **service**:
  - 门控:resolvedTasks 2 → 不出;3 → 出。
  - 格式:百分比四舍五入 + 分式兜底。
  - 无合格 → `lineageSection === ""`。
  - canonical 汇总:promoted memory 的边归到 canonical id。
  - lineage 计算抛错 → 降级空段,不影响其它 section。
- **CLI**:
  - `lineageSection` 渲染在最末尾。
  - sessions==0 与 >0 两分支都追加。
  - sanitize 生效。

## 验收

- 单测全绿;`tsc --noEmit` 无错。
- fixture 下 `lumo task context` 末尾出现飞轮信号块,口径行清晰,冷启动样本不足时整段消失。
