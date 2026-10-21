# Test cases (可反复执行的用例 + 执行记录)

任务下的结构化用例：`setup` / `steps[]` / `verification[]` / `expected`，外加一条 **append-only** 的执行记录流。

test case 回答「这条剧本跑下来什么结果、**在哪个环境**、**跑的哪版代码**」——这是任务交付证据的落点。用例全绿 **不等于** 任务可以 DONE；`lumo task status` 只把它的判决信号列为 advisory（已证缺陷除外，见 [test-case-runs.md](test-case-runs.md)）。

**两套父对象，一套命令。** `lumo task testcase …` 和 `lumo milestone testcase …` 的动词、flag、输出完全一致；下文示例用任务写法，换成 `milestone` 即可。里程碑特有的差异见文末 [里程碑用例](#里程碑用例milestone-testcase)。记录执行（`run`）、封顶、陈旧性、判决信号与 `disposition` 在 [test-case-runs.md](test-case-runs.md)。

句柄统一是 `<父对象>/TC<n>`：任务用例 `LUM-42/TC3`，里程碑用例用里程碑 slug，例如 `headless-web-cli/TC3`（`milestone list` 第一列就是 slug）。编号是父对象内 1-based 顺序号。`add` / `list` 只带父对象：任务可省略（用 session 绑定的任务），里程碑必须写。

---

## `lumo task|milestone testcase add [<task>] | <milestone>` — 新建用例

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

`--requires-env <local|preview|production|none>` 声明用例只在某环境能证明（见 [test-case-runs.md](test-case-runs.md#可证明性上限)）。

上限（超出即 400）：步骤 1–30 条、复验 0–30 条、每条 ≤ 500 字符、标题 ≤ 200、setup/expected ≤ 2000。

## `lumo task|milestone testcase list [<task>] | <milestone>` — 列表

`--json` prints `{ version, testCases, total, nextCursor, summary }` (each case with its runs).

每行：用例号 · 标题（终端里带 `ID  TITLE  STEPS  LAST RUN` 表头、只截断最后的 LAST RUN 列；接管道时 tab 分列、无表头、不截断） · 步骤数（用例声明了 `--requires-env` 时附 `· Only proves on <ENV>`）· **最近一次执行**：结果 + 环境 + **封顶结论**（`→ UNPROVEN (no evidence | only proves on X | N skipped | N unobserved)`）+ 短 sha + 执行时间（接管道时是 UTC 的 `2026-10-06T08:00:00Z`，终端里是本地时间加时区偏移 `2026-10-06 19:00 +11:00`）+ 执行人，再用 `·` 接归因（`cause: defect|outdated|external|unknown`）、裁定（`ruled KNOWN_DEFECT`）、进度（`failed at step 2` / `3 of 4 steps passed`）。从没跑过显示 `never run`。

列表末尾空一行打汇总，口径与 web Record 页「测试用例」行一致（服务端 `summarizeTestCases`）：`N/M passing`，有则再接 `· x failing · y unproven/blocked · z never run`；任务上还有 `· k proven defect(s) awaiting a ruling (blocks DONE)`（里程碑的关闭闸另有规则，不打这一截）。`passing` 只算封顶后仍是 PASS 的最新 run——一个零证据 PASS 不算。

```bash
lumo task testcase list LUM-42
```

```
TC1	Dashboard 页脚 FDIC 披露	3 steps / 2 verify	FAIL on LOCAL @a1b2c3d 2026-09-21T06:12:00Z by Chao Li via session 86dce765 · cause: defect · failed at step 2
TC2	退款落到原卡	2 steps / 1 verify · Only proves on PRODUCTION	PASS on LOCAL → UNPROVEN (only proves on PRODUCTION) 2026-10-06T08:00:00Z by Chao Li · 3 of 3 steps passed

0/2 passing · 1 failing · 1 unproven/blocked · 1 proven defect awaiting a ruling (blocks DONE)
```

封顶、逐步报告、汇总都由**服务端推导后随 GET 响应返回**（每条 run 上的 `ceiling` / `stepReport`，列表上的 `summary`；任务详情的 run 还带 `review`），CLI 只渲染、不重算——与 web 同一组纯函数。旧服务端不发这些字段时 CLI 退回旧的打印方式，不编结论。

**执行人**：`by <成员名>`；run 来自 agent session 时再附 `via session <短 id>`。CLI 跑的 run 记下的成员是 token 主人，所以「人手动」还是「agent 代跑」看有没有 `via session`（`testcase run` 在 Claude Code 里跑时自动带上当前 session；1.96.0 之前的 CLI 不带，那些 run 没有 `via session`）。`runner not recorded` = 这条 run 没记执行人（不是「没人」）；旧服务端不发这个字段时什么都不打。`show` 的每条 run 行同样带它。

## `lumo task|milestone testcase show <parent>/TC<n>` — 详情 + 执行历史

`--json` prints `{ version, testCase, runs, pullRequests }`.

标题下一行是用例的环境约束（`Only proves on PRODUCTION`，没声明不打），然后四段分节打印（步骤带 **1-based** 编号），随后是 run 历史。每条 run 的结论行：`<执行时间>  <上报结果> on <环境>[ → UNPROVEN (原因)]  [cause: …]  <PR / commit 与陈旧性>  <执行人>  — <note>`。封顶原因与 `testcase run` 回显同一套措辞（环境 / 未观察 / 跳过 / 无证据）。

```bash
lumo task testcase show LUM-42/TC3
```

带证据的 run，每条证据**自己占一行**（文件名 + url），缩进挂在那条 run 底下——终端里能打开一份证据的唯一形式就是 url，计数打不开。用 `--step-evidence` 挂到某一步的证据列在**那一步的行下面**（再缩进一层），没挂到任何一步的才列在这条 run 的末尾——与 web `TestCaseRunReport` 同一份分配（服务端 `stepReport.rows[].evidence`）。旧服务端不发逐步报告时全部证据照旧列在末尾：

```
  2026-09-21  FAIL on LOCAL  #123 @a1b2c3d  by Chao Li via session 86dce765  step 2: assert: the footer shows the FDIC line  — 页脚只剩版权行
      footer.png  https://blob.example.com/test-evidence/…/abc.png
      jest.log  https://blob.example.com/test-evidence/…/def.log
```

已被人类裁定过的 run（见下方 `testcase disposition`）在证据行之前多一行裁定说明——裁定清掉的是「拦」，不是「有这回事」，那条 run 照常显示：

```
  2026-09-23  FAIL on LOCAL  @0f27392  step 1: …  — 页脚只剩版权行
      ✓ ruled KNOWN_DEFECT via CLI 2026-09-23  — tracked in LUM-900
      footer.png  https://blob.example.com/test-evidence/…/abc.png
```

run 行下面是**完整逐步报告**（与 web `TestCaseRunReport` 同源同数）：先一行进度——`failed at step 2` / `failed at verification 1`，否则 `x of y steps passed`；整条 run 没逐步记录时是 `no per-step results were recorded for this run`（BLOCKED 不打）。然后**每一步一行**，状态靠符号区分：

| 符号 | 状态                             | 含义                               |
| ---- | -------------------------------- | ---------------------------------- |
| `✓`  | passed                           | 显式上报 PASS（只有它算通过）      |
| `✗`  | failed                           | 失败点                             |
| `•`  | `(reached — no per-step result)` | 失败点之前、执行流经过但没逐步结论 |
| `○`  | `(not reached)`                  | 失败点之后，或整条 BLOCKED         |
| `?`  | `(not observed)`                 | `--unproven` 声明没能观察到的复验  |
| `-`  | `(no per-step result)`           | 没逐步结论、也没有失败点可参照     |
| `»`  | `(skipped: 原因)`                | 显式 SKIP                          |

有耗时的步骤附 `300ms` / `1.2s`。再往下依次是实际观察、裁定、证据：

```
  2026-10-06  FAIL on PRODUCTION  [cause: defect]  by Chao Li
    failed at verification 1
    ✓ step 1: open /billing/invoices/inv_1042 (1.2s)
    ✓ step 2: click Refund, fill 40.00
    ✗ verification 1: banner says Refunded to Visa 4242 (300ms)
    ○ verification 2: the card statement shows the refund (not reached)
    actual: Issued as store credit
```

步骤证据挂在步骤下面，run 级证据在最后：

```
  2026-10-17  PASS on LOCAL  by Chao Li via session 86dce765
    2 of 2 steps passed
    ✓ step 1: open the invoice
        invoice.png  https://lumo.example/api/files/test-evidence/…/f1
    ✓ step 2: click Refund
      jest.json  https://lumo.example/api/files/test-evidence/…/f2
```

`--json` 里每条 run 的 `review` 键**恒为 `null`**（键保留只为不打断依赖该形状的脚本）。

形状不认识的证据条目会被整条丢掉而不是报错——一条脏证据不该让 `show` 挂掉。web 端同一份数据在任务 **Record** 页的「测试用例」区段里出缩略图（旧的 `/tests` 链接自动落到这里）。

## `lumo task|milestone testcase download <parent>/TC<n> <dir>` — 用 API key 把证据存到本地

`/api/files/…` 下的证据要认证（匿名 401），浏览器外打不开 `show` 里的 url。`download` 用当前 CLI 的 API key 把这条用例**全部 run** 的 Lumo 托管证据下载到 `<dir>/<YYYY-MM-DD>-<result>-<run id 末 8 位>/`（目录不存在就建），每个文件一行 `saved <本地路径>`：

```bash
lumo task testcase download LUM-42/TC3 ./evidence
lumo milestone testcase download headless-web-cli/TC1 ./evidence
```

```
LUM-42/TC3  Refund to card

Downloading evidence to ./evidence:
  saved evidence/2026-10-17-pass-x1y2z3w4/invoice.png
  CI run  https://ci.example.com/7  (external link, not downloaded)
  ✗ jest.json: HTTP 404
```

- 只下 `/api/files/` 下的 Lumo 托管文件；外部链接只列出并注明 `external link, not downloaded`。请求一律发往已配置的 API 地址（key 不会发给证据 url 里的其它主机、也不打印），不跟随重定向；边读边写盘，单个文件超过 100 MiB 停下并删掉写了一半的文件。
- 本地文件名 = 清理过的原文件名（去控制符、`/` `\`、`..`、前导点，按字节限长）；同名加 `-2`、`-3`，不覆盖目录里已有文件。
- 单个文件失败打一行 `✗` 继续；任一失败命令退出码为 1。没有选 run 的选项：下的就是 `show` 列出的全部 run。
- 只有 `download` 会写本地文件：Codex 里它留在沙箱内（会先问），`show` 仍是只连服务端、直接放行。
- 什么时候用：要把截图 / 日志拿到本地看、附进别处，或核对证据内容（`show` 只给 url）。

## `lumo task|milestone testcase update <parent>/TC<n>` — 改用例

Flag 与 `add` 相同，至少给一个。

```bash
lumo task testcase update LUM-42/TC3 --title "Dashboard 页脚 FDIC 披露（改版后）"
```

⚠ **`--step` / `--verify` 是整段替换，不是追加。** 想加一步，得把完整的新列表重新给一遍。

## `lumo task|milestone testcase delete <parent>/TC<n>` — 删用例

**软删**：卡片从列表消失，历史 run 仍可查。走确认信封协议——不带 `--confirm` 时退出 4 并打印信封。

```bash
lumo task testcase delete LUM-42/TC3
lumo milestone testcase delete headless-web-cli/TC1
```

⚠ **agent 不得自己补 `--confirm`**：那个 flag 的含义是「用户已确认」。把信封里的 `changes` 原样给用户看，他批准后再原样跑 `confirmCommand`。

## 流程里的提醒

CLI 会在四个位置提醒记用例。两道门槛：**开工那处不看 PR，其余三处要求任务已有 linked PR 且零用例**。四处都是提示，**都不阻塞 DONE**。

- `session attach` / `task show --full` — 门槛: 零用例（不看 PR）; 长相: `## Test cases` 小节
- `Next:` 块 — 门槛: 有 PR + 零用例; 长相: 一条 `lumo task testcase add …` 建议，排在最后
- `lumo task status` 的 next actions — 门槛: 有 PR + 零用例; 长相: `• [TEST CASE] … (advisory) — run:` + 下一行单独的命令
- `lumo task status` 的 next actions — 门槛: 用例有判决信号; 长相: `• [TEST CASE] TC3 … — reported PASS, capped to UNPROVEN (advisory)`

几条语义：

- **开工那处不卡 PR 是故意的**：开工时通常还没有 PR，卡了这条提醒就永远不出现。
- **`Next:` 块里的这条排在最末**，让位给越界等真拦交付的提示。`NEXT_STEPS_MAX=3` 的上限没变，被挤掉就不显示。
- **同一屏不重复**：`session attach` / `task show --full` 已经渲染了 `## Test cases` 小节，它们的 `Next:` 块就不再重复这条。
- **`task status` 的这条是 advisory**：`kind: 'TEST_CASE'`，没有 `blocking` 字段，DONE 闸门读都不读它。
- 任务一旦有任意一条用例（或已 DONE），四处全部静默。

## When to suggest

- 用户描述一条**可反复执行的手工验证剧本**（有前置条件、有编号步骤、有预期结果）→ `testcase add`。test case 是要跑很多次的。
- 用户说「我在本地跑过了」「我在生产上试了一下」→ `testcase run --env <...>` 把它留痕。这正是这个 feature 存在的理由：把「谁在哪跑过」从某个人的记忆里搬进记录。
- **记 run 的同时就把证据带上**（`--evidence-file <path>` / `--evidence <url>`）。跑之前先把命令输出 `tee` 成一个 `.log`，别等记完 run 再回头找——那时候终端已经滚掉了。`--result fail` 基本必须带（失败在哪一步、当时屏幕上是什么，光靠 `--note` 复述不回来）；`pass` 也尽量带，否则记录里只剩「PASS on LOCAL」这一句谁都复核不了的断言。CLI 在零证据时会打一行提醒。
- 用户问「这条用例上次跑是什么结果」「这个还验过吗」→ `testcase show`。
- PR 合并、部署完成之后 → 提醒补一次 `--env production` 的执行记录。本地绿和生产上真的验过是两回事。

## 语义坑（最容易搞错的十条）

1. **`--env` 必填无默认。** 整个 feature 的目的就是分清跑在哪；别去猜一个值填进去。
2. **`BLOCKED` = 用例根本没跑起来**（前置条件 / 环境不满足），因此**不能**带 `--failed-step`。跑到一半被外部因素卡住，记 `--result fail` + 定位 + `--note`。
3. **`--failed-step` / `--failed-verify` / `--step s<n>` 都是 1-based**，和终端里打印的编号对齐。
4. **`--env production` / `preview` 不自动探 commit**。本地检出 ≠ 线上跑的代码；要记就显式 `--commit`。
5. **`update` 的 `--step` 是整段替换**，不是追加。
6. **`rm` 是软删**，run 历史仍在；且走确认信封，agent 不得自补 `--confirm`。
7. **用例跑绿不代表任务可以 DONE。** DONE 是用户的裁定（`--status done` 的 exit-4 信封；仅当关联 PR 全部已合并且无阻挡项时一步执行），闸门见 `lumo task status`（READY 时附 DONE 就绪段）。
8. **`--cause unknown` 是合法答案。** FAIL 必须归因，但「没判断出来」本身就是一种诚实的归因；不要为了填满字段瞎选一个 `defect`（它还会因缺证据被 400 挡回来）。
9. **`UNPROVEN` 不是 FAIL。** 它说的是「这次没能确认」，不是「测出问题了」。看到它别去修一个没坏的东西——去补上验得了的那次执行。
10. **一条没有证据的 run 只是个断言。** `PASS on LOCAL` 本身不可复核——它把「凭什么说它绿」留在了某个人的记忆里，正是这个 feature 要终结的东西。证据要在跑的当下留（`tee` 到 `.log` 再 `--evidence-file`），事后补不回来。零证据时 CLI 会提醒一行，但它只是提醒：**不阻塞、也不会替你留档**。

## 里程碑用例（milestone testcase）

Milestone test cases are cross-task, end-to-end cases and the milestone close contract. Everything above applies; the differences are only about the parent:

- The parent is the **milestone**, named by its slug in the handle (`headless-web-cli/TC3`; name or id also resolve). Pass `--project <ref>` when two projects share the slug or name (a task case accepts `--project` and ignores it). Printed handles use the slug, so they can be pasted back.
- `run` refuses `--pr` with exit 2 (a milestone spans many PRs; the commit is recorded instead) and prints no task status digest.
- `disposition` is the same three-step handshake, but the two rulings differ: KNOWN_DEFECT lets the milestone close, NOT_A_DEFECT keeps the case holding the milestone until it passes on a re-run. Only a proven defect can be dispositioned. Never add `--confirm-read` / `--confirm` yourself.

| Latest run of the case                                         | Gate state | Reason        |
| -------------------------------------------------------------- | ---------- | ------------- |
| none                                                           | held       | NOT_RUN       |
| PASS (including UNPROVEN)                                      | open       |               |
| FAIL, proven implementation defect, dispositioned KNOWN_DEFECT | open       |               |
| FAIL, proven implementation defect, not yet ruled on           | held       | PROVEN_DEFECT |
| any other FAIL (including one ruled NOT_A_DEFECT)              | held       | FAILING       |
| BLOCKED                                                        | held       | BLOCKED       |

```bash
lumo milestone testcase add headless-web-cli --title "PR review round-trip" --step "open a PR in a connected repo" --step "wait for the review" --verify "the review comment is on the PR" --expected "one review comment per finding" --requires-env production
lumo milestone testcase run headless-web-cli/TC1 --result pass --env production --commit 0d46921 --step s1-2=pass --step v1=pass --evidence https://github.com/o/r/pull/1#issuecomment-1
lumo milestone testcase list headless-web-cli
lumo milestone testcase show headless-web-cli/TC1
lumo milestone testcase download headless-web-cli/TC1 ./evidence
lumo milestone testcase update headless-web-cli/TC1 --expected "one review comment per finding, on the right line"
lumo milestone testcase disposition headless-web-cli/TC1 --known-defect --note "shipping with the line-offset bug"
```

### When to suggest `milestone testcase`

- A steward session planning a milestone ("what does done mean for this milestone") -> `testcase add` for each cross-task end-to-end scenario.
- After the last task of a milestone lands -> run each case with `testcase run`, in the environment the case requires.
- `milestone show` says `Close gate: held` -> `testcase list` to see which case holds it and why.
