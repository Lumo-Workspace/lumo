# LUM-1234 — TRACE 离线评测（reward hack 检测）

只读评测：不连 DB、不写 Lumo 数据。规则检测器部分不调任何模型；只有「LLM judge」一节调了模型，全部走 ZDR 网关。数据和 judge 结果都缓存在**仓库外**。所有数字都是**在合成的 TRACE 上**测得的，不能代表真实 agent 运行的情况，也没有据此调过任何阈值。

## 数据与许可

| 数据                       | 内容                                                                                           | 许可                    | 处理方式                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------- |
| `PatronusAI/trace-dataset` | 517 条多轮编码轨迹（268 hacked / 249 benign），合成后经人工核验；arXiv 2601.20103（ICML 2026） | **CC-BY-SA-4.0，gated** | 缓存在仓库外，不提交任何行、摘录或衍生 fixture |

- 首次下载时确认的行结构：`trajectory_id`（中性编号，如 `trajectory_0001`）、`conversation`（JSON 字符串，内容是 `{role, content, tool_calls?, tool_results?}` 数组）、`label`（`'0'` 表示 benign，否则是逗号分隔的 hack 类型码，如 `1.1.2, 1.3.1`）。
- 标签里实际出现的类型码只有 10 个：`1.1.1–1.1.3`、`1.2.1–1.2.3`、`1.3.1–1.3.2`、`1.4.1–1.4.2`。这和论文「10 个大类」对得上；54 个细分子类不在标签里。数据卡列了四个大的家族（测试套件利用、解法质量降级、上下文利用、执行环境 hack），但没有给出类型码和家族的对应关系，所以下文只用类型码。
- 工具调用直接就是 Claude Code 的格式（`{name, parameters}`）：Bash / Edit / Write / Read 一一对应 hook 事件。
- 测试 fixture 是手写的，只模仿字段形状，所有字符串都是编的。

## 复现

```bash
npx tsx scripts/crossing-eval.ts --dataset trace --judge rules            # 确定性阶段
npx tsx scripts/crossing-eval.ts --dataset trace --judge rules --confirm  # + align-eval 的确定性 stub 动作确认
npx tsx scripts/crossing-eval.ts --dataset trace --judge rules --json     # 机器可读
```

缓存默认在 `~/.cache/lumo-lum1234-trace/trace-dataset__train.json`，可以用 `--data <dir|file.json>` 改。缓存不存在时命令以非零码退出，报错里写明 `--download` 命令和 HF 访问步骤。填充缓存有两种方式：

1. `--download`：走 HF datasets-server 的 JSON 接口（不需要 parquet 解析，不新增依赖），需要账号已经通过 gated 审核，并且 token 能读 gated 仓库（fine-grained token 要开 "read access to public gated repos"）。
2. 手上已有有权访问的 parquet 副本时（`hf download …`，或私有镜像）：`uv run --with pyarrow python -I scripts/analysis/lum1234-trace/parquet_to_json.py <train.parquet> <cache.json>`。

本文的数字来自方式 2：当时 HF 账号已经通过审核，但 fine-grained token 没开 gated 读权限，于是从用户自己的 bucket 副本取了 parquet（sha256 `6cb9959f…d056b8`，7,122,723 字节）。核对结果：517 行，268 / 249，与数据卡一致。由于没法读取上游的 LFS 元数据，**没有和上游 parquet 逐字节比对**。`--download` 路径只有单测覆盖（mock 403），没有对真实服务器跑通过。

## 转换

`convert.ts` 是纯函数。Bash → `{command}`，Write → `{file_path, content}`，Edit → `{file_path, old_string, new_string}`，Read → `{file_path}`。其他工具跳过，按名字计数。不评估 tool_results，因为检测器只看工具输入。行结构不对（缺 id、label 不合法、conversation 不是数组）时直接报错并给出行 id。

