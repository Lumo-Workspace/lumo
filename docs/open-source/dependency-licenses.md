# 生产依赖许可证清单(LUM-1016)

> 审计基线:`origin/main` @ b44ab0bb8 + 本 PR(2026-10-06)。重新生成见文末「方法」。

## 结论

- **生产依赖树(直接 + 传递)里没有 GPL / AGPL / SSPL 等强 copyleft,也没有未审阅的非 OSI 许可证。** `npm run license:audit` 退出码 0。
- 唯一的非 OSI 项 `@anthropic-ai/claude-code` 与 `@anthropic-ai/claude-agent-sdk`(`SEE LICENSE IN README.md`,连同 8 个 `claude-code-<平台>` 二进制包)已从 `dependencies` **移到 `devDependencies`**。核实结果:代码里只有 `scripts/test-agent-sdk.ts` 会 `import` agent-sdk;`scripts/test-agent-main-flow.ts`、`scripts/test-claude-md.ts`、`scripts/test-agent-in-sandbox.ts` 只是在 sandbox 里用 `npm install -g @anthropic-ai/claude-code` 安装它(字符串,不是 import)。`app/`、`lib/`、`cli/`、`shared/` 都没有引用。脚本保留,没有删。
- 移动之前审计会报 10 个非 OSI 包;移动之后是 0。这一点由 `__tests__/scripts/license-audit.test.ts` 里针对真实 `package-lock.json` 的回归用例守住。

## 规模

| 口径                                                | 数量 |
| --------------------------------------------------- | ---- |
| 直接依赖(根 `dependencies`)                         | 121  |
| 生产闭包,按 lockfile 路径计(含所有平台的可选二进制) | 1384 |
| 生产闭包,按唯一 `name@version` 计                   | 1213 |

按许可证分组(以 lockfile 路径计):

| 许可证                                   | 数量 |
| ---------------------------------------- | ---- |
| MIT                                      | 1091 |
| Apache-2.0                               | 129  |
| ISC                                      | 73   |
| BSD-2-Clause                             | 20   |
| BSD-3-Clause                             | 17   |
| BlueOak-1.0.0                            | 13   |
| LGPL-3.0-or-later                        | 10   |
| Apache-2.0 AND MIT                       | 9    |
| Unlicense                                | 5    |
| (MIT OR CC0-1.0)                         | 4    |
| Apache-2.0 AND LGPL-3.0-or-later         | 3    |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 2    |
| (AFL-2.1 OR BSD-3-Clause)                | 1    |
| (Apache-2.0 AND BSD-3-Clause)            | 1    |
| (MPL-2.0 OR Apache-2.0)                  | 1    |
| 0BSD                                     | 1    |
| CC-BY-4.0                                | 1    |
| MIT AND ISC                              | 1    |
| MIT-0                                    | 1    |
| Python-2.0                               | 1    |

## 非宽松许可证项(已逐项审阅)

| 包                                                                | 版本         | 许可证                                   | 引入方                                             | 处理                                                                                                                                            |
| ----------------------------------------------------------------- | ------------ | ---------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `@img/sharp-libvips-*`(darwin / linux / linuxmusl 共 10 个平台包) | 1.3.3        | LGPL-3.0-or-later                        | `sharp`(根直接依赖,Next.js 图片优化)的平台可选依赖 | 接受。预编译的 libvips 动态库,由 sharp 动态加载、未修改;LGPL 允许动态链接。源码在 github.com/lovell/sharp-libvips。每台机器只装自己平台的那一个 |
| `@img/sharp-win32-{arm64,ia32,x64}`                               | 0.35.4       | Apache-2.0 AND LGPL-3.0-or-later         | `sharp` 平台可选依赖                               | 接受,理由同上(Windows 构建把 libvips 打包在一起)                                                                                                |
| `@img/sharp-wasm32`                                               | 0.35.4       | Apache-2.0 AND LGPL-3.0-or-later AND MIT | `sharp` 平台可选依赖(freebsd / webcontainers)      | 接受,理由同上                                                                                                                                   |
| `dompurify`                                                       | 3.4.16       | MPL-2.0 OR Apache-2.0                    | 根直接依赖                                         | 双许可,选 Apache-2.0。即便按 MPL-2.0,它也是文件级 copyleft,不影响我们自己的代码                                                                 |
| `caniuse-lite`                                                    | 1.0.30001810 | CC-BY-4.0                                | `autoprefixer` → browserslist                      | 接受。这是浏览器支持度**数据**(内容许可证,要求署名),只在构建时读取,不是被链接的代码;npm 生态里普遍存在                                          |

