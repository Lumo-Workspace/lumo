# lumo CLI agent 摩擦点实测报告(LUM-392)

> **缘起**:吸收 Anthropic [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) 的核心方法论——"用真实任务的 transcript 找工具摩擦点,评估驱动工具迭代"。Lumo 手里有别家没有的数据:每个 agent session 的全量 HookEvent。本报告把它变成 lumo CLI(作为 agent 工具面)的第一轮实测评估。
>
> **复跑**:`npx tsx scripts/analysis/lum392-cli-friction/extract.ts`(只读 prod,默认加载 `.env.production`;`--check` 模式做数据集自检)。解析逻辑在同目录 `parse.ts`,有单测。

## 0. 方法与覆盖

从 prod `hook_events` 抽取全部 Bash 工具调用中真实执行的 `lumo …` 调用(剔除 heredoc/sed/反引号里引用命令文本的文档噪音),按 CLI 命令树做最长前缀解析,错误判定靠输出特征(`Error:` 行 / commander usage 错误 / interrupted)。

| 指标                                      | 值                               |
| ----------------------------------------- | -------------------------------- |
| 时间范围                                  | 2026-05-16 → 2026-06-10          |
| 覆盖 session                              | 325 / 648(其余 session 未用 CLI) |
| 真实调用数                                | 3332                             |
| 用过的命令                                | 65 / 86                          |
| 错误调用                                  | 99(CLI 错误 75 + 用法错误 24)    |
| 归因干净的错误率                          | 2.3%(单调用事件 42/1800)         |
| 出错 session 数                           | 31 / 325                         |
| 重试链(同 session 同命令同目标 10 分钟内) | 146 条,其中 15 条含错误          |

**总体判断:CLI 工具面是健康的**——错误率 2.3%,错误集中在 31 个 session。摩擦点不在"坏",而在"浪费调用、靠猜、错了不指路"这三类,正对应文章的三条原则(整合工作流 / 描述显性化 / 错误可操作)。

**归因注意**:本 workspace 同时在开发 CLI 自身,部分错误是刻意的冒烟测试(典型特征:一个 Bash 调用串 5 条命令试错)。"归因干净的错误率"已排除这类多调用事件。

## 1. 摩擦点发现

### F1 · 仪式性状态走步:70 条链、145 次调用,本可 70 次(最大浪费源)

状态机其实允许直达(`TODO/IN_PROGRESS → DONE` 都合法,见 `lib/task/state-machine.ts` 的 TRANSITIONS),但 agent 普遍在几秒内连打 `--status in_progress → in_review → done` 三连。实测 70 条状态走步链共 145 次调用——每条链只需 1 次。没有任何文档告诉 agent 可以直达;它们靠对"状态机"的常识想象在走仪式。

```
lumo task update LUM-248 --status in_progress   # 07:23:20
lumo task update LUM-248 --status in_review     #   +几秒
lumo task update LUM-248 --status done          #   +几秒
```

另有 4 次 `Invalid status transition: DONE → IN_REVIEW` 错误——错误信息没有列出当前状态允许去哪,agent 只能再猜。注:verify 循环(LUM-343/344)上线后 agent 不应再自设 done,新流程下此摩擦会自然萎缩,但错误信息该补的还是要补。

### F2 · 靠猜的命令和 flag:幻觉率不高但模式清晰

agent 发明过的命令:`session start`、`task delete`、`auth status`、`task artifact edit`(应为 update)、`task comment-thread list`(应为 comments list)、裸 `help`。发明过的 flag(unknown option 错误共 13 次):

| 猜的 flag   | 命令                                  | 次数 | agent 其实想要                     |
| ----------- | ------------------------------------- | ---- | ---------------------------------- |
| `--project` | task/project memory list, sprint list | 5    | memory list 的位置参数 project-ref |
| `--content` | project memory add                    | 2    | 位置参数正文                       |
| `--body`    | task comment, session attach          | 2    | 位置参数正文                       |
| `--agent`   | task artifact add                     | 2    | `--source` 枚举                    |
| `--verbose` | session attach                        | 2    | 不存在                             |

模式:**位置参数被猜成具名 flag**(`--content`/`--body`),以及**跨命令迁移惯性**(task list 有 `--project`,就猜 memory list 也有)。另有 26 次裸 `lumo --help`/`--version`——agent 在 SKILL.md 答不上时回退到 help 自救,说明 commander 的 help 文案实际上是第二份工具描述,但现状很薄。

### F3 · 错误信息不指路(文章原则:错误响应要给下一步)

| 错误                                            | 次数 | 缺什么                                                        |
| ----------------------------------------------- | ---- | ------------------------------------------------------------- |
| `Invalid status transition: DONE → IN_REVIEW`   | 4    | 不列允许的目标状态,也不说"DONE 任务追加内容用 task comment"   |
| `memory <cuid前缀> not found`                   | 4    | agent 传了截断 cuid,错误不说"需要完整 cuid,从 memory list 拿" |
| `task artifact add: could not read file <path>` | 5    | 不提示用项目内相对路径再试或先 ls 确认                        |
| `error: unknown option '--xxx'`                 | 13   | commander 默认文案,不列该命令的有效 flag                      |
| `doc move: specify --parent <doc> or --root`    | 3    | **正面例子**——指明两条出路,agent 一次改对                     |

`doc move` 的错误文案是现成的内部最佳实践:同样是用法错,它指路,unknown option 不指路。

