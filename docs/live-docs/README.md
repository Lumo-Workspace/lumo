# Live docs — 权威 markdown 源

这个目录存放 Lumo 活文档(线上 workspace document)的**权威 markdown 源**。
凡是含表格等复杂结构、且会被反复增量编辑的活文档,一律以这里的源文件为唯一可编辑入口。

## 为什么

`lumo doc show` 把存储侧 HTML 渲染回 markdown 是**有损的**(docs.md 参考已明确
round-trip 非幂等):表格会被拍平成一行一格的纯段落。如果把 `doc show` 的输出改一改
再 `doc update --file` 回传,存储里的表格就真退化成纯文本了(LUM-349 的事故根因)。

正向路径(markdown → HTML,`shared/src/markdown-tiptap.ts` 的 `markdownToHtml`)
对 GFM 管道表格是无损的。所以约定:**只走正向路径,永远不要把 `doc show` 的输出当
可回传源**。

## 编辑流程

1. 只改本目录下的源文件(查下方映射表找到对应文件);
2. 上传:`lumo doc update <docId> --file docs/live-docs/<file>.md`
   — 服务端自 LUM-410 起**内置结构守卫**:新内容相对线上 body 减少了表格/行/标题数时,
   上传被 422 拒绝并逐类列出缺口(如 `table 1→0, tr 4→0`)。**确属有意删节**(删整节、
   删表、删行)时加 `--allow-shrink` 放行;否则先怀疑源文件改错或基底 stale(先
   `lumo doc diff` 对账),不要条件反射加 flag。
3. 校验:`npx tsx scripts/verify-live-doc.ts <docId> docs/live-docs/<file>.md`
   — 拉存储侧 HTML,断言 `<table>`/`<tr>` 数与源渲染结果一致(不一致退出码非 0)。
   守卫拦的是"上传瞬间缩水",此脚本对账的是"存储与本地源一致"(能发现 Web 侧漂移),
   两者互补,保留。

`doc show` 仍可用来**读**(看当前线上内容),只是它的输出不可回传。
如果线上文档被人在 Web UI 里直接改过,先把改动手工同步进源文件再走上面的流程,
否则上传会覆盖掉 Web 侧的编辑。

## 映射表

| 源文件 | docId | 线上文档 |
| --- | --- | --- |
| [lum392-cli-friction-report.md](lum392-cli-friction-report.md) | `cmq7rxdz0000404jsqu064q0w` | [lumo CLI agent 摩擦点实测报告(LUM-392)](https://www.uselumo.ai/workspace/lumo/documents/lumo-cli-agent-lum-392-31) |
| [legal-privacy-policy.md](legal-privacy-policy.md) | `cmujbjzdw002v04l2rehnlj3f` | [Lumo Privacy Policy (draft)(LUM-857)](https://www.uselumo.ai/workspace/lumo/documents/lumo-privacy-policy-draft-45) |
| [legal-dpa-template.md](legal-dpa-template.md) | `cmujbk05e002y04l29qi27c66` | [Lumo DPA Template (draft)(LUM-857)](https://www.uselumo.ai/workspace/lumo/documents/lumo-dpa-template-draft-46) |
| [legal-subprocessors.md](legal-subprocessors.md) | `cmujbk0n6003104l2ihf2lrmy` | [Lumo Subprocessors (draft)(LUM-857)](https://www.uselumo.ai/workspace/lumo/documents/lumo-subprocessors-draft-47) |

三份 `legal-*` 法务文档的覆盖面由 `npx tsx scripts/legal/check-legal-docs.ts <subprocessors|privacy|dpa|published>` 机检;子处理方清单与 [`docs/privacy/llm-data-flow.md`](../privacy/llm-data-flow.md)(LUM-854)的 ZDR 候选集对账,换模型后两边一起更新。

新收编一篇活文档时:把它的权威 md 源放进本目录、在上表加一行、首次上传后跑一次校验脚本。

## 例外:研究吸收登记册(live-doc-only)

[Lumo 研究吸收登记册](https://www.uselumo.ai/workspace/lumo/documents/lumo-research-intake-ledger-29)
(docId `cmq7c5cqi001v04lgwopkrti4`)**不在本目录维护**:它的唯一权威是活文档本身,
repo 不保有它的 md 源(原 `research-intake-ledger.md` 已删除),登记册变更不开 PR。
编辑它必须以活文档**当前内容**为基底——**严禁从任何 repo 历史版本的文件全量
`doc update` 重推**,那会抹掉活文档上比该文件更新的条目。编辑流程(LUM-408 起):
`lumo doc show <docId> --raw` 取当前逐字节 markdown 源为基底 → 本地修改 →
`lumo doc diff <docId> --file <改后文件>` 确认 diff 只含本次编辑 → `doc update`。
校验脚本 `verify-live-doc.ts` 接受任意本地文件路径,照常可用。

## 源文件书写注意

- 表格用标准 GFM 管道语法;单元格内容写在一行内(`markdownToHtml` 是 markdown-it
  默认配置,`html: false`,单元格里不要写裸 HTML——会被转义成字面文本);
- **表格保持紧凑:每个 `|` 两侧一个空格,不做列对齐填充**(写 `| col | meaning |`,
  不写 `| col   | meaning |`)。两个原因都关乎本地可编辑性:① prettier 会重排表格——
  紧凑表被它重新对齐、对齐表每次跑 prettier 都 churn diff,所以本目录已整体进
  `.prettierignore` 保持字节稳定(LUM-412);② Edit 工具按单元格原文精确匹配,
  对齐填充的空白会让匹配变脆(实测会失败),紧凑单元格才能可靠增量编辑。
  这是纯书写约定:服务端逐字节存 `sourceMarkdown`,**没有**写入时表格归一化,
  `doc show --raw`/`doc diff` 保持逐字节(LUM-408);结构守卫比的是渲染后结构、
  对空白不敏感,所以紧凑只为本地编辑、不影响 verify。
- 不要在源文件里写 HTML 注释,同样会被转义后进入文档正文。