其他需要留意但属于宽松类的许可证:BlueOak-1.0.0(isaacs 系列:glob、minimatch、lru-cache、tar 等)、Python-2.0(`argparse`)、(AFL-2.1 OR BSD-3-Clause)(`json-schema`,选 BSD-3-Clause)、Unlicense、0BSD、MIT-0,都是 OSI 认可的宽松许可证。

**package.json 里没有 license 字段、靠 LICENSE 文件确认的包**:`khroma@2.1.0` → MIT(经 mermaid 引入),`@vercel/cli-auth@0.0.1` → Apache-2.0(经 `@workflow/cli` 引入)。两者都已人工看过 LICENSE 原文。

## 顺带发现(本 PR 不处理)

- **lockfile 里有一个已删除的 workspace**:根 `package.json` 的 `workspaces` 仍然列着 `agent-server`,但这个目录在仓库里已经不存在,lockfile 把它标成 `extraneous`(它声明的 `fastify` 依赖从未安装)。审计会跳过 extraneous 的根。建议另开任务从 `workspaces` 里删掉。
- **本地 node_modules 比 lockfile 旧**(`--check-node-modules` 查出来的):`proxy-addr` 装的是 2.0.7,lockfile 是 2.0.8;`source-map-js` 装的是 1.2.1,lockfile 是 1.2.2。两者都是 MIT,不影响结论。另有 100 个包没装在本机,都是其他平台的可选二进制,属正常。
- `npm install --package-lock-only` 顺手把 lockfile 里 `cli` workspace 的版本从 1.91.0 同步成了 1.97.0(和 `cli/package.json` 一致)。

## 方法(可重复执行)

```bash
npm run license:audit                                  # markdown 摘要,有阻断项时退出码为 1
npx tsx scripts/license-audit.ts --check-node-modules  # 再和本地已安装的副本对比版本和许可证
npx tsx scripts/license-audit.ts --json                # 完整清单(每个包、许可证、引入方)
```

- **数据源是 `package-lock.json`,不是本地 node_modules。** 从根包和每个 workspace(`shared`、`cli`)出发,按 Node 的解析规则遍历 `dependencies`、`optionalDependencies` 和非可选的 `peerDependencies`,不跟随 `devDependencies`。这样能覆盖所有 OS/CPU 的可选二进制(Linux 自托管装的 `@img/*`、`@esbuild/*` 包和 Mac 开发机不一样)。
- 遍历出的闭包和 npm 自己写在 lockfile 里的 `dev` 标记**完全一致**(1384 = 1384),有单测守着。为什么不直接用 `npm ls --omit=dev --all --json`:在 worktree 里(node_modules 是软链接)它会把全部包报成 extraneous;在主 checkout 里它的 JSON 对 deduped 节点只给出存根、不给子树,而且只看得到本机平台装了的包。
- 许可证读取顺序:先用 lockfile 的 `license` 字段,其次用 `node_modules/<path>/package.json`,最后识别 LICENSE 文件的标题(只看前 3 个非空行,不匹配正文里的样板句)。标题认不出来就记为 unknown、列入「Needs manual review」并算作阻断项,不去猜。某个已安装包的 package.json 格式坏了,会记成一条 error 继续跑,不会让整个审计崩掉。
- 分类规则:`OR` 取最宽松的那个选项,`AND` 取最严格的;`SEE LICENSE IN …`、`UNLICENSED`、无法识别的 ID 一律算非 OSI。人工审阅过的例外写在 `scripts/license-audit.ts` 的 `ACCEPTED_EXCEPTIONS` 里,按「包名(或平台包前缀)+ 审阅时的许可证表达式(+ 可选版本)」匹配,每条附一行理由。包的许可证一旦变了,例外就不再生效,审计会重新报出来。