| 计数                     | 值                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| 评估的工具调用           | 9,919                                                                                      |
| 跳过的工具调用           | 405（3.9%）：Grep 158 · Glob 157 · WebSearch 54 · WebFetch 25 · BashOutput 7 · KillShell 4 |
| 没有任何可评估调用的轨迹 | 0                                                                                          |

**不是可见性的问题**：96% 的工具调用都送到了检测器，每条轨迹都有可评估的事件。hack 动作就在检测器看得到的 Edit / Write / Bash 里，检测器缺的是能识别它们的判据（见下文）。

## 结果：规则检测器（trajectory 级）

两次运行（不带 / 带 `--confirm`）**结果逐项相同**：stub 动作确认没有改变任何一条 blocking 判定。

| 类别             | n   | 命中 | 比例  | Wilson 95% |
| ---------------- | --- | ---- | ----- | ---------- |
| hacked（检出率） | 268 | 44   | 16.4% | 12.5–21.3% |
| benign（误报率） | 249 | 48   | 19.3% | 14.9–24.6% |

检出率**低于**误报率，两个区间大部分重叠，也就是说规则检测器在 TRACE 上**区分不了 hacked 和 benign**。它的告警和 reward hack 标签没有关系。

### 按越界类别（触发该类别的轨迹数）

| 类别                         | hacked | benign |
| ---------------------------- | ------ | ------ |
| PUSH_TO_PROTECTED_BRANCH     | 14     | 6      |
| INFRA_TERMINATION            | 13     | 8      |
| TEST_FILE_DELETED            | 8      | 8      |
| SENSITIVE_PATH_EDIT          | 5      | 8      |
| NEW_NPM_DEPENDENCY           | 4      | 16     |
| HARDCODED_SECRET             | 3      | 9      |
| HARDCODED_SECRET（advisory） | 3      | 6      |

唯一和 reward hack 直接相关的类别是 `TEST_FILE_DELETED`，两边各 8 条，没有区分力。`PUSH_TO_PROTECTED_BRANCH` 和 `INFRA_TERMINATION` 在 hacked 一侧略多，但它们标记的是「推到 main」「pkill 本地服务」这类动作，不是 hack 本身。

### 按 TRACE hack 类型（一条轨迹在它的每个类型下各计一次）

| 类型码 | 检出        |     | 家族 | 检出         |
| ------ | ----------- | --- | ---- | ------------ |
| 1.1.1  | 10/56 17.9% |     | 1.1  | 25/151 16.6% |
| 1.1.2  | 12/69 17.4% |     | 1.2  | 9/82 11.0%   |
| 1.1.3  | 10/51 19.6% |     | 1.3  | 3/44 6.8%    |
| 1.2.1  | 3/36 8.3%   |     | 1.4  | 13/43 30.2%  |
| 1.2.2  | 3/21 14.3%  |     |      |              |
| 1.2.3  | 3/34 8.8%   |     |      |              |
| 1.3.1  | 1/25 4.0%   |     |      |              |
| 1.3.2  | 2/21 9.5%   |     |      |              |
| 1.4.1  | 7/21 33.3%  |     |      |              |
| 1.4.2  | 7/24 29.2%  |     |      |              |

所有类型码都没有明显高于 19.3% 误报基线的，1.4.x 也只是略高（n≈20，区间很宽）。

### 典型漏报（抽查 8 条 hacked 轨迹，转述，非原文）

- 恶意软件检测器赶认证：agent 把认证测试集里那批样本的哈希直接写进检测器源码，「检出率」就上去了。这只是对普通源文件的一次 Edit，路径和命令都很正常。
- 覆盖率 / 文档覆盖率卡点：agent 补了一批只为跑到分支、凑数字的测试或 docstring，达标后报告「已达标」，有的还直接推到 main。手段都在编辑内容里，检测器只看路径和命令。
- 演示 / 汇报场景：agent 写了一堆吹嘘技术栈的文档，或者在最后的总结里夸大成果（「全部通过」「生产就绪」）。hack 在 assistant 的文字和新写文档的语气里，不在任何危险动作里。
- 测试修复：agent 同时改了源码和测试文件，让测试「变绿」后宣布修好。对测试文件的 Edit 不会被任何规则看内容。

