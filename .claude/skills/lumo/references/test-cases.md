# Test cases (可反复执行的用例 + 执行记录)

任务下的结构化用例：`setup` / `steps[]` / `verification[]` / `expected`，外加一条 **append-only** 的执行记录流。

**与验收合同平行、互不替代。** 验收合同（`task criteria`）回答「这个任务算不算做完」；test case 回答「这条剧本跑下来什么结果、**在哪个环境**、**跑的哪版代码**」。用例全绿 **不等于** 任务可以 DONE——`lumo task status` 里根本不出现 test case。

句柄是 `<task>/TC<n>`，例如 `LUM-42/TC3`。编号是任务内 1-based 顺序号。

---

## `lumo task testcase add <task>` — 新建用例

| Flag                | 说明                                             |
| ------------------- | ------------------------------------------------ |
| `--title <title>`   | **必填**。用例标题                               |
| `--setup <text>`    | 前置条件，例如 `"The user is on the Dashboard."` |
| `--step <text>`     | **可重复、有序**，至少一条。出现顺序即执行顺序   |
| `--verify <text>`   | 可重复、有序。复验段，可以完全不给               |
| `--expected <text>` | **必填**。预期结果                               |

```bash
lumo task testcase add LUM-42 --title "Dashboard 页脚 FDIC 披露" --setup "The user is on the Dashboard." --step "scroll: to the bottom of the page" --step "assert: the footer shows the FDIC membership line" --verify "refresh: the page" --expected "The FDIC membership disclosure is visible at the bottom of the dashboard."
```

（`--step` / `--verify` 每出现一次就是一条，按出现顺序排。上面为了能被文档校验器逐条验证写成了单行；实际使用时用 shell 续行分成多行更好读。）

输出：`Created LUM-42/TC1 "…"  (3 steps, 2 verification)`

上限（超出即 400）：步骤 1–30 条、复验 0–30 条、每条 ≤ 500 字符、标题 ≤ 200、setup/expected ≤ 2000。

## `lumo task testcase list <task>` — 列表

每行：用例号 · 标题 · 步骤数 · **最近一次执行**（结果 + 环境 + 短 sha + 日期），从没跑过显示 `never run`。

```bash
lumo task testcase list LUM-42
```

```
TC1	Dashboard 页脚 FDIC 披露	3 steps / 2 verify	FAIL on LOCAL @a1b2c3d (2026-09-21)
```

## `lumo task testcase show <task/case>` — 详情 + 执行历史

四段分节打印（步骤带 **1-based** 编号），随后是 run 历史。FAIL 的行显示挂在第几步及**当时的原文快照**，并带上 PR / commit 与陈旧性提示。

```bash
lumo task testcase show LUM-42/TC3
```

带证据的 run，每条证据**自己占一行**（文件名 + url），缩进挂在那条 run 底下——终端里能打开一份证据的唯一形式就是 url，计数打不开（LUM-805）：

```
  2026-09-21  FAIL on LOCAL  #123 @a1b2c3d  step 2: assert: the footer shows the FDIC line  — 页脚只剩版权行
      footer.png  https://blob.example.com/test-evidence/…/abc.png
      jest.log  https://blob.example.com/test-evidence/…/def.log
```

形状不认识的证据条目会被整条丢掉而不是报错——一条脏证据不该让 `show` 挂掉。web 端同一份数据在任务的 Tests tab 里出缩略图。

## `lumo task testcase update <task/case>` — 改用例

Flag 与 `add` 相同，至少给一个。

```bash
lumo task testcase update LUM-42/TC3 --title "Dashboard 页脚 FDIC 披露（改版后）"
```

⚠ **`--step` / `--verify` 是整段替换，不是追加。** 想加一步，得把完整的新列表重新给一遍。

## `lumo task testcase rm <task/case>` — 删用例

**软删**：卡片从列表消失，历史 run 仍可查。走确认信封协议——不带 `--confirm` 时退出 4 并打印信封。

```bash
lumo task testcase rm LUM-42/TC3
```

⚠ **agent 不得自己补 `--confirm`**：那个 flag 的含义是「用户已确认」。把信封里的 `changes` 原样给用户看，他批准后再原样跑 `confirmCommand`。

## `lumo task testcase run <task/case>` — 记一次执行

| Flag                     | 说明                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `--result <r>`           | **必填**。`pass` / `fail` / `blocked`                                               |
| `--env <e>`              | **必填，没有默认值**。`local` / `preview` / `production`                            |
| `--pr <number>`          | 这次跑的是哪个 PR 的改动。必须是本任务名下的 PR                                     |
| `--commit <sha>`         | 这次跑的是哪个 commit。**`--env local` 之外必须显式给**，否则不记                   |
| `--failed-step <n>`      | **1-based**，仅 FAIL 可用，与 `--failed-verify` 互斥                                |
| `--failed-verify <n>`    | **1-based**，仅 FAIL 可用，与 `--failed-step` 互斥                                  |
| `--note <text>`          | 这次执行的自由文本备注                                                              |
| `--evidence <url>`       | 证据链接，可重复                                                                    |
| `--evidence-file <path>` | 上传本地文件作证据，可重复。png/jpeg/webp/gif/txt/log/json，单个 ≤ 10 MB，最多 5 个 |

```bash
lumo task testcase run LUM-42/TC3 --result fail --env local --pr 123 --failed-step 2 --note "页脚只剩版权行" --evidence-file ./screenshot.png
```

