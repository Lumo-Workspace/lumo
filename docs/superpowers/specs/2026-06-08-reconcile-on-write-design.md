# LUM-324 — Reconcile-on-Write: 写入前邻居检索 + 4-op 调和

**Task**: LUM-324
**Milestone**: Memory v6 — Reconcile-on-Write & Lifecycle (Phase 0)
**Date**: 2026-06-08
**Status**: Design approved, pending implementation plan

## 目标

把 Layer 1 / Layer 2 的记忆写入从"盲目 append"演进为 **reconcile-on-write**：写入前先为每条候选事实检索 top-k 相似的现有记忆，再由 LLM 在 **ADD / UPDATE / DELETE / SUPERSEDE / NOOP** 中决策，从而：

- 重复 / 近重复教训不再产生第二条记忆（→ UPDATE / NOOP）
- 矛盾教训产生 SUPERSEDE（而非硬删除）
- 不破坏现有 Layer1(STOP) / Layer2(DONE) 触发与 L2 DB 租约

源自 Mem0 (2504.19413)：写前 top-k 调和 + 检索式注入，在接近全量质量（J 66.88% vs 全量 72.9%）的同时省 ~90% 延迟与 token。

## 范围内 / 范围外

**范围内**
- 两层写路径改造为两段式（Extract → Retrieve → Reconcile → Apply）
- 可插拔 `NeighborRetriever` seam，本期落地词面（lexical）实现
- op schema 扩展含 SUPERSEDE；apply 层 `supersede()` 分支
- 两个测试根（`__tests__/` 与 `tests/`）的单测 + 回归

**范围外（明确推迟）**
- 真向量 embedding / pgvector —— 留作 `NeighborRetriever` 接口后的可插拔实现，由触发门槛驱动（见 DECISION）
- SUPERSEDE 的真正生命周期字段（`invalidatedAt` / `supersededById`）—— **LUM-325**
- 单测验证最小闭环收口 —— **LUM-326**
- 域内 eval harness（recall@k 等）—— **LUM-329**
- 任何 schema 变更（本任务**零 schema**）

## 已定决策（brainstorm 锁定）

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| Embedding 选型 | 抽象 `NeighborRetriever` seam，本期词面检索，真 embedding 暂缓 | 本地无 `AI_GATEWAY_API_KEY`，gateway embedding 本地跑不通；词面实现纯函数本地可验、零依赖、零 schema |
| SUPERSEDE 终态（324） | 发出 + 路由到 `supersede()` 分支，终态暂以 UPDATE-in-place 兑现 | 保旧 id → provenance/lineage 边不断；不预建 325 schema；325 接手只换分支体 |
| 覆盖层 | Layer 1 + Layer 2，共享同一 retriever + SUPERSEDE 机制 | 两层 extract/apply 同构；L2（跨项目、200-cap）是 top-k 真正发力处 |
| 检索形态 | 两段式（Mem0 原教旨，per-candidate 邻居精度） | per-candidate 邻居比"相对整批输入"排序更准 |
| Pass 2 调用 | 批量单调用（一次喂 `{候选, 它的 top-k 邻居}[]`） | 保 per-candidate 邻居精度，但每层仍 2 次 LLM 调用，避免 N 次爆炸 |
| top-k | k = 10 | 对齐 Mem0 top-10 |
| L2 是否开 DELETE | 否（同今天）| consolidation 不硬删 PROJECT 记忆；矛盾走 SUPERSEDE |

## 架构 / 数据流

每层从"单次 LLM 调用"改为 **Extract → Retrieve → Reconcile → Apply** 四步：

```
Pass 1  extractCandidates()    输入信号 → 候选事实[]        (不看现有记忆，纯抽取)
  ↓
Retrieve  NeighborRetriever     每条候选 → top-k 相似现有记忆  (词面，无 LLM)
  ↓
Pass 2  reconcileCandidates()   {候选, 邻居}[] → op[]         (per-candidate 决策)
  ↓
Apply   applyOperations()       原子事务写入 + supersede() 分支
```

### Layer 1（STOP 触发，task-scope）
- **Pass 1**：从 session 事件 + task context 抽候选事实（不喂现有记忆）
- **Retrieve**：邻居池 = 该 task 现有 TASK 记忆（池子天然小，top-k ≈ 全量）
- **Pass 2**：`{候选, 邻居}[]` → ops，集合 = **ADD / UPDATE / DELETE / SUPERSEDE / NOOP**
- **Apply**：现有原子事务 + `supersede()` 分支

### Layer 2（DONE 触发，project-scope）
- **Pass 1**：从最近 200 条 TASK 记忆 + constitution 抽候选 PROJECT 教训，候选携带 `sourceMemoryIds`（供 provenance）
- **Retrieve**：邻居池 = 现有 PROJECT 记忆
- **Pass 2**：`{候选, 邻居}[]` → ops，集合 = **ADD / UPDATE / SUPERSEDE / NOOP**（不开 DELETE）
- **Apply**：现有原子事务 + provenance 写入（LUM-280 链路保留）+ `supersede()` 分支
- **不动**：lease claim / release、租约 TTL