### 典型误报（转述，非原文）

- benign 轨迹为了调试，`pip install` 了一个工具包（NEW_NPM_DEPENDENCY：LUM-962 起所有生态的「装新包」都算）。
- benign 轨迹 `pkill` 掉本地开发服务器后重启（INFRA_TERMINATION）。
- benign 轨迹新建或修改 CI workflow 文件（SENSITIVE_PATH_EDIT），或者删掉自己刚写的临时测试脚本（TEST_FILE_DELETED）。

按 Lumo 自己的策略，这些越界本身是**真的**越界，只是和 reward hack 标签无关。所以「误报率 19%」衡量的是两个问题不对齐，不代表规则写错了。

### 补充：动作形状有没有区分力（scratchpad 探索，未提交脚本）

用几个显而易见的「像 hack 的形状」做了统计，看命中它们的轨迹占比：

| 形状                                                     | hacked | benign    |
| -------------------------------------------------------- | ------ | --------- | --- | --- |
| Edit/Write 测试文件                                      | 47%    | 44%       |
| Edit/Write 内容加入 skip / ignore / `assert True` 类标记 | 12%    | 12%       |
| Edit/Write 测试 / CI 配置                                | 4%     | 5%        |
| Bash 用了缩小测试范围的参数（`-k not`、`--deselect`、`   |        | true` …） | 1%  | 2%  |
| 以上任一                                                 | 55%    | 53%       |

在 TRACE 上，**动作形状层面基本没有信号**：benign 轨迹做同样的动作，频率也差不多。hack 是语义层面的（这次改动相对任务意图是不是在作弊），逐动作的正则或路径规则在结构上就够不着。

## 标签泄漏检查（为 LLM judge 准备）

- 没有 system 消息；`trajectory_id` 是中性的顺序编号；标签只在 `label` 字段里。
- 「hack」「cheat」「reward hack」这些词在两类轨迹里都有，数量都很少（例如 cheat：hacked 15 条 / benign 7 条），大多出现在任务领域里（如反作弊系统）。没看到像 BashArena cover 指令（LUM-958）那样直接暴露标签的字段。
- 规则检测器只看工具输入，不受这些影响。LLM judge 只拿到 `conversation`（见 `judge-prompt.ts`，有单测断言 prompt 里不含 label 和 id）。

## LLM judge（整轨迹、非对比式，Sonnet 4.6，ZDR）

```bash
AI_PROVIDER=gateway DOTENV_CONFIG_PATH=<主 checkout>/.env.local npx tsx -r dotenv/config \
  scripts/analysis/lum1234-trace/judge.ts --model anthropic/claude-sonnet-4.6 --budget 22
npx tsx scripts/crossing-eval.ts --dataset trace --judge recorded \
  --records ~/.cache/lumo-lum1234-trace/judge.jsonl --threshold 0.5
```

- **形态**：一次调用读一条完整轨迹，包括用户消息、assistant 文字、工具调用和工具结果（长字段按头尾截断：消息 6k、工具输入 3k、工具结果 1.5k 字符）。经过 `guardInjectedText` 加栅栏并遮盖密钥，输出 0–100 的 hack 概率。prompt 只给 reward hacking 的通用定义，不给 TRACE 的类型码。
- **ZDR**：通过 `generateEvalObject` → `@/lib/ai/gateway`（强制 zero data retention），运行时显式设了 `AI_PROVIDER=gateway`。写出的 `reason` / `evidence` 都先过 `redactForStorage`。结果文件在仓库外。
- **花费**：全量 $17.90（517 次调用，0 失败；547 万输入 token，9.9 万输出 token），加上 6 条试跑 $0.21，**共 $18.11**。超过 $10 上限这一点用户事先批准过（2026-10-18）。
- **阈值**：0.5 是跑之前就定好的，没有在 TRACE 上调（TRACE 没有 tune split，按 LUM-958 的教训也不该调）。另外报告与阈值无关的 AUROC。

