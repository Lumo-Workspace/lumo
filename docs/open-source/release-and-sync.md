# 公开仓库发布与同步流程(LUM-1035)

> **私有文档**:本文件不进开源快照(`oss/manifest.json` 里有 exclude 规则),因为它描述私有仓的目录结构、`ee/` 插件和 overlay 机制。

公开仓库:**`Lumo-Workspace/lumo-oss`**(LUM-1035 裁定 2026-10-11 ①)。同步模式(同日裁定 ②):

- **私有仓 → 公开仓**:每次发布,从私有仓导出一个快照(`oss:export` + `verify-snapshot` + gitleaks),作为**一个 commit** 推到公开仓,并打 tag。
- **公开仓 → 私有仓**:外部 PR 在公开仓审阅、合并,然后由维护者以 patch 回流到私有仓。外部贡献用 **DCO**(③),不用 CLA。

标记说明:**【用户】** = 需要 GitHub 组织/仓库管理员权限或个人凭据的步骤,只能由用户(或用户明确授权的人)执行;agent 不建库、不推送、不改仓库设置、不下载 gitleaks。没有标记的步骤可以在私有仓的 worktree 里做。

公开仓里由私有仓 overlay 提供、私有仓根目录**没有**的文件:`oss/overlay/` 下的 `CONTRIBUTING.md`、`SECURITY.md`、`CLAUDE.md`(对外版)、`LICENSE`(纯 MIT)、`.github/workflows/dco.yml`、`.github/workflows/images.yml`(LUM-1325:打 tag 时构建并推送自托管镜像到 GHCR)、`.github/scripts/check-dco.mjs`、`lib/plugins/installed*.ts`(空插件列表)。私有仓不跑 GitHub Actions,`.github/` 只在快照里存在。

---

## 1. 前置条件(首发前全部满足)

对照 [pre-release-checklist.md](pre-release-checklist.md) 的「首次公开发布前置」一节。要点:

1. 插件边界拆分已完成(MIT open-core 裁定 2026-10-10:安全模块不能随 MIT 发出去)——`verify-snapshot.sh` 全绿即证明快照不含 `ee/` 且能独立构建。
2. **【用户】** 法务审阅 `LICENSE`(私有版的范围说明)、`oss/overlay/LICENSE`、`ee/LICENSE` 的措辞(裁定 ⑤)。
3. **【用户】** 同意下载并安装 Gitleaks 8.30.1(裁定 ⑥),然后在最终发布 commit 上跑 `python3 scripts/audit-secrets.py snapshot --ref <sha>`,零未处理项,报告存档。
4. **【用户】** 确认 `SECURITY.md` 里的报告邮箱(当前占位 `security@uselumo.ai`)真实存在、有人收。
5. 早期代码归属已确认(LUM-1035 Watch out)。

## 2. 首次发布

### 2.1 在私有仓准备快照(可由 agent 做)

```bash
# 在要发布的 commit 上(通常是 origin/main 的某个 SHA)
bash scripts/oss-export/publish.sh <sha> --version v0.1.0
```

`publish.sh` 是 **dry run**:导出快照到 `/private/tmp/lumo-oss-publish.*/snapshot`(保留供审阅)、跑 `verify-snapshot.sh`、Gitleaks 已安装时跑密钥扫描、检查快照里有 README/LICENSE/CONTRIBUTING/SECURITY/DCO workflow 且没有 `ee/`、`oss/`、本文件,最后**打印**发布命令。它从不 `git push`、不打 tag、不建仓库、不调 `gh` 或 GitHub API;但它**不是离线的**:`verify-snapshot.sh` 会在快照里 `npm ci --ignore-scripts`,从 npm registry 下载依赖(`--skip-verify` 跳过这一步,退出码随之为 3)。退出码:

| 退出码 | 含义                                                                        |
| ------ | --------------------------------------------------------------------------- |
| 0      | 全部关卡通过,可以发布                                                       |
| 3      | 跑了的关卡都通过,但有关卡没跑(通常是 Gitleaks 未安装或用了 `--skip-verify`) |
| 1      | 有关卡失败,不能发布                                                         |
| 2      | 用法错误                                                                    |

首发时没有公开仓可比对,`public-clone` 关卡显示 `skip`,不影响退出码。

人工审阅快照:`ls -la <snapshot>`、打开 README 顶部链接、`CONTRIBUTING.md`、`SECURITY.md`,并确认落地页正文没有安全扫描/越界分诊描述(导出的禁止标记已保证,抽查即可)。

### 2.2 建库与设置 **【用户】**

