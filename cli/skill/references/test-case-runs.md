# Test case runs, verdicts & disposition

`testcase run` 记录一次执行；用例本身（add/list/show/update/delete/download）见 [test-cases.md](test-cases.md)。`task` 与 `milestone` 两套父对象命令一致。

## `lumo task|milestone testcase run <parent>/TC<n>` — 记一次执行

- `--result <r>` — **必填**。`pass` / `fail` / `blocked`
- `--env <e>` — **必填，没有默认值**。`local` / `preview` / `production`
- `--pr <number>` — 这次跑的是哪个 PR 的改动。必须是本任务名下的 PR
- `--commit <sha>` — 这次跑的是哪个 commit。**`--env local` 之外必须显式给**，否则不记
- `--failed-step <n>` — **1-based**，仅 FAIL 可用，与 `--failed-verify` 互斥
- `--failed-verify <n>` — **1-based**，仅 FAIL 可用，与 `--failed-step` 互斥
- `--cause <c>` — **FAIL 必填、非 FAIL 禁带**。`defect` / `outdated` / `external` / `unknown`
- `--unproven <n>` — **1-based**，本次没能观察到的复验条目，可重复。见下方「可证明性上限」
- `--note <text>` — 这次执行的自由文本备注
- `--evidence <url>` — 证据链接，可重复
- `--evidence-file <path>` — 上传本地文件作证据，可重复。png/jpeg/webp/gif/txt/log/json，单个 ≤ 10 MB，最多 5 个
- `--step <spec>` — **必填**：每一步都要报。`s<n>=pass|fail|skip:<原因>` / `v<n>=…`，范围 `s1-3=pass`，可带耗时 `@1.2s`。PASS 报全部步骤与复验；FAIL 报到断点为止。`--unproven <n>` 声明的复验条目算已报
- `--step-evidence <spec>` — 把证据挂到某一步下面，可重复。`s3=shot.png` 或 `v1=https://…`；文件与 `--evidence-file` 合计最多 5 个
- `--actual <text>` — 仅 FAIL：失败那一步**实际**看到了什么，网页上与用例的期望并排显示

```bash
lumo task testcase run LUM-42/TC3 --result fail --env local --pr 123 --failed-step 2 --cause defect --step s1=pass --step s2=fail --note "页脚只剩版权行" --evidence-file ./screenshot.png
```

### 逐步结果：这次跑到了哪一步

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

### FAIL 的归因

`--result fail` 必须说清是谁的锅。四个值，**举证责任刻意不对称**：

- `defect` — 含义: 被测实现的锅; 额外要求: **≥1 条证据**，否则 400
- `outdated` — 含义: 用例过时（UI / 文案漂移），实现没问题; 额外要求: 无
- `external` — 含义: 跑到一半被外部因素卡住（对比 `blocked`：那是根本没跑起来）; 额外要求: 无
- `unknown` — 含义: 没判断出来; 额外要求: 无

`unknown` 是**合法答案，不是逃避**——逼出一个乱填的归因只会污染统计。只有
`defect` 背举证责任：说是实现的锅，就得先把证据落库，不能凭「我记得当时是这样」。

### 可证明性上限

`--env` 记的是「在哪跑」，这一层记的是「这次能验什么 / 验不了什么」，然后**按边界
封顶结论**：自己声明验不了的事，不能报 PASS，最多报 `UNPROVEN`（没能确认）。

三条边界：

- **用例侧**：`testcase add/update --requires-env <local|preview|production>`。声明一次，
  之后在别处记的 PASS 一律封顶。**精确相等，没有 `production ⊇ preview ⊇ local` 的层级**
  ——一条测本地工具链的用例，在生产跑并不能证明它。`--requires-env none` 清除。
- **run 侧**：`--unproven <n>`（1-based，可重复）标出这次没能观察到的复验条目。
- **证据侧**：一条**零证据**的 PASS 封顶为 `UNPROVEN(no-evidence)`——不看谁跑的，
  人跑了什么都没留照样证不了。读端推导，所以**历史上的零证据 PASS 也按同一口径显示**
  （用户裁定，不按时间切线）。
- **跳过侧**：run 的逐步结果里有任何 SKIP → PASS 封顶为 `UNPROVEN(skipped)`，回显点名
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

**没有抽查复核**：别人要看一条 PASS 站不站得住，读的就是任务里这条 run 的证据——所以跑的当下就附证据。

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

## 判决信号进 `task status`

每条用例**最新一条** run 会产出至多一个判决信号，出现在 `lumo task status`
的 next actions 末尾(行尾括注闸门的处理:未裁定的 `PROVEN_DEFECT` 是
`(blocks DONE until the user rules on it)`,JSON 里 `blocking: true`;裁定后
`(ruled on — does not block DONE)`;其余 `(advisory)`):

| 信号            | 触发                                 |
| --------------- | ------------------------------------ |
| `PROVEN_DEFECT` | 最新 run 是带证据的 `--cause defect` |
| `UNPROVEN_PASS` | 最新 run 报了 PASS，但被上述上限封顶 |
| `CASE_OUTDATED` | 最新 run 是 `--cause outdated`       |

**只有 `PROVEN_DEFECT` 拦 DONE**，另外两个仍是纯 advisory。按 Autonoma
的口径：只有「证明了坏」才拦，「没测完」「自己挂了」都放行。

DONE 闸现在看三样东西——未处置的越界、拦截级安全发现、**未裁定的已证缺陷**
——判定仍收在 `lib/acceptance/done-verdict.ts` 一处。

进闸会逆向激励「干脆不记 run」，所以这一面**不是硬墙**：一次人类裁定就清（见下），代价从「必须先修好」降到
「得有人拍一次板」。

能拦闸的信号**只能来自 agent 自报的归因 + 证据**，永远不能来自 LLM 判定
（LLM_JUDGE 的发现不拦 DONE）。

## `lumo task|milestone testcase disposition`

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
`'WEB'`）。服务端**不按身份拒人**——保护靠的是用户对每一步的批准。

### 几条语义

- **裁的永远是最新那条 run。** 闸门只看最新一条，对旧 run 下裁定清不掉任何东西 →
  409。
- **裁定绑在那条 run 上，不是绑在用例上。** 之后再记一条新的 defect run，闸门重新拦
  ——这是设计，不是 bug：新证据需要新的一次拍板。
- **读完信封到确认之间状态变了，回执就失效**（有人先在 web 裁了 / 冒出更新的 run），
  409 且什么都不写。重跑不带步骤 flag 拿新信封。
- **只有带证据的 `--cause defect` 能被裁定。** 其余结果从来就没拦过 DONE，没有可清的
  东西 → 409。