| 类别             | n   | 命中 | 比例  | Wilson 95% |
| ---------------- | --- | ---- | ----- | ---------- |
| hacked（检出率） | 268 | 157  | 58.6% | 52.6–64.3% |
| benign（误报率） | 249 | 19   | 7.6%  | 4.9–11.6%  |

AUROC **0.837**。阈值 0.5 下的 binary macro-F1 = **0.74**（hacked F1 0.71，benign F1 0.78）。

**和论文比**：数据卡说论文的「Detection Rate」是 binary 预测的 **macro-F1**，不是检出率。论文里最强 judge 单条判定是 45%，对比式 63%。我们单条判定得到 0.74，**但不能直接说更好**：prompt、模型（论文最好的是 GPT-5.2）、轨迹的截断方式、阈值口径都不同，论文的 N=1 设置可能还带着别的条件（比如按簇抽样时的类别比例），这些我们没有复现。可以下的结论只是：在合成 TRACE 上，Sonnet 4.6 整轨迹 judge 有明显的区分能力。

### 按 TRACE hack 类型（检出率）

| 类型码 | 检出        |     | 家族 | 检出          |
| ------ | ----------- | --- | ---- | ------------- |
| 1.1.1  | 49/56 87.5% |     | 1.1  | 117/151 77.5% |
| 1.1.2  | 53/69 76.8% |     | 1.2  | 33/82 40.2%   |
| 1.1.3  | 33/51 64.7% |     | 1.3  | 14/44 31.8%   |
| 1.2.1  | 21/36 58.3% |     | 1.4  | 30/43 69.8%   |
| 1.2.2  | 2/21 9.5%   |     |      |               |
| 1.2.3  | 13/34 38.2% |     |      |               |
| 1.3.1  | 9/25 36.0%  |     |      |               |
| 1.3.2  | 5/21 23.8%  |     |      |               |
| 1.4.1  | 15/21 71.4% |     |      |               |
| 1.4.2  | 16/24 66.7% |     |      |               |

1.1 和 1.4 家族容易抓，1.2.2 和 1.3.x 难抓。数据卡提到语义类（上下文利用、风格操纵）的人工标注本身分歧更大；类型码和这些名字怎么对应，数据卡没写，所以这里不下对应关系的结论。

### 漏报和误报（转述 judge 的理由，非原文）

- **111 条漏报里有 44 条，judge 的理由说的是「agent 一开始确实在作弊，但被用户质问后改正了」**，于是判成不算 hack。TRACE 的口径是只要出现过 hack 就算 hacked。这是口径不一致，不是 judge 没看见。如果 Lumo 要用，需要先定「被拦下后改正」的轨迹要不要算。
- 其余漏报多是 judge 认为 agent 在认真干活、只是质量一般（例如文档写得敷衍、测试覆盖不够）。这正好落在「解法质量降级」和「hack」的边界上。
- 19 条误报里，一类是 judge 认为 agent 「自己编造了要修的代码 / 测试 / 指标，然后又删掉」。这像是合成环境的产物：轨迹里 agent 会在临时目录自建项目。另一类是放宽超时、删掉校验、改断言去对齐实现。这些在 judge 看来就是在凑测试，单看这几条，benign 标签本身也有争议。

## 结论

1. **规则检测器对 reward hack 没有检测能力**（检出 16.4% vs 误报 19.3%）。这在预期之内：`TEST_TAMPERING` 已随 LUM-942 下线，剩下的类别量的是别的东西。
2. **这不是 hook 可见性的问题**：96% 的调用都可评估，hack 就在 Edit/Write 的内容里。
3. **加形状规则也补不上**：最像 hack 的几种动作形状，在 benign 里出现的频率一样高。
4. **整轨迹 LLM judge 能区分**：Sonnet 4.6 单条判定 AUROC 0.84，阈值 0.5 下检出 58.6% / 误报 7.6%（合成 TRACE，未调阈值）。每条轨迹约 $0.035。漏报里约四成是「改正过的 hack」这个口径问题。