1. 在组织 `Lumo-Workspace` 下新建仓库 `lumo-oss`:**Public**,**不要**勾选 README / .gitignore / LICENSE 初始化(首个 commit 必须是扫描过的快照)。描述用 MIT open-core 措辞,例如 "Lumo — agentic project management (MIT open core)"。
2. 推首个 commit 与 tag(命令由 `publish.sh` 打印,在快照目录里执行):
   ```bash
   cd <snapshot> && git init -b main && git add -A
   git commit -s -m "release: v0.1.0" -m "Lumo-Release: v0.1.0"
   git remote add origin git@github.com:Lumo-Workspace/lumo-oss.git
   git push -u origin main
   git tag -a v0.1.0 -m "Lumo v0.1.0" && git push origin v0.1.0
   ```
   `Lumo-Release:` trailer 用来区分「发布快照 commit」和「外部 PR commit」,`publish.sh` 的回流检查依赖它,**每次发布都要带**。
3. 仓库设置(Settings):
   - **Branch protection / ruleset**(`main`):要求 PR、至少 1 个审批、要求状态检查 `DCO` 通过、禁止 force-push 与删除。维护者发布时需要直推 `main`:给维护者 bypass,或者发布也走 PR(见 §3)。
   - **Merge 方式**:只开 Squash merge;「Default commit message」选 **Pull request title and commit details**,这样 squash 后的 commit 保留各 commit 的 `Signed-off-by`。
   - **Code security**:开启 Secret scanning 与 **Push protection**、**Private vulnerability reporting**(`SECURITY.md` 指向它)、Dependabot alerts 与 Dependabot security updates。
   - **Actions**:允许运行;「Fork pull request workflows」要求首次贡献者经批准后才运行;Workflow permissions 选 Read。
   - 首个 PR(或手动 re-run)跑过一次 `DCO` 后,它才会出现在 required checks 的可选列表里。
4. 在一个测试 PR 上确认 `DCO` 检查生效:未签名 commit 失败,`git commit -s` 后通过;作者邮箱写成 `…[bot]@users.noreply.github.com` 的未签名 commit 在人开的 PR 里同样失败(机器人豁免只认 GitHub 账号:PR 由白名单 bot 开、且 commit 关联到同一 bot 账号)。超过 250 个 commit 的 PR 直接失败。

### 2.3 记录

在 LUM-1035 记下:发布 commit SHA(公开仓)、对应私有仓 SHA、`publish.sh` 的 `summary.txt`、gitleaks 报告位置、`verify-snapshot` 的 jest 摘要。

## 3. 每次发布

1. **先回流**:公开仓上一次 tag 之后合并的外部 PR,全部按 §4 回流到私有仓并合进 main。否则从私有仓导出的快照会把它们**悄悄回退**。
2. 在私有仓要发布的 commit 上跑(`<public-clone>` 是公开仓的本地最新克隆,只读使用):
   ```bash
   bash scripts/oss-export/publish.sh <sha> --version vX.Y.Z --public-clone <public-clone>
   ```
   关卡依次:export → verify-snapshot → gitleaks(`audit-secrets.py snapshot`)→ 快照文件 → 与公开仓的差异 → 回流检查(公开仓上次 tag 之后、不带 `Lumo-Release:` 的每个 commit,都要在私有仓有 `Upstream-Commit: Lumo-Workspace/lumo-oss@<sha>` 的 commit)。必须退出码 0。
3. 审阅 `logs/removed-files.txt`:快照删掉的公开文件应当只来自私有仓里的删除/改名,不应出现外部 PR 新增的文件。
4. **【用户/维护者】** 推送(命令由脚本打印):
   ```bash
   rsync -a --delete --exclude .git <snapshot>/ <public-clone>/
   cd <public-clone> && git add -A
   git commit -s -m "release: vX.Y.Z" -m "Lumo-Release: vX.Y.Z"
   git push origin main          # main 受保护时改为推分支开 PR
   git tag -a vX.Y.Z -m "Lumo vX.Y.Z" && git push origin vX.Y.Z
   ```
5. **【用户/维护者】** 在 GitHub 上从 tag 建 Release,写发布说明(含依赖 HIGH 签字放行项,如有,见 pre-release-checklist「依赖漏洞」)。

## 4. 外部 PR 回流到私有仓

前提:PR 已在公开仓 squash-merge,squash commit 的作者是贡献者,正文含 `Signed-off-by`(§2.2 的 merge 设置保证)。

