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
| `--criterion <sel>` | 这条用例覆盖哪条验收标准：id 或 ≥6 字符前缀      |

```bash
lumo task testcase add LUM-42 --title "Dashboard 页脚 FDIC 披露" --setup "The user is on the Dashboard." --step "scroll: to the bottom of the page" --step "assert: the footer shows the FDIC membership line" --verify "refresh: the page" --expected "The FDIC membership disclosure is visible at the bottom of the dashboard."
```

（`--step` / `--verify` 每出现一次就是一条，按出现顺序排。上面为了能被文档校验器逐条验证写成了单行；实际使用时用 shell 续行分成多行更好读。）

输出：`Created LUM-42/TC1 "…"  (3 steps, 2 verification)`

上限（超出即 400）：步骤 1–30 条、复验 0–30 条、每条 ≤ 500 字符、标题 ≤ 200、setup/expected ≤ 2000。

### `--criterion` — 声明它覆盖哪条验收标准（LUM-815）

选择器是 criterion 的 id 或 **≥6 字符的唯一前缀**（同 `milestone criteria verdict`），从 `lumo task criteria list <task>` 取。跨任务的 id 会被 422 拒掉。

```bash
lumo task testcase add LUM-42 --criterion cmud751s --title "…" --step "…" --expected "…"
```

**不填是合法常态**，不是偷懒：探索性用例、一条跨多条标准的用例，本来就没有单一归属。强制填只会逼出乱填的引用，而乱填的引用会让覆盖缺口算到错的标准头上。

连线带来两件事，都**只在读出面**：

- `lumo task status` 在每条标准下面多几行 `↳ case TC1 …`，显示挂着它的用例与各自最近一次执行（结果 / 环境 / commit）。
- 合同里**一条用例都没有**的标准，单独列成一段「Not yet covered by a test case」。

**红线：用例跑绿不会把它覆盖的标准判成通过。** 没有任何推导，`latestVerdict` 不变、unmet 计数不变、DONE 闸不读它。这几行只回答「验没验」，永远不回答「验得对不对」——用例是 agent 写的，跑也是 agent 跑的。

## `lumo task testcase list <task>` — 列表

每行：用例号 · 标题 · 步骤数 · **最近一次执行**（结果 + 环境 + 短 sha + 日期），从没跑过显示 `never run`。

```bash
lumo task testcase list LUM-42
```

```
TC1	Dashboard 页脚 FDIC 披露	3 steps / 2 verify	FAIL on LOCAL @a1b2c3d (2026-09-21)
```

## `lumo task testcase show <task/case>` — 详情 + 执行历史

四段分节打印（步骤带 **1-based** 编号），随后是 run 历史。声明了覆盖标准的用例在标题下多打一行 `covers criterion <id>`。FAIL 的行显示挂在第几步及**当时的原文快照**，并带上 PR / commit 与陈旧性提示。

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

`--criterion` 在这里是**三态**：省略 = 不碰现有连线；`--criterion <id/前缀>` = 改绑；`--criterion ""` = 解绑（用例本身原样留着，只是不再声明它覆盖谁）。

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
| `--cause <c>`            | **FAIL 必填、非 FAIL 禁带**。`defect` / `outdated` / `external` / `unknown`         |
| `--unproven <n>`         | **1-based**，本次没能观察到的复验条目，可重复。见下方「可证明性上限」               |
| `--note <text>`          | 这次执行的自由文本备注                                                              |
| `--evidence <url>`       | 证据链接，可重复                                                                    |
| `--evidence-file <path>` | 上传本地文件作证据，可重复。png/jpeg/webp/gif/txt/log/json，单个 ≤ 10 MB，最多 5 个 |

```bash
lumo task testcase run LUM-42/TC3 --result fail --env local --pr 123 --failed-step 2 --cause defect --note "页脚只剩版权行" --evidence-file ./screenshot.png
```

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

两条边界：

- **用例侧**：`testcase add/update --requires-env <local|preview|production>`。声明一次，
  之后在别处记的 PASS 一律封顶。**精确相等，没有 `production ⊇ preview ⊇ local` 的层级**
  ——一条测本地工具链的用例，在生产跑并不能证明它。`--requires-env none` 清除。
- **run 侧**：`--unproven <n>`（1-based，可重复）标出这次没能观察到的复验条目。

封顶**只作用于 PASS**。FAIL / BLOCKED 原样保留——「证明了坏」不需要能力上限。
`UNPROVEN` 只由读端推导，**不落库**：`TestCaseRunResult` 仍然只有
`PASS` / `FAIL` / `BLOCKED`。

回显会把降级摆在脸上：

```bash
lumo task testcase run LUM-42/TC3 --result pass --env local
# Recorded LUM-42/TC3: PASS on LOCAL → UNPROVEN (this case only proves anything on PRODUCTION)
```

```bash
lumo task testcase run LUM-42/TC3 --result pass --env production
```

记完 run 时若一条证据都没有，CLI 会打一行 `No evidence attached — …`（`--result fail` 措辞更重）。提醒而已：不拦、不改结果，带了任意一条证据就不再出现。

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

