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
3. 校验:`npx tsx scripts/verify-live-doc.ts <docId> docs/live-docs/<file>.md`
   — 拉存储侧 HTML,断言 `<table>`/`<tr>` 数与源渲染结果一致(不一致退出码非 0)。

`doc show` 仍可用来**读**(看当前线上内容),只是它的输出不可回传。
如果线上文档被人在 Web UI 里直接改过,先把改动手工同步进源文件再走上面的流程,
否则上传会覆盖掉 Web 侧的编辑。

## 映射表

| 源文件                                                         | docId                       | 线上文档                                                                                                            |
| -------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [research-intake-ledger.md](research-intake-ledger.md)         | `cmq7c5cqi001v04lgwopkrti4` | [Lumo 研究吸收登记册](https://www.uselumo.ai/workspace/lumo/documents/lumo-research-intake-ledger-29)               |
| [lum392-cli-friction-report.md](lum392-cli-friction-report.md) | `cmq7rxdz0000404jsqu064q0w` | [lumo CLI agent 摩擦点实测报告(LUM-392)](https://www.uselumo.ai/workspace/lumo/documents/lumo-cli-agent-lum-392-31) |

新收编一篇活文档时:把它的权威 md 源放进本目录、在上表加一行、首次上传后跑一次校验脚本。

## 源文件书写注意

- 表格用标准 GFM 管道语法;单元格内容写在一行内(`markdownToHtml` 是 markdown-it
  默认配置,`html: false`,单元格里不要写裸 HTML——会被转义成字面文本);
- 不要在源文件里写 HTML 注释,同样会被转义后进入文档正文。