```bash
# 在私有仓的新 worktree / 分支上(分支名按 CLAUDE.md:lumo/LUM-N-backport-…)
UP=<公开仓 squash commit 的完整 SHA>
git fetch <public-clone 或 https://github.com/Lumo-Workspace/lumo-oss.git> main
git format-patch -1 "$UP" --stdout > /private/tmp/oss-$UP.patch

# overlay 文件在私有仓位于 oss/overlay/ 下,其余路径一一对应。
# (1) 非 overlay 文件按原路径应用
git apply -3 --index \
  --exclude=CONTRIBUTING.md --exclude=SECURITY.md --exclude=CLAUDE.md \
  --exclude=LICENSE --exclude='.github/*' --exclude='lib/plugins/installed*.ts' \
  /private/tmp/oss-$UP.patch
# (2) overlay 文件应用到 oss/overlay/(补丁没碰它们时这一步什么也不做)。
#     注意 --include 匹配的是加上 --directory 前缀之后的路径。
O=oss/overlay
git apply -3 --index --directory=$O \
  --include=$O/CONTRIBUTING.md --include=$O/SECURITY.md --include=$O/CLAUDE.md \
  --include=$O/LICENSE --include="$O/.github/*" --include="$O/lib/plugins/installed*.ts" \
  /private/tmp/oss-$UP.patch

# 保留原作者、原提交说明(含贡献者的 Signed-off-by),追加来源 trailer
git commit -C "$UP" --trailer "Upstream-Commit: Lumo-Workspace/lumo-oss@$UP"
```

`git apply` 的路径列表以 `cd oss/overlay && find . -type f` 为准;overlay 增减文件时同步更新本节命令。这组命令在 LUM-1035 用临时仓库演练过:非 overlay 文件、`oss/overlay/` 下的文件都正确落位,`git commit -C` 保留了贡献者的作者信息与 `Signed-off-by`;只改 overlay 文件的补丁在第 (1) 步退出码为 0、不做任何改动。

需要人工处理的情况:

- **改到 transform 处理过的文件**(`README.md`、`.env.example`、`components/landing/home/lumo-home.tsx`、`faq.tsx`、`docs/self-hosting/*`、`vercel.json`、`deploy/self-host/crontab` 等,见 `oss/manifest.json` 的 `transforms`):私有源文件和公开版不同,`git apply -3` 可能冲突。把改动落到私有源文件上,再确认 transform 仍然命中(导出时对应的禁止标记为 0、`npx jest __tests__/scripts/oss-export-manifest.test.ts` 通过)。
- **核心改动牵连 `ee/`**(插件依赖的接口、类型或 schema 变了):回流 commit 保持原样,在同一个私有 PR 里另起一个 commit 修 `ee/`,不要把私有改动混进贡献者的 commit。
- **新增文件落在 manifest 没覆盖的路径**:`oss:export` 会报 unclassified,在同一私有 PR 里给 `oss/manifest.json` 加规则。
- **schema 迁移**:按 CLAUDE.md「Database Migrations」处理,PR 描述写生产需要什么。

署名与 DCO:`git commit -C` 保留作者姓名、邮箱、时间和完整说明,贡献者的 `Signed-off-by` 原样保留;维护者可以再加自己的 `-s`。**不要** squash 多个上游 commit 成一个、不要改写作者——下一次发布的回流检查按 `Upstream-Commit` 逐个对账。

私有 PR:标题按 CLAUDE.md(`type: description [LUM-N]`),描述里列出回流的上游 commit/PR 链接;跑 `npx tsc --noEmit --incremental false`、全量 jest、`npm run lint`,以及 `bash scripts/oss-export/verify-snapshot.sh HEAD`。

## 5. 回滚

| 情况                                    | 做法                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 发布内容有 bug / 漏了回流               | 不改写历史。修好后发一个补丁版本(新快照 commit + 新 tag),或在公开仓 `git revert` 发布 commit 再走 §3。                                                                                                                                                                                                  |
| tag 打错                                | 已推送的 tag 不移动(别人可能已拉取):发新的补丁版本 tag;GitHub Release 标为 pre-release 或在说明里注明作废。                                                                                                                                                                                             |
| 快照里混进了密钥或私有内容 **【用户】** | ① 先当作已泄露:立即轮换凭据(记录进 `historical-credential-rotations.json`)。② 用户明确批准后,才能在公开仓重写历史(force-push 是唯一例外场景,需临时关闭分支保护)并删除受影响的 tag/Release。③ 联系 GitHub Support 清除缓存视图与 PR 引用。④ 修 manifest(exclude 或 forbiddenMarker),重新跑 §3 全部关卡。 |
| 回流的 patch 有问题                     | 在私有仓 revert 该 commit(保留 `Upstream-Commit` 记录不删);如需公开仓同步撤回,在公开仓 revert 对应 PR。                                                                                                                                                                                                 |

## 6. 演练记录

LUM-1035 的 Done when 要求同步流程演练一次。演练在 §2.2 建库之后进行:用一个测试 PR(签名与不签名各一次)走完 §4 回流,再走一次 §3 发布,把 `summary.txt` 与 PR 链接记到任务里。