| 位置                                   | 门槛              | 长相                                                                 |
| -------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| `session attach` / `task context`      | 零用例（不看 PR） | `## Test cases` 小节，紧挨验收合同                                   |
| `Next:` 块                             | 有 PR + 零用例    | 一条 `lumo task testcase add …` 建议，排在最后                       |
| `lumo verify` 全绿转 IN_REVIEW         | 有 PR + 零用例    | `Tip:` 一行，提示把刚手验的剧本沉淀下来                              |
| `lumo task status` 的 next actions     | 有 PR + 零用例    | `• [TEST CASE] … (advisory)` + `run:` 命令行                         |
| `lumo task status` 的 next actions     | 用例有判决信号    | `• [TEST CASE] TC3 … — reported PASS, capped to UNPROVEN (advisory)` |
| `lumo task status` 合同之后（LUM-815） | 有标准零用例覆盖  | `Not yet covered by a test case (…)` 自成一段，不进未满足清单        |

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
- **记 run 的同时就把证据带上**（`--evidence-file <path>` / `--evidence <url>`）。跑之前先把命令输出 `tee` 成一个 `.log`，别等记完 run 再回头找——那时候终端已经滚掉了。`--result fail` 基本必须带（失败在哪一步、当时屏幕上是什么，光靠 `--note` 复述不回来）；`pass` 也尽量带，否则记录里只剩「PASS on LOCAL」这一句谁都复核不了的断言。CLI 在零证据时会打一行提醒（LUM-807 follow-up）。
- 用户问「这条用例上次跑是什么结果」「这个还验过吗」→ `testcase show`。
- PR 合并、部署完成之后 → 提醒补一次 `--env production` 的执行记录。本地绿和生产上真的验过是两回事。
- `task status` 打出「Not yet covered by a test case」→ 那几条标准至今只有话、没有可复跑的证据。**它不拦 DONE，也不是待办**；值不值得补由人判断（有些标准天生就该由人读一眼，不该有剧本）。要补就带上 `--criterion`，否则补了也算不进覆盖。

## 语义坑（最容易搞错的十一条）

1. **`--env` 必填无默认。** 整个 feature 的目的就是分清跑在哪；别去猜一个值填进去。
2. **`BLOCKED` = 用例根本没跑起来**（前置条件 / 环境不满足），因此**不能**带 `--failed-step`。跑到一半被外部因素卡住，记 `--result fail` + 定位 + `--note`。
3. **`--failed-step` / `--failed-verify` 是 1-based**，和终端里打印的编号对齐。
4. **`--env production` / `preview` 不自动探 commit**。本地检出 ≠ 线上跑的代码；要记就显式 `--commit`。
5. **`update` 的 `--step` 是整段替换**，不是追加。
6. **`rm` 是软删**，run 历史仍在；且走确认信封，agent 不得自补 `--confirm`。
7. **test case 不是验收合同。** 用例跑绿不代表任务可以 DONE；DONE 看的是 `lumo verify` 与 `lumo task status`。
8. **`--cause unknown` 是合法答案。** FAIL 必须归因，但「没判断出来」本身就是一种诚实的归因；不要为了填满字段瞎选一个 `defect`（它还会因缺证据被 400 挡回来）。
9. **`UNPROVEN` 不是 FAIL。** 它说的是「这次没能确认」，不是「测出问题了」。看到它别去修一个没坏的东西——去补上验得了的那次执行。
10. **覆盖缺口不是失败。** 「没有用例覆盖」说的是这条标准还没人验过，不是它挂了。它自成一段渲染、不进未满足清单、不进 DONE 闸——别看见就去补一条敷衍的用例，那只是把缺口换成了假绿。
11. **一条没有证据的 run 只是个断言。** `PASS on LOCAL` 本身不可复核——它把「凭什么说它绿」留在了某个人的记忆里，正是这个 feature 要终结的东西。证据要在跑的当下留（`tee` 到 `.log` 再 `--evidence-file`），事后补不回来。零证据时 CLI 会提醒一行，但它只是提醒：**不阻塞、也不会替你留档**。

## 判决信号进 `task status`（LUM-808）

每条用例**最新一条** run 会产出至多一个 advisory 信号，出现在 `lumo task status`
的 next actions 末尾：

| 信号            | 触发                                 |
| --------------- | ------------------------------------ |
| `PROVEN_DEFECT` | 最新 run 是带证据的 `--cause defect` |
| `UNPROVEN_PASS` | 最新 run 报了 PASS，但被上述上限封顶 |
| `CASE_OUTDATED` | 最新 run 是 `--cause outdated`       |

LUM-812 起**只有 `PROVEN_DEFECT` 拦 DONE**，另外两个仍是纯 advisory。按 Autonoma
的口径：只有「证明了坏」才拦，「没测完」「自己挂了」都放行。

DONE 闸现在看四样东西——未解决的送回、未处置的越界、拦截级安全发现、**未裁定的
已证缺陷**——判定仍收在 `lib/acceptance/done-verdict.ts` 一处。

LUM-801 原本立「用例从不拦 DONE」，理由是进闸会逆向激励「干脆不记 run」。那个担心
是真的，所以这一面**不是硬墙**：一次人类裁定就清（见下），代价从「必须先修好」降到
「得有人拍一次板」。

能拦闸的信号**只能来自 agent 自报的归因 + 证据**，永远不能来自 LLM 判定
（LUM-740：LLM_JUDGE 的发现不拦 DONE，API schema 拒绝 + reader 忽略）。

## `lumo task testcase disposition`（LUM-812）

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
