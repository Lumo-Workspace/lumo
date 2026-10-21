# Test cases (可反复执行的用例 + 执行记录)

任务下的结构化用例：`setup` / `steps[]` / `verification[]` / `expected`，外加一条 **append-only** 的执行记录流。

test case 回答「这条剧本跑下来什么结果、**在哪个环境**、**跑的哪版代码**」——这是任务交付证据的落点（LUM-942 起任务级验收标准 / `lumo verify` 已移除）。用例全绿 **不等于** 任务可以 DONE；`lumo task status` 只把它的判决信号列为 advisory（见下方）。

**两套父对象，一套命令（LUM-1233）。** `lumo task testcase …` 和 `lumo milestone testcase …` 的动词、flag、输出完全一致，共用一套实现；本文件是两者唯一的说明，下文示例用任务写法，换成 `milestone` 即可。里程碑特有的差异见文末 [里程碑用例](#里程碑用例milestone-testcase)。

句柄统一是 `<父对象>/TC<n>`：任务用例 `LUM-42/TC3`，里程碑用例用里程碑 slug，例如 `headless-web-cli/TC3`（`milestone list` 第一列就是 slug）。编号是父对象内 1-based 顺序号。`add` / `list` 只带父对象：任务可省略（用 session 绑定的任务），里程碑必须写。

已移除（打印 `was removed. Use: …`、exit 2、不执行）：`testcase rm` → `testcase delete`；里程碑的旧两参写法 `milestone testcase show <milestone> <case>`（`run` / `update` / `disposition` / `download` 同理）→ `milestone testcase show <milestone>/TC<n>`。

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

上限（超出即 400）：步骤 1–30 条、复验 0–30 条、每条 ≤ 500 字符、标题 ≤ 200、setup/expected ≤ 2000。

## `lumo task|milestone testcase list [<task>] | <milestone>` — 列表

`--json` prints `{ version, testCases, total, nextCursor, summary }` (each case with its runs).

每行：用例号 · 标题（终端里带 `ID  TITLE  STEPS  LAST RUN` 表头、只截断最后的 LAST RUN 列；接管道时 tab 分列、无表头、不截断，LUM-1232） · 步骤数（用例声明了 `--requires-env` 时附 `· Only proves on <ENV>`）· **最近一次执行**：结果 + 环境 + **封顶结论**（`→ UNPROVEN (no evidence | only proves on X | N skipped | N unobserved)`）+ 短 sha + 执行时间（接管道时是 UTC 的 `2026-10-06T08:00:00Z`，终端里是本地时间加时区偏移 `2026-10-06 19:00 +11:00`；LUM-1232）+ 执行人，再用 `·` 接归因（`cause: defect|outdated|external|unknown`）、裁定（`ruled KNOWN_DEFECT`）、进度（`failed at step 2` / `3 of 4 steps passed`）。从没跑过显示 `never run`。

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

**执行人**（LUM-1008）：`by <成员名>`；run 来自 agent session 时再附 `via session <短 id>`。CLI 跑的 run 记下的成员是 token 主人，所以「人手动」还是「agent 代跑」看有没有 `via session`（`testcase run` 在 Claude Code 里跑时自动带上当前 session；1.96.0 之前的 CLI 不带，那些 run 没有 `via session`）。`runner not recorded` = 这条 run 没记执行人（不是「没人」）；旧服务端不发这个字段时什么都不打。`show` 的每条 run 行同样带它。

## `lumo task|milestone testcase show <parent>/TC<n>` — 详情 + 执行历史

`--json` prints `{ version, testCase, runs, pullRequests }`.

标题下一行是用例的环境约束（`Only proves on PRODUCTION`，没声明不打），然后四段分节打印（步骤带 **1-based** 编号），随后是 run 历史。每条 run 的结论行：`<执行时间>  <上报结果> on <环境>[ → UNPROVEN (原因)]  [cause: …]  <PR / commit 与陈旧性>  <执行人>  — <note>`。封顶原因与 `testcase run` 回显同一套措辞（环境 / 未观察 / 跳过 / 无证据）。

```bash
lumo task testcase show LUM-42/TC3
```

带证据的 run，每条证据**自己占一行**（文件名 + url），缩进挂在那条 run 底下——终端里能打开一份证据的唯一形式就是 url，计数打不开（LUM-805）。用 `--step-evidence` 挂到某一步的证据（LUM-1185）列在**那一步的行下面**（再缩进一层），没挂到任何一步的才列在这条 run 的末尾——与 web `TestCaseRunReport` 同一份分配（服务端 `stepReport.rows[].evidence`）。旧服务端不发逐步报告时全部证据照旧列在末尾：

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

run 行下面是**完整逐步报告**（LUM-1011 / LUM-1185，与 web `TestCaseRunReport` 同源同数）：先一行进度——`failed at step 2` / `failed at verification 1`，否则 `x of y steps passed`；整条 run 没逐步记录时是 `no per-step results were recorded for this run`（BLOCKED 不打）。然后**每一步一行**，状态靠符号区分：

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

`--json` 里每条 run 仍带 `review` 键，自 LUM-1231 起**恒为 `null`**（抽查功能已删除；键保留只为不打断依赖该形状的脚本）。

形状不认识的证据条目会被整条丢掉而不是报错——一条脏证据不该让 `show` 挂掉。web 端同一份数据在任务 **Record** 页的「测试用例」区段里出缩略图（LUM-1011 起 Tests tab 并入 Record；旧的 `/tests` 链接自动落到这里）。

## `lumo task|milestone testcase download <parent>/TC<n> <dir>` — 用 API key 把证据存到本地（LUM-1185）

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

## `lumo task|milestone testcase run <parent>/TC<n>` — 记一次执行

| Flag                     | 说明                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--result <r>`           | **必填**。`pass` / `fail` / `blocked`                                                                                                                                                              |
| `--env <e>`              | **必填，没有默认值**。`local` / `preview` / `production`                                                                                                                                           |
| `--pr <number>`          | 这次跑的是哪个 PR 的改动。必须是本任务名下的 PR                                                                                                                                                    |
| `--commit <sha>`         | 这次跑的是哪个 commit。**`--env local` 之外必须显式给**，否则不记                                                                                                                                  |
| `--failed-step <n>`      | **1-based**，仅 FAIL 可用，与 `--failed-verify` 互斥                                                                                                                                               |
| `--failed-verify <n>`    | **1-based**，仅 FAIL 可用，与 `--failed-step` 互斥                                                                                                                                                 |
| `--cause <c>`            | **FAIL 必填、非 FAIL 禁带**。`defect` / `outdated` / `external` / `unknown`                                                                                                                        |
| `--unproven <n>`         | **1-based**，本次没能观察到的复验条目，可重复。见下方「可证明性上限」                                                                                                                              |
| `--note <text>`          | 这次执行的自由文本备注                                                                                                                                                                             |
| `--evidence <url>`       | 证据链接，可重复                                                                                                                                                                                   |
| `--evidence-file <path>` | 上传本地文件作证据，可重复。png/jpeg/webp/gif/txt/log/json，单个 ≤ 10 MB，最多 5 个                                                                                                                |
| `--step <spec>`          | **必填（LUM-1211）**：每一步都要报。`s<n>=pass\|fail\|skip:<原因>` / `v<n>=…`，范围 `s1-3=pass`，可带耗时 `@1.2s`。PASS 报全部步骤与复验；FAIL 报到断点为止。`--unproven <n>` 声明的复验条目算已报 |
| `--step-evidence <spec>` | 把证据挂到某一步下面，可重复。`s3=shot.png` 或 `v1=https://…`；文件与 `--evidence-file` 合计最多 5 个                                                                                              |
| `--actual <text>`        | 仅 FAIL：失败那一步**实际**看到了什么，网页上与用例的期望并排显示                                                                                                                                  |

```bash
lumo task testcase run LUM-42/TC3 --result fail --env local --pr 123 --failed-step 2 --cause defect --step s1=pass --step s2=fail --note "页脚只剩版权行" --evidence-file ./screenshot.png
```

### 逐步结果：这次跑到了哪一步（LUM-1011）

网页上每条 run 是一张逐步报告：每一步 ✓ / ✗ / 未到达，失败那步下面「期望 / 实际」并排，截图挂在它所属的那一步下。要让它画得出 ✓，**得逐步报**：

```bash
lumo task testcase run LUM-42/TC3 --result fail --env production --commit 0d46921 --cause defect --step s1-3=pass --step v1=fail@0.3s --step-evidence v1=./v1.png --actual "横幅显示「已作为店铺余额发放」"
lumo task testcase run LUM-42/TC3 --result pass --env local --step s1-2=pass --step s3=skip:"no real DB locally" --step v1=pass --evidence-file ./jest.json
```

- **每一步都必须上报，漏报整条 run 被拒绝**（服务端 400，错误里列出缺的 s<n>/v<n> 和可照抄的 --step 写法）。没检查的步骤用 `s3=skip:"原因"`，PASS 会被封顶为 UNPROVEN(skipped)。不要用 s1-N=pass 一把带过没真正检查过的步骤。
- `--step` 里的 fail 步就是失败定位：可以不再写 `--failed-step`；两个都写时必须指同一步，否则服务端 400。
- 至多一步 fail；失败点之后不能有 pass（断在第 4 步 = 后面没跑到）；BLOCKED 不带 `--step`（根本没跑起来）；PASS 不能带 fail 步。
- `--step-evidence` 只能挂到同时用 `--step` 报过的那一步上。
- 旧服务端会静默丢掉 `--step` / `--actual`（run 照记，只是没有逐步结果）。

### FAIL 的归因（LUM-808）

`--result fail` 必须说清是谁的锅。四个值，**举证责任刻意不对称**：

| `--cause`  | 含义                                                       | 额外要求                |
| ---------- | ---------------------------------------------------------- | ----------------------- |
| `defect`   | 被测实现的锅                                               | **≥1 条证据**，否则 400 |
| `outdated` | 用例过时（UI / 文案漂移），实现没问题                      | 无                      |
| `external` | 跑到一半被外部因素卡住（对比 `blocked`：那是根本没跑起来） | 无                      |
| `unknown`  | 没判断出来                                                 | 无                      |

`unknown` 是**合法答案，不是逃避**——逼出一个乱填的归因只会污染统计。只有
`defect` 背举证责任：说是实现的锅，就得先把证据落库，不能凭「我记得当时是这样」。

### 可证明性上限（LUM-808）

`--env` 记的是「在哪跑」，这一层记的是「这次能验什么 / 验不了什么」，然后**按边界
封顶结论**：自己声明验不了的事，不能报 PASS，最多报 `UNPROVEN`（没能确认）。

三条边界：

- **用例侧**：`testcase add/update --requires-env <local|preview|production>`。声明一次，
  之后在别处记的 PASS 一律封顶。**精确相等，没有 `production ⊇ preview ⊇ local` 的层级**
  ——一条测本地工具链的用例，在生产跑并不能证明它。`--requires-env none` 清除。
- **run 侧**：`--unproven <n>`（1-based，可重复）标出这次没能观察到的复验条目。
- **证据侧（LUM-819）**：一条**零证据**的 PASS 封顶为 `UNPROVEN(no-evidence)`——不看谁跑的，
  人跑了什么都没留照样证不了。读端推导，所以**历史上的零证据 PASS 也按同一口径显示**
  （用户裁定，不按时间切线）。
- **跳过侧（LUM-1211）**：run 的逐步结果里有任何 SKIP → PASS 封顶为 `UNPROVEN(skipped)`，回显点名
  被跳过的步骤（`s3` = 第 3 个操作步，`v1` = 第 1 条复验）及原因。
  优先级：环境 > 未观察 > 跳过 > 无证据。

封顶**只作用于 PASS**。FAIL / BLOCKED 原样保留——「证明了坏」不需要能力上限。
`UNPROVEN` 只由读端推导，**不落库**：`TestCaseRunResult` 仍然只有
`PASS` / `FAIL` / `BLOCKED`。

回显会把降级摆在脸上：

```bash
lumo task testcase run LUM-42/TC3 --result pass --env local --step s1-3=pass --step v1=pass
# Recorded LUM-42/TC3: PASS on LOCAL → UNPROVEN (this case only proves anything on PRODUCTION)
```

```bash
lumo task testcase run LUM-42/TC3 --result pass --env production --step s1-3=pass --step v1=pass --evidence-file ./jest.json
```

```bash
lumo task testcase run LUM-42/TC3 --result pass --env production --step s1-3=pass --step v1=pass
# Recorded LUM-42/TC3: PASS on PRODUCTION → UNPROVEN (no evidence attached — nobody else can re-read this PASS)
```

记完 run 时若一条证据都没有，CLI 还会打一行 `No evidence attached — …` 告诉你怎么附（`--result fail` 措辞更重）。零证据的 PASS 被封顶成 `UNPROVEN`，但仍然**不拦 DONE**——`task status` 的 advisory 行会写明 `(no evidence attached)`。

**没有抽查复核**：LUM-819 的抽查池（网页与 CLI 入口）已在 LUM-1231 删除。别人要看一条 PASS 站不站得住，读的就是任务里这条 run 的证据——所以跑的当下就附证据。

**commit 坐标只在 `--env local` 时自动探测**（`git rev-parse HEAD` + `git status --porcelain`）。不在 git 仓库里就留 null，不编造。

`--env preview` / `--env production` **不会**去读本地 git —— 本地检出跑的不是那些环境跑的东西。把操作者的 HEAD 记成「生产验过的 commit」是假话；更糟的是如果本地 HEAD 恰好等于 PR head，陈旧性会把它判成 `fresh`，等于伪造一条「生产已验证」。非 local 要记 commit，**必须显式** `--commit <sha>`：由人断言「线上跑的就是这个」，而不是让工具猜。

```bash
lumo task testcase run LUM-42/TC3 --result pass --env production --pr 123 --commit 80b62a3 --step s1-3=pass --step v1=pass
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

CLI 会在四个位置提醒记用例。两道门槛：**开工那处不看 PR，其余三处要求任务已有 linked PR 且零用例**。四处都是提示，**都不阻塞 DONE**。

| 位置                                  | 门槛              | 长相                                                                 |
| ------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| `session attach` / `task show --full` | 零用例（不看 PR） | `## Test cases` 小节                                                 |
| `Next:` 块                            | 有 PR + 零用例    | 一条 `lumo task testcase add …` 建议，排在最后                       |
| `lumo task status` 的 next actions    | 有 PR + 零用例    | `• [TEST CASE] … (advisory) — run:` + 下一行单独的命令               |
| `lumo task status` 的 next actions    | 用例有判决信号    | `• [TEST CASE] TC3 … — reported PASS, capped to UNPROVEN (advisory)` |

几条语义：

- **开工那处不卡 PR 是故意的**：开工时通常还没有 PR，卡了这条提醒就永远不出现。
- **`Next:` 块里的这条排在最末**，让位给越界等真拦交付的提示。`NEXT_STEPS_MAX=3` 的上限没变，被挤掉就不显示。
- **同一屏不重复**：`session attach` / `task show --full` 已经渲染了 `## Test cases` 小节，它们的 `Next:` 块就不再重复这条。
- **`task status` 的这条是 advisory**：`kind: 'TEST_CASE'`，没有 `blocking` 字段，DONE 闸门读都不读它。
- 任务一旦有任意一条用例（或已 DONE），四处全部静默。

## When to suggest

- 用户描述一条**可反复执行的手工验证剧本**（有前置条件、有编号步骤、有预期结果）→ `testcase add`。test case 是要跑很多次的。
- 用户说「我在本地跑过了」「我在生产上试了一下」→ `testcase run --env <...>` 把它留痕。这正是这个 feature 存在的理由：把「谁在哪跑过」从某个人的记忆里搬进记录。
- **记 run 的同时就把证据带上**（`--evidence-file <path>` / `--evidence <url>`）。跑之前先把命令输出 `tee` 成一个 `.log`，别等记完 run 再回头找——那时候终端已经滚掉了。`--result fail` 基本必须带（失败在哪一步、当时屏幕上是什么，光靠 `--note` 复述不回来）；`pass` 也尽量带，否则记录里只剩「PASS on LOCAL」这一句谁都复核不了的断言。CLI 在零证据时会打一行提醒（LUM-807 follow-up）。
- 用户问「这条用例上次跑是什么结果」「这个还验过吗」→ `testcase show`。
- PR 合并、部署完成之后 → 提醒补一次 `--env production` 的执行记录。本地绿和生产上真的验过是两回事。

## 语义坑（最容易搞错的十条）

1. **`--env` 必填无默认。** 整个 feature 的目的就是分清跑在哪；别去猜一个值填进去。
2. **`BLOCKED` = 用例根本没跑起来**（前置条件 / 环境不满足），因此**不能**带 `--failed-step`。跑到一半被外部因素卡住，记 `--result fail` + 定位 + `--note`。
3. **`--failed-step` / `--failed-verify` / `--step s<n>` 都是 1-based**，和终端里打印的编号对齐。
4. **`--env production` / `preview` 不自动探 commit**。本地检出 ≠ 线上跑的代码；要记就显式 `--commit`。
5. **`update` 的 `--step` 是整段替换**，不是追加。
6. **`rm` 是软删**，run 历史仍在；且走确认信封，agent 不得自补 `--confirm`。
7. **用例跑绿不代表任务可以 DONE。** DONE 是用户的裁定（`--status done` 的 exit-4 信封；仅当关联 PR 全部已合并且无阻挡项时一步执行，LUM-1106），闸门见 `lumo task status`（READY 时附 DONE 就绪段）。
8. **`--cause unknown` 是合法答案。** FAIL 必须归因，但「没判断出来」本身就是一种诚实的归因；不要为了填满字段瞎选一个 `defect`（它还会因缺证据被 400 挡回来）。
9. **`UNPROVEN` 不是 FAIL。** 它说的是「这次没能确认」，不是「测出问题了」。看到它别去修一个没坏的东西——去补上验得了的那次执行。
10. **一条没有证据的 run 只是个断言。** `PASS on LOCAL` 本身不可复核——它把「凭什么说它绿」留在了某个人的记忆里，正是这个 feature 要终结的东西。证据要在跑的当下留（`tee` 到 `.log` 再 `--evidence-file`），事后补不回来。零证据时 CLI 会提醒一行，但它只是提醒：**不阻塞、也不会替你留档**。

## 判决信号进 `task status`（LUM-808）

每条用例**最新一条** run 会产出至多一个判决信号，出现在 `lumo task status`
的 next actions 末尾(行尾括注闸门的处理:未裁定的 `PROVEN_DEFECT` 是
`(blocks DONE until the user rules on it)`,JSON 里 `blocking: true`;裁定后
`(ruled on — does not block DONE)`;其余 `(advisory)`。LUM-1186):

| 信号            | 触发                                 |
| --------------- | ------------------------------------ |
| `PROVEN_DEFECT` | 最新 run 是带证据的 `--cause defect` |
| `UNPROVEN_PASS` | 最新 run 报了 PASS，但被上述上限封顶 |
| `CASE_OUTDATED` | 最新 run 是 `--cause outdated`       |

LUM-812 起**只有 `PROVEN_DEFECT` 拦 DONE**，另外两个仍是纯 advisory。按 Autonoma
的口径：只有「证明了坏」才拦，「没测完」「自己挂了」都放行。

DONE 闸现在看三样东西——未处置的越界、拦截级安全发现、**未裁定的已证缺陷**
——判定仍收在 `lib/acceptance/done-verdict.ts` 一处。

LUM-801 原本立「用例从不拦 DONE」，理由是进闸会逆向激励「干脆不记 run」。那个担心
是真的，所以这一面**不是硬墙**：一次人类裁定就清（见下），代价从「必须先修好」降到
「得有人拍一次板」。

能拦闸的信号**只能来自 agent 自报的归因 + 证据**，永远不能来自 LLM 判定
（LUM-740：LLM_JUDGE 的发现不拦 DONE，API schema 拒绝 + reader 忽略）。

## `lumo task|milestone testcase disposition`（LUM-812）

对一条「证明了坏」的 run 落人类裁定，清掉它对 DONE 的拦截。

```bash
lumo task testcase disposition LUM-42/TC3 --known-defect --note "tracked in LUM-900"
```

| 裁定值           | 含义                         |
| ---------------- | ---------------------------- |
| `--known-defect` | 认这个缺陷，照发（发布决定） |
| `--not-a-defect` | 归因错了，不是实现的锅       |

**两个值都清闸**（同越界的 FALSE_POSITIVE / CONFIRMED）——闸门问的是「有没有人看过
一眼并拍板」，不是「缺陷修了没」。

### 三步握手，与 `crossing disposition` 同一套协议

1. **不带步骤 flag**：读那条 run、取 stage-1 回执、打 exit-4 信封。什么都不写。转述给
   用户，**等他说读过了**；信封的 `confirmCommand` 以 `--confirm-read` 结尾；
2. **`--confirm-read --receipt <r1>`**：换 stage-2 回执，打第二个信封（裁定本身）。仍然
   什么都不写。转述，**等他批准裁定**；
3. **`--confirm --receipt <r2>`**：落库。

**`--confirm-read` / `--confirm` 永远不要自己加**——每一个都代表用户对那一步的批准。
服务端无法核实聊天里的批准，所以裁定被记为 `channel: 'CLI'`（web 面板上点的记
`'WEB'`）。服务端**不按身份拒人**：LUM-750 的 agent 守卫已在 PR 1006 撤回。

### 几条语义

- **裁的永远是最新那条 run。** 闸门只看最新一条，对旧 run 下裁定清不掉任何东西 →
  409。
- **裁定绑在那条 run 上，不是绑在用例上。** 之后再记一条新的 defect run，闸门重新拦
  ——这是设计，不是 bug：新证据需要新的一次拍板。
- **读完信封到确认之间状态变了，回执就失效**（有人先在 web 裁了 / 冒出更新的 run），
  409 且什么都不写。重跑不带步骤 flag 拿新信封。
- **只有带证据的 `--cause defect` 能被裁定。** 其余结果从来就没拦过 DONE，没有可清的
  东西 → 409。

## 里程碑用例（milestone testcase）

Milestone test cases are cross-task, end-to-end cases and the milestone close contract (LUM-1135). Everything above applies; the differences are only about the parent:

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
