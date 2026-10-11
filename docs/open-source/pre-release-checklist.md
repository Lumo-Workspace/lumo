# 开源发布前检查清单

每次对外发布(打 tag、更新公开仓库、发自托管镜像)之前,在要发布的 commit 上逐项跑一遍。全部退出码为 0 才能发;唯一例外是下文「依赖漏洞」里写的 HIGH 签字放行。

| 检查                         | 命令                                                                                  | 通过条件                                 | 说明                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 生产依赖许可证               | `npm run license:audit`                                                               | 退出码 0                                 | 规则和例外见 [dependency-licenses.md](dependency-licenses.md)                                              |
| 生产依赖已知漏洞             | `npm run audit:prod`                                                                  | 退出码 0(生产依赖里没有 HIGH / CRITICAL) | 规则和已接受项见下文「依赖漏洞」(LUM-1038)                                                                 |
| 发布快照密钥                 | `python3 scripts/audit-secrets.py snapshot --ref HEAD`                                | 退出码 0（零未处理项）                   | 安装 Gitleaks 8.30.1；扫描实际发布 commit，见 [secret-scan.md](secret-scan.md)                             |
| 快照可构建（私有仓执行）     | `bash scripts/oss-export/verify-snapshot.sh <commit>`                                 | 退出码 0                                 | 导出检查全 0，快照内 `tsc --noEmit --incremental false` 与 `jest` 通过；见下文「快照可构建验证」(LUM-1065) |
| 发布总闸(私有仓执行,dry run) | `bash scripts/oss-export/publish.sh <commit> --version vX.Y.Z [--public-clone <dir>]` | 退出码 0                                 | 依次跑导出、快照可构建、发布快照密钥、公开仓文件齐全、外部 PR 已回流;只打印发布命令,不推送(LUM-1035)       |

## 首次公开发布前置(LUM-1035)

公开仓库 `Lumo-Workspace/lumo-oss` 的首个 commit 必须是扫描过的快照。推送之前,下列各项全部完成并在 LUM-1035 留下记录。标 **【用户】** 的需要用户本人或其授权的人执行(账号权限、法务、下载二进制),agent 不代做。

- [ ] **【用户】法务审阅许可证措辞**:私有仓 `LICENSE` 开头的范围说明、快照用的 `oss/overlay/LICENSE`(纯 MIT)、`ee/LICENSE`(插件专有许可)。审阅后如需改字,三处与 `__tests__/scripts/oss-export-manifest.test.ts` 的 LICENSE 断言一起改(LUM-1066 遗留,裁定 2026-10-11 ⑤)。
- [ ] **【用户】在最终快照上重跑 gitleaks**:先由用户同意下载安装 Gitleaks **8.30.1**(裁定 ⑥,未同意前 agent 不下载任何二进制),再在要发布的那个 commit 上跑 `python3 scripts/audit-secrets.py snapshot --ref <sha>`,零未处理项;`publish.sh` 检测到已安装的 8.30.1 时会自动跑这一步,未安装时退出码 3(未就绪)。报告存档到任务。
- [ ] **【用户】确认 `SECURITY.md` 的报告邮箱**:`oss/overlay/SECURITY.md` 现在写的是 `security@uselumo.ai`(占位),确认这个邮箱存在、有人值守;否则改成真实地址后重新导出。
- [ ] **【用户】在 GitHub 建库并完成设置**:在 `Lumo-Workspace` 组织下建 Public 仓库 `lumo-oss`(不初始化任何文件),推首个快照 commit 与 tag,然后配置分支保护(要求 PR、审批与 `DCO` 检查)、只开 squash merge 且默认提交说明含 commit 详情(保留 `Signed-off-by`)、Secret scanning + Push protection、Private vulnerability reporting、Dependabot alerts 与 security updates。步骤与命令见维护者发布手册(私有仓 `docs/open-source/release-and-sync.md`,不进快照)。
- [ ] 早期代码归属已确认。
- [ ] `publish.sh` 在发布 commit 上退出码 0(首发时没有公开仓可比对,`public-clone` 关卡为 skip)。