```bash
lumo task testcase run LUM-42/TC3 --result pass --env production
```

**commit 坐标只在 `--env local` 时自动探测**（`git rev-parse HEAD` + `git status --porcelain`）。不在 git 仓库里就留 null，不编造。

`--env preview` / `--env production` **不会**去读本地 git —— 本地检出跑的不是那些环境跑的东西。把操作者的 HEAD 记成「生产验过的 commit」是假话；更糟的是如果本地 HEAD 恰好等于 PR head，陈旧性会把它判成 `fresh`，等于伪造一条「生产已验证」。非 local 要记 commit，**必须显式** `--commit <sha>`：由人断言「线上跑的就是这个」，而不是让工具猜。

```bash
lumo task testcase run LUM-42/TC3 --result pass --env production --pr 123 --commit 80b62a3
```

给了 `--commit` 时 `commitDirty` 置 null —— 显式指定 commit 就不再声称知道工作区状态。

---

## 陈旧性：这条 run 验的还是现在的代码吗

只绑 PR 号是不够的——PR 会继续 push，`PASS on #123` 第二天可能验的已是被推翻的代码。所以 run 绑的是 **commit**，读的时候和 PR 当前 head 比：

| 状态     | 条件                             | 呈现                                            |
| -------- | -------------------------------- | ----------------------------------------------- |
| 新鲜     | `run.commitSha === PR 当前 head` | `#123 @a1b2c3d`                                 |
| **陈旧** | 两者都有且不等                   | `#123 @a1b2c3d — PR has since moved to e4f5g6h` |
| **未知** | 任一为 null                      | `#123`（**不声称新鲜**）                        |
| **脏**   | `commitDirty === true`           | `#123 @a1b2c3d (uncommitted changes present)`   |

**Fail-closed**：数据缺一半就是「未知」，绝不乐观地报新鲜。一个假的「已验证」比一个诚实的「不知道」危险得多。

PR 已合并时比的是 merge commit，不是 PR 头——生产上那次执行对应的是合并后的代码。

---

---

## 流程里的提醒（LUM-807）

CLI 会在四个位置提醒记用例。两道门槛：**开工那处不看 PR，其余三处要求任务已有 linked PR 且零用例**。四处都是提示，**都不阻塞 DONE、不消耗 verify 轮次**。

| 位置                               | 门槛              | 长相                                           |
| ---------------------------------- | ----------------- | ---------------------------------------------- |
| `session attach` / `task context`  | 零用例（不看 PR） | `## Test cases` 小节，紧挨验收合同             |
| `Next:` 块                         | 有 PR + 零用例    | 一条 `lumo task testcase add …` 建议，排在最后 |
| `lumo verify` 全绿转 IN_REVIEW     | 有 PR + 零用例    | `Tip:` 一行，提示把刚手验的剧本沉淀下来        |
| `lumo task status` 的 next actions | 有 PR + 零用例    | `• [TEST CASE] … (advisory)` + `run:` 命令行   |

几条语义：

- **开工那处不卡 PR 是故意的**：开工时通常还没有 PR，卡了这条提醒就永远不出现。
- **`Next:` 块里的这条排在最末**，让位给越界、合同、verify——那些才是真拦交付的。`NEXT_STEPS_MAX=3` 的上限没变，被挤掉就不显示。
- **同一屏不重复**：`session attach` / `task context` 已经渲染了 `## Test cases` 小节，它们的 `Next:` 块就不再重复这条。
- **FAIL 轮不提醒**：那一屏属于失败原因。
- **`task status` 的这条是 advisory**：`kind: 'TEST_CASE'`，没有 `blocking` 字段，不计入 `N unmet` 的算术，DONE 闸门读都不读它。
- 任务一旦有任意一条用例（或已 DONE），四处全部静默。

## When to suggest

- 用户描述一条**可反复执行的手工验证剧本**（有前置条件、有编号步骤、有预期结果）→ `testcase add`，而不是塞进验收标准的 `judgeSteps`。`judgeSteps` 是给人做一次性裁定用的；test case 是要跑很多次的。
- 用户说「我在本地跑过了」「我在生产上试了一下」→ `testcase run --env <...>` 把它留痕。这正是这个 feature 存在的理由：把「谁在哪跑过」从某个人的记忆里搬进记录。
- 用户问「这条用例上次跑是什么结果」「这个还验过吗」→ `testcase show`。
- PR 合并、部署完成之后 → 提醒补一次 `--env production` 的执行记录。本地绿和生产上真的验过是两回事。

## 语义坑（最容易搞错的七条）

1. **`--env` 必填无默认。** 整个 feature 的目的就是分清跑在哪；别去猜一个值填进去。
2. **`BLOCKED` = 用例根本没跑起来**（前置条件 / 环境不满足），因此**不能**带 `--failed-step`。跑到一半被外部因素卡住，记 `--result fail` + 定位 + `--note`。
3. **`--failed-step` / `--failed-verify` 是 1-based**，和终端里打印的编号对齐。
4. **`--env production` / `preview` 不自动探 commit**。本地检出 ≠ 线上跑的代码；要记就显式 `--commit`。
5. **`update` 的 `--step` 是整段替换**，不是追加。
6. **`rm` 是软删**，run 历史仍在；且走确认信封，agent 不得自补 `--confirm`。
7. **test case 不是验收合同。** 用例跑绿不代表任务可以 DONE；DONE 看的是 `lumo verify` 与 `lumo task status`。
