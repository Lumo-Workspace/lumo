# Day 7 · Task-Run Context Link

> **一句话目标**: 让 Agent 在启动时拿到 task 的历史 context（方案 B）。
>
> **核心产出**: `lumo task context <taskId>` 能返回 Task info + 历史 Runs 的 Summary + Unresolved items。
>
> **纪律**: 不扩 scope。Memory 推到 Week 2。

---

## 方案 B 的 outcome 样板

明天做完之后，对一个真实 task 跑 `lumo task context <taskId>`，应该输出下面这样的 markdown：

```markdown
# Task: LUM-42

**Title**: Implement Team Memory storage
**Status**: In Progress
**Description**: (task description)

## Previous Runs (2)

### Run abc123 · 2 days ago · 1h 20min

**Summary**: (前面 Run 的 summary)
**Unresolved**:

- Schema design not finalized

### Run def456 · yesterday · 30min

**Summary**: (前面 Run 的 summary)
**Unresolved**:

- Migration conflict on memory_type enum
```

如果输出长这样 → Day 7 成功。

---

## 执行顺序

### Step 1 · Run 加 taskId 外键（30min）

- Run 表加 `taskId: String?` 字段
- Prisma migration
- **验证**：Prisma Studio 里能手动给一个 Run 设 taskId

### Step 2 · `lumo session start` CLI（1h）

- 新 CLI 命令 `lumo session start <taskId>`
- 写入 `/tmp/.lumo_current_task`（复用已有的 session 文件机制）
- Hook events 记录时读这个文件，自动给 Run 设 taskId
- **验证**：跑 `lumo session start LUM-xx` → `claude code` → 查 database，这个 Run 关联到 task 了

### Step 3 · `lumo task context` CLI（2h，最复杂）

- 新 CLI 命令 `lumo task context <taskId>`
- Backend API：`GET /api/tasks/:id/context`
- Logic：
  - 查 Task
  - 查该 Task 关联的所有 Run
  - 按时间排序（最新的 Run 在最前）
  - 对每个 Run 提取：duration、summary、unresolved
  - 格式化成 markdown 返回
- **验证**：对一个有多个 Run 的 task 跑这个命令，输出像上面的样板

### Step 4 · Dogfood 测试（1h）

- 创建一个真实 task："Day 7 implement task-run link"
- `lumo session start <id>`
- 用 claude code 实际做这个 feature（meta，但对 dogfood 有价值）
- 做完后跑 `lumo task context`，看输出质量
- 记录观察

---

## End-of-Day 仪式（10min，必做）

1. 跑一次 `lumo task context` 对一个真实的 task
2. 把输出贴到 dev log —— 这是今天的 milestone 证据
3. 写一句话感受：今天这个 feature 对 dogfood 有帮助吗？

---

## 明早 early start 提醒

> **Day 7：让 Agent 在启动时拿到 task 的历史 context。**
> **核心产出：`lumo task context <taskId>` 能返回 Task info + 历史 Runs 的 Summary + Unresolved items。**
> **不扩 scope。Memory 推到 Week 2。**