## 快照可构建验证(LUM-1065)

开源快照不含安全插件(`ee/`)、私有评测集和它们的测试,两个插件清单(`lib/plugins/installed.ts`、`installed.client.ts`)换成空列表。只做静态的导出检查不够:快照得自己能编译、能跑测试。这一步在私有仓里跑(导出工具 `scripts/oss-export/` 不进快照):

```bash
bash scripts/oss-export/verify-snapshot.sh <要发布的 commit>   # 加 --keep 保留快照目录
```

脚本依次:`oss:export` 到 `/private/tmp`(或 `/tmp`)下新建的空目录 → 在快照里 `git init` 并提交一次(让 `origin/main` 指向它,和公开仓库的新克隆一致) → 确认当前目录确实是这次导出的全新快照后才 `npm ci --ignore-scripts` → `npx prisma generate` → `npm run build:shared` → `npx tsc --noEmit --incremental false` → `npx jest`。每步日志和退出码写在 `<工作目录>/logs/`,`summary.txt` 汇总;快照的 `node_modules` 结束时总会删除。任何一步非 0,脚本退出码非 0,不能发布。

导出本身的检查(未分类文件、导入越界、配置引用悬空、禁止标记)必须全为 0;`vercel.json` 与 `deploy/self-host/crontab` 里的插件 cron 由 manifest 的 transform 过滤掉,快照里不会调度到 404。

## 依赖漏洞(LUM-1038)

`npm run audit:prod` = `npm audit --package-lock-only --omit=dev --audit-level=high`。

- **只看 lockfile,不看本地 node_modules**,所以在 worktree 里也能跑,结果和 CI/自托管安装一致。
- **只看生产依赖**(`--omit=dev`)。devDependencies 不进自托管的运行时,不在这项检查范围内。
- **HIGH / CRITICAL 阻断发布**:脚本没有例外机制,出现就退出码非 0,只能升级到修复版本来消掉。上游确实没有修复版、又能论证在我们的用法下不可利用时,由发布负责人明确签字放行,并在下表和发布说明里写明理由;脚本仍然是红的,不会被这张表变绿。
- **MODERATE / LOW 不阻断**(脚本不报错)。下表是人工维护的记录,发布前对照 `npm audit --package-lock-only --omit=dev` 的完整输出核一遍:出现新的项就补一行理由,已经消失的项就删掉。

### 当前已接受的项(2026-10-06,LUM-1038 之后)

| 包                                                             | 级别     | Advisory            | 为什么接受                                                                                                                                      |
| -------------------------------------------------------------- | -------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `postcss-selector-parser` <7.1.6(经 `@tailwindcss/typography`) | moderate | GHSA-rj75-hqrm-r3gf | typography 最新版 0.5.20 仍锁死 `6.0.10`,上游没有修复版。它只在构建时处理我们自己的 `app/globals.css`,输入不受用户控制,二次方复杂度打不到运行时 |
| `katex` <0.18.2(经 `mermaid`)                                  | low      | GHSA-238p-pmpm-9mq7 | mermaid 11.x / 12.x 都要求 `^0.16.47`,上游没有修复版。利用前提是页面上已经存在另一个原型污染漏洞;katex 只在浏览器端渲染图表里的公式             |

### LUM-1038 已修复的项

| 包                                                         | 升级            | Advisory            |
| ---------------------------------------------------------- | --------------- | ------------------- |
| `@modelcontextprotocol/sdk`(连带 `mcp-handler` 的间接告警) | 1.29.0 → 1.32.1 | GHSA-6qxp-vccf-f47h |
| `sharp`                                                    | 0.35.4 → 0.35.5 | GHSA-wq5f-xc86-pv6w |
| `http-cache-semantics`(间接)                               | 4.2.0 → 4.3.0   | GHSA-ch52-4w7c-c8xp |