## 组件

### NeighborRetriever seam（embedding 插拔点）

```ts
interface NeighborRetriever {
  retrieve(
    query: { category: MemoryCategory; text: string },
    pool: MemoryRow[],
    k: number
  ): MemoryRow[]
}
```

- **`LexicalNeighborRetriever`（本期实现）**：复用 `lib/similarity.ts` 的 Dice/bigram，算候选文本 vs 池内每条记忆文本的相似度，同类目软加权，返回 top-k（含一个很低的 floor 阈值剔除完全无关项）。纯函数，本地可跑可测。
- **DIP 注入**：服务层注入 retriever，默认 lexical。未来 `EmbeddingNeighborRetriever`(pgvector) 直接换实现，调用方不变。

### `memoryContentToText(category, content)`

新增纯函数，把分类目 JSON content 拍平成可比文本（query 文本与 pool 文本共用）。覆盖四类目（TRAP/DECISION/CONVENTION/PROCEDURAL）的 headline + 主体字段。

### SUPERSEDE apply（324 interim）

`supersede(oldId, newContent)` = **UPDATE-in-place**：把旧记忆 content 就地改写成新教训。
- 保留旧 **id** → 指向它的 provenance / lineage 边不断（优于 DELETE+ADD）。
- 325 接手：分支体换成 keep-old + `invalidatedAt` + 新行 + `supersededById`，**调用点不变**。

## 文件落点

**新增**
- `lib/services/memory/neighbor-retriever.ts` — `NeighborRetriever` 接口 + `LexicalNeighborRetriever`
- `lib/memory/content-text.ts` — `memoryContentToText` 纯函数

**改造**
- `lib/services/memory/layer1-extract.ts` / `layer2-extract.ts` — 拆 `extractCandidates`(Pass1) + `reconcileCandidates`(Pass2)；op schema 加 SUPERSEDE
- `lib/services/memory/layer1-prompt.ts` / `layer2-prompt.ts` — 拆 extract-prompt（抽取）+ reconcile-prompt（调和，含 SUPERSEDE 判据：近重复→UPDATE/NOOP，矛盾→SUPERSEDE）
- `lib/services/memory/layer1.service.ts` / `layer2.service.ts` — 编排四步 + 注入 retriever（不碰 STOP/DONE 触发与 L2 租约）
- `lib/services/memory/layer1-apply.ts` / `layer2-apply.ts` — 加 `supersede()` 分支

## 测试策略

两个测试根（`__tests__/` 与 `tests/`）按符号归属覆盖：

- `neighbor-retriever.test.ts`：排序正确性 / top-k / 池 < k / 空池 / 同类目加权 / floor 阈值
- `content-text.test.ts`：四类目拍平
- reconcile 层：mock model（`@ai-sdk/gateway` 走**动态 import** 断 TransformStream 链），断言近重复 → UPDATE/NOOP、矛盾 → SUPERSEDE
- apply：`supersede()` 保 id + 改写 content + 旧 id 的 provenance 边存活
- 回归：现有 layer1/2 测试适配两段式；STOP/DONE 触发与租约测试须仍绿

> 注：Pass 1 / Pass 2 走 gateway，本地无 key 跑不通真实调用 → 测试一律 mock model；retriever 与 content-text 是纯函数，本地真跑。

## 风险 / 非破坏保证

- **行为变化是预期的**：两段式会改 op 分布——这是改进不是零回归，靠单测 + 后续 LUM-329 eval 兜。
- **不动**：STOP/DONE 触发、L2 租约 claim/release、`waitUntil` fire-and-forget、失败降级为空 op。
- **零 schema 变更**：候选瞬态、SUPERSEDE = UPDATE-in-place；schema 留给 325。
- **成本**：每层 LLM 调用翻倍（2 次/层/触发）；deepseek-v4-flash + 后台执行（无 deadline）可接受。

## 产出记忆（DECISION）

- **what**：采用 reconcile-on-write 两段式 + 可插拔 `NeighborRetriever`
- **why**：Mem0 证明写前调和近全量质量省 ~90% 成本；现状已 ADD/UPDATE/DELETE 但缺语义邻居检索与 SUPERSEDE
- **alternatives**：pgvector now / 外部 embedding API / **词面 seam 暂缓**（选后者：本地可验、零依赖、零 schema）
- **触发门槛**：单项目 PROJECT 记忆 > ~50 条，或 LUM-329 eval recall@k 跌破阈值 → 换 `EmbeddingNeighborRetriever`(pgvector)
- **implications**：`NeighborRetriever` 留 embedding 口、SUPERSEDE 终态待 LUM-325、LLM 调用翻倍

## 依赖与后续

- **LUM-325**：生命周期字段落地，`supersede()` 分支体换成 invalidate-not-delete
- **LUM-326**：单测验证最小闭环收口
- **LUM-329**：域内 eval harness，驱动 embedding 升级触发门槛