### F4 · `doc list --task` 真崩溃(bug)

2 次 `Cannot read properties of undefined (reading 'padEnd')`:`cli/src/commands/doc-list.ts` 的 `visibilityLabel()` 对运行时缺失/未知的 `visibility` 原样返回,undefined 直接 `.padEnd()` 炸裸 TypeError 给 agent——既是 bug,也是最差形态的错误输出。

### F5 · 上下文成本大头在注入型命令(符合设计,先量化备查)

| 命令           | 调用数 | stdout p50 | p90  | 累计       |
| -------------- | ------ | ---------- | ---- | ---------- |
| session attach | 334    | 3.8k 字符  | 8.3k | 1.40M 字符 |
| task context   | 257    | 4.5k 字符  | 8.5k | 1.29M 字符 |
| task show      | 98     | 0.66k 字符 | 1.9k | 96k 字符   |

attach+context 三周半合计 2.66M 字符(约 70 万 token 量级)。这是产品核心价值所在,且预算机制(LUM-279)已在管;值得注意的是 **show/context 的分层已经被 agent 用对了**——轻量确认场景选 show(p50 0.66k),要完整背景才用 context。暂无证据支持加 `--concise` 档。

### F6 · 21/86 命令零 agent 使用

零使用清单:figma 全家(add/context/list/refresh/rm)、sprint 生命周期(start/close/remove/summary/update)、milestone 维护(archive/unarchive/move/reorder)、doc import-gdoc/sync、task pr show、task slack show、task artifact show、task deps confirm/dismiss(刚上线 1 天,不算数)。

判读:多数是**人类发起场景**的命令(figma/gdoc 依赖人给链接,sprint/milestone 维护是 PM 动作),不是死代码;但它们在 SKILL.md 的触发词覆盖值得复查——如果希望 agent 在对应场景主动想起它们,触发词是唯一入口。

### F7 · 服务端可靠性噪音(非 CLI 问题,单列)

22 次 401/500(`project list failed (HTTP 500)` ×6、`task update Internal Server Error` ×5、401 ×8 等)。agent 对此类错误无法自救,只能重试。属于服务端可靠性范畴,不进 CLI 改进清单,但值得在服务端错误日志里对账。

## 2. 候选改进裁决表

按文章五原则逐项裁决(评估依据 = 上面的实测数字):

| 候选改进                                                                                                                                                                       | 裁决           | 依据                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| 错误信息 actionable 化:transition 错误列允许目标、unknown option 列有效 flag、not-found 指向对应 list 命令、memory rm 说明要完整 cuid                                          | **做**         | F1/F2/F3 合计 ~25 次"错了只能猜"的死胡同;doc move 文案证明改法有效;改动便宜、纯 CLI/服务端文案层                   |
| 修 `doc list --task` padEnd 崩溃(visibilityLabel 兜底)                                                                                                                         | **做**         | F4,真 bug,2 次实锤                                                                                                 |
| SKILL.md 显性化补强:状态可直达 done(及 verify 流程下不要自设)、负面清单(无 session start/task delete/--body/--verbose,artifact 是 update 不是 edit)、memory add 正文是位置参数 | **做**         | F1 的 145 次浪费调用 + F2 的 13 次 flag 幻觉全部指向隐性知识未显性化;文章原则 5 的直接应用                         |
| commander help 文案充实(每命令一行示例)                                                                                                                                        | **做(随手)**   | F2 的 26 次裸 --help 说明 help 是事实上的第二工具描述                                                              |
| `--concise` 响应分级(task context / session attach)                                                                                                                            | **缓**         | F5:agent 已自发用 show/context 分层,p90 8.5k 字符可接受;触发器 = 注入预算告警变多或 context 重复拉取率上升         |
| 分页/截断 audit(task list 等)                                                                                                                                                  | **缓**         | 除注入命令外 stdout p90 普遍 <2k 字符;tasks.md 已注记 client-side 过滤在当前规模成立;触发器 = workspace 任务数上百 |
| 命令合并/删除(零使用命令清理)                                                                                                                                                  | **不做**       | F6 判读为人类发起场景命令而非冗余;show vs context 的分层数据证明现有粒度是对的;复查 SKILL.md 触发词即可            |
| 周期性复跑本 harness                                                                                                                                                           | **做(零成本)** | 脚本已沉淀在 `scripts/analysis/lum392-cli-friction/`,发版后复跑出 diff 即是文章说的评估闭环                        |

## 3. 与文章原则的对照结论

- **原则 1(选对工具/整合)**:`task context`/`session wrap`/`next` 已是整合形态,实测 agent 用得对;不需要新整合命令。
- **原则 2(命名空间)**:前缀命名空间无混淆证据(没有跨域猜命令的错误)。
- **原则 3(有意义上下文)**:LUM-N 语义化标识工作良好;反例是 memory 的裸 cuid(F3 截断 cuid 错误),memory list 输出如带短前缀引用约定可消掉这类错。
- **原则 4(token 效率)**:整体健康(F5),错误信息是最大短板(F3)。
- **原则 5(描述即 prompt)**:F1/F2 全部是隐性知识未显性化的代价,SKILL.md 补强是本轮最高杠杆改动。

落地建议开一个 follow-up 任务承接三个"做"(错误文案 + padEnd bug + SKILL.md 补强),改动全在 CLI/文案层,无 schema。
