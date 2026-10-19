# CLI output conventions

**Status: agreed (2026-10-18).** The open questions of the review draft were decided by the user on 2026-10-18 and recorded on LUM-1232; the outcomes are in [Decisions](#17-decisions). Code changes follow in batches A–G (see [Rollout batches](#16-rollout-batches)). Until a batch lands, the "before" output is still what the CLI prints.

This document is the one rulebook for what `lumo` prints: lists, detail views, times, numbers, enums, empty values, symbols, `--json`, errors and exit codes, paging, hints and help text. The model is the GitHub CLI (`gh`), with ideas from `kubectl`, `vercel`, `stripe` and [clig.dev](https://clig.dev). Where Lumo differs on purpose, the rule says so.

Each rule has:

- **Helper** — the `cli/src/lib/` function the rule is implemented in. "new" means the batch has to add it.
- **Before → after** — real output from a read-only audit of CLI 1.125.2 (2026-10-18), followed by what the rule produces. Emails and IP addresses are replaced with placeholders, and long lines are shortened with `…`.

## Contents

1. [Principles](#1-principles)
2. [Lists](#2-lists)
3. [Detail views](#3-detail-views)
4. [Time](#4-time)
5. [Numbers and durations](#5-numbers-and-durations)
6. [Enums, casing and colour](#6-enums-casing-and-colour)
7. [Empty values](#7-empty-values)
8. [Symbols](#8-symbols)
9. [Paging and empty states](#9-paging-and-empty-states)
10. [Hints and `--no-hints`](#10-hints-and---no-hints)
11. [`--json`](#11---json)
12. [Errors and exit codes](#12-errors-and-exit-codes)
13. [Help text](#13-help-text)
14. [Formats agents depend on (do not break)](#14-formats-agents-depend-on-do-not-break)
15. [Helper map](#15-helper-map)
16. [Rollout batches](#16-rollout-batches)
17. [Decisions](#17-decisions)

---

## 1. Principles

These apply to every rule below; each rule's examples show them at work.

**Three output modes, picked by the environment, never by guessing.**

| Mode     | When                                                | Shape                                                                       |
| -------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| TTY      | stdout is a terminal                                | Aligned columns, header row, colour, truncation to terminal width, wrapping |
| Pipe     | stdout is not a terminal (agents, `\| grep`, files) | No colour, no header row, no truncation, no wrapping, machine-stable fields |
| `--json` | the flag is given                                   | One JSON document on stdout, nothing else                                   |

`gh` uses the same split: tables with headers on a terminal, tab-separated rows in a pipe, `--json` for scripts. (Unlike `gh`, Lumo never prints relative times; see [Q2](#q2-absolute-time-only).) Lumo agents read the pipe form, so the pipe form is a contract, not a degraded view.

Helper: `colorEnabled()`, `terminalWidth()` in `ui.ts` (existing); `renderListTable()` in `list-table.ts` (existing).

**Streams.** One table decides where every kind of line goes; every other section refers to it.

| Output                                                                                | Stream |
| ------------------------------------------------------------------------------------- | ------ |
| data: rows, facts, sections, success lines, empty-state sentences                     | stdout |
| the paging footer (`Showing …` / `Next page: …`) and hidden-rows notices              | stdout |
| advice on a successful run: the `Next:` block, `Hint:` lines, `Note:` lines           | stdout |
| report sections that list problems as data (`lumo doctor`'s `Warnings` section)       | stdout |
| the exit-4 confirmation envelope and the exit-5 `DONE_BLOCKED` error                  | stdout |
| `--json` output                                                                       | stdout |
| `Error:` lines and the `Hint:` / `Usage:` lines that belong to that error             | stderr |
| runtime warnings (`⚠ …` from `warn()`) — something went wrong, the command carried on | stderr |
| the JSON error object under `--json`                                                  | stderr |

The audit found data and errors already split this way; keep it. The exit-4 and exit-5 outputs are on stdout because agents parse them as results (see [§14](#14-formats-agents-depend-on-do-not-break)).

**Presentation only.** These rules change how output looks, never what a command does, which rows it returns, or which exit code a given outcome gets (except usage errors, see [Q4](#q4-usage-errors-exit-2)).

**Untrusted text is sanitized first and styled after.** Every server- or agent-authored string goes through `sanitizeField` before any formatting helper; colour is applied last. `<untrusted-…>` wrappers are content, not decoration: formatting never removes or rewrites them.

---

## 2. Lists

### L-1. Every list goes through one renderer

All list-shaped output (one row per item) is rendered by `renderListTable`. Hand-built `\t` joins and `padEnd` columns are not allowed.

Helper: `renderListTable()` in `list-table.ts` (existing; 18 command files use it today).

Before (`lumo task testcase list LUM-1185` in a terminal — tabs, no header, rows run off the screen):

```
TC1	show 显示 UNPROVEN 封顶及原因与 required env	2 steps / 1 verify	PASS on LOCAL @8841947 (2026-10-17) by Chao Li via session 60e98fc0 · 3 of 3 steps passed
TC2	show 显示 cause、抽查复核和完整逐步报告	2 steps / 1 verify	PASS on LOCAL @8841947 (2026-10-17) by Chao Li via session 60e98fc0 · 3 of 3 st
```

After (TTY):

```
ID   RESULT  ENV    COMMIT   RUN AT                   STEPS  TITLE
TC1  PASS    LOCAL  8841947  2026-10-17 00:53 +08:00  3/3    show 显示 UNPROVEN 封顶及原因与 required env
TC2  PASS    LOCAL  8841947  2026-10-17 00:53 +08:00  3/3    show 显示 cause、抽查复核和完整逐步报告

11/11 passing
```

### L-2. TTY form: header, alignment, one flexible column

- Header row in UPPER CASE, bold when colour is on. Same concept, same header word across commands (`ID`, `STATUS`, `PRIORITY`, `TITLE`, `TOTAL`, …).
- Columns aligned by display width (CJK counts 2), two spaces between columns.
- Exactly one free-text column (title / name / message) is the **flex** column. It is the last column and the only one cut with `…` to fit the terminal. Identifiers, refs, enums and numbers are never cut.
- Numeric columns are right-aligned.

Helper: `renderListTable({ header, flex, align })` (existing).

Before (`lumo cost` — lower-case header, and the identifier column is cut instead of the free text):

```
By tool:
  operation                         output       input  cache_create    cache_read         total
  mcp__Claude_Browser__javascr       5,303          30        17,565     8,134,972     8,157,870
```

After:

```
By tool
  OPERATION                                 OUTPUT  INPUT  CACHE WRITE   CACHE READ        TOTAL
  mcp__Claude_Browser__javascript_tool       5,303     30       17,565    8,134,972    8,157,870
```

(`lumo report` already prints `CACHE WRITE` / `CACHE READ` in upper case; `cost` adopts the same words.)

### L-3. Pipe form: no header, no truncation, stable fields

In a pipe the table has no header row, no colour and no truncation; one item is one line, and column order never changes. Fields are separated by a single TAB, as in `gh` ([Q1](#q1-piped-lists-are-tab-separated)).

Helper: `renderListTable()` non-TTY branch (existing; separator change is new in batch A).

Before (`lumo task list | cat`, space-aligned):

```
LUM-1    DONE  MEDIUM  Lumo    Add Keyboard Shortcuts to Description Editor Bubble Menu
LUM-858  DONE  HIGH    Lumo    工作区数据导出(GDPR 可携带权)
```

After (`⇥` marks a TAB):

```
LUM-1⇥DONE⇥MEDIUM⇥Lumo⇥Add Keyboard Shortcuts to Description Editor Bubble Menu
LUM-858⇥DONE⇥HIGH⇥Lumo⇥工作区数据导出(GDPR 可携带权)
```

### L-4. The first column is the ref

The first column is the item's human-readable ref: the handle you pass to the matching `show` command, written the way the web app writes it. No rank number, bullet or other prefix goes in front of it; if rank matters, the row order carries it.

| List                          | First column | Matching `show` argument                        |
| ----------------------------- | ------------ | ----------------------------------------------- |
| `task list`, `next`, `search` | `LUM-42`     | `lumo task show LUM-42`                         |
| `crossing list`               | `LUM-X924`   | `lumo crossing … LUM-X924`                      |
| `milestone list`              | slug         | `lumo milestone show <slug>`                    |
| `sprint list`                 | `#13`        | `lumo sprint show 13` (the `#` is display only) |
| `task testcase list LUM-42`   | `TC3`        | `lumo task testcase show LUM-42/TC3`            |

A list scoped to one parent (the test cases of one task) prints the short ref; the full handle is `<parent>/<short ref>`, and the command's help says so. Every example in this document that shows a list follows this rule, including the examples under time (§4) and enums (§6).

Helper: `renderListTable()` (existing); refs come from the server (the human-readable refs work).

Before (`lumo next` in a terminal — the `1.` prefix pushes every row out of line with its header):

```
TASK         STATUS  PRIORITY  TITLE
1. LUM-1039  TODO    URGENT    修复托管 MCP 端点路由错位，确认生产可用
     ↳ URGENT
2. LUM-1075  TODO    HIGH      迁移 T7：生产切换与 14 天稳定期
     ↳ HIGH · unblocks 2 tasks
```

After:

```
ID        STATUS  PRIORITY  WHY               TITLE
LUM-1039  TODO    URGENT    -                 修复托管 MCP 端点路由错位，确认生产可用
LUM-1075  TODO    HIGH      unblocks 2 tasks  迁移 T7：生产切换与 14 天稳定期
```

### L-5. Nothing after the flex column; no line wider than the terminal

On a TTY a row never exceeds the terminal width. Extra detail that does not fit (per-model breakdowns, long notes) goes in a column **before** the flex column, behind `--full`, or in the detail view.

Helper: `renderListTable({ flex })` (existing).

Before (`lumo sprint show 13` — a 223-character line, the model breakdown after the title):

```
    LUM-1135  178.4M tokens  53m     2026-10-15  Milestone test cases replace exit criteria as the close contract                                      claude-opus-5-5 140.7M · claude-sonnet-5-5 33M · claude-haiku-5-5 4.7M
```

After (breakdown moves to `--full`):

```
    ID        TOKENS  AGENT TIME  DONE        TITLE
    LUM-1135  178.4M  53m         2026-10-15  Milestone test cases replace exit criteria as the close contract
```

### L-6. Child rows

A `↳` child row (a breakdown under a parent row) is allowed on a TTY. In a pipe every row must stand alone, so a child row repeats its parent key in the first column (`Chao Li/claude-opus-5-5`).

Helper: `renderListTable()` (existing) plus a small `childRows()` helper (new, batch A).

Before (`lumo report | cat` — the child rows cannot be read without the row above):

```
Chao Li                                                                4,836,645,438        18   109
  ↳ claude-opus-5-5    39,254  12,667,583  154,347,275  4,601,079,263  4,768,133,375
```

After (pipe):

```
Chao Li⇥-⇥-⇥-⇥-⇥4836645438⇥18⇥109
Chao Li/claude-opus-5-5⇥39254⇥12667583⇥154347275⇥4601079263⇥4768133375⇥-⇥-
```

(In the pipe form numbers are printed without separators so they can be summed (N-2), and a cell with no value is `-` (V-1), so every row has the same number of fields.)

---

## 3. Detail views

One layout for every `show`-style command. Today there are three: Markdown (`task runs`, `task lineage`), and two `Label: value` variants with different label widths.

### D-1. Title line

The first line is `<ref>  <title>` (bold on a TTY). No Markdown (`#`, `**`), no `Label:` for the title itself.

Helper: `detailHeader(ref, title)` in `detail-layout.ts` (new, batch B).

Before (three commands, three styles):

```
# Agent runs: LUM-1185
```

```
# Lineage: LUM-1189 — 任务级安全扫描汇总:security-scans 路由 bearer 化 + CLI 视图
**Status**: DONE
```

```
Milestone:   Headless 化(一):Web 展示信息 CLI 化
Slug:        headless-web-cli
```

After:

```
LUM-1185  task testcase show/list 展示完整判定(UNPROVEN 上限/cause/复核/逐步报告)
Status:  DONE

Agent runs
  …
```

```
headless-web-cli  Headless 化(一):Web 展示信息 CLI 化
State:       COMPLETED
Close gate:  open
```

Exception: the task context that `lumo task show --full` prints after the detail view (formerly `lumo task context`, LUM-1233) stays Markdown. Its output is written to be pasted into a model's context, and that is documented in the skill.

### D-2. Facts are `Label:  value` rows

- One fact per line, labels in sentence case, padded to the widest label **in that block** (computed, never a hard-coded width).
- Keep labels short (aim for 16 columns or less) so blocks look alike across commands. A long label is a sign the fact belongs in its own section.
- A value that does not fit moves under its label (TTY only, see D-4).

Helper: `kvBlock()` in `ui.ts`, `fieldLines()` in `report-layout.ts` (existing).

Before (`lumo crossing list` — labels padded to a fixed 21 columns because of two long labels; `task show` uses 11):

```
  State:               CONFIRMED
  System explanation:  -
  Agent explanations:  -
  Ruled by:            Chao Li
```

After (the two long facts become a section; the block pads to its own widest label):

```
  State:       CONFIRMED
  Ruled by:    Chao Li
  Ruled at:    2026-10-17 09:24 +08:00

  Explanations
    System:  -
    Agent:   -
```

### D-3. Sections

A section is a blank line, then a heading (bold on a TTY, no colon, no Markdown), then its content indented two spaces. Nesting goes at most three levels deep (2 / 4 / 6 spaces).

Helper: `sectionHeading()`, `indentLines()`, `bulletLines()` in `report-layout.ts` (existing).

Before (`lumo task lineage`):

```
## Totals
- Runs/sessions: 2
- Fragments: 36
- Tokens: 11,712,760 (in 70 · out 13,517 · cache-read 11,671,981 · cache-create 27,192)
```

After:

```
Totals
  Runs:       2
  Fragments:  36
  Tokens:     11.7M (input 70 · output 13.5K · cache read 11.7M · cache write 27.2K)
```

`task wrapup` and its numbered `[1/4] …` headings were removed in LUM-1233; its DONE section is now the `DONE readiness` section of `task status`, a plain D-3 heading.

### D-4. No hard wrapping in a pipe

On a TTY, prose wraps at the terminal width, capped at 100 columns. In a pipe, every logical line is printed whole. Paths, URLs, commands and refs are never broken, in either mode.

Helper: `reportWidth()` / `wrapLines()` in `report-layout.ts` (existing; the "no wrap when not a TTY" switch is new in batch B).

Before (`lumo crossing list | cat` — a path is cut in half at column 100):

```
  Detail:
    cd
    /private/tmp/claude-501/-Users-chaoli-Desktop-lumo-lumo/60e98fc0-e9c1-4a80-9401-9315909c965b/scr
    atchpad/npx-check && S=../mtc; …
```

After (pipe):

```
  Detail:
    cd /private/tmp/claude-501/-Users-chaoli-Desktop-lumo-lumo/60e98fc0-e9c1-4a80-9401-9315909c965b/scratchpad/npx-check && S=../mtc; …
```

### D-5. Structured bodies are rendered, not dumped

A field that holds structured data is rendered as facts or sections, never as raw JSON (`--json` is the place for raw data).

Helper: `kvBlock()` / `sectionHeading()` (existing).

Before (`lumo memory show 3lao7kmv`):

```
[DECISION] 3lao7kmv
{
  "why": "1.125.1 改了 Record 页 Test cases 区显示…",
  "what": "本任务 TC/验收证据用客户实际装到的 npm 发布版 CLI 采集,不跑 dev build。",
  "summary": "TC 证据用已发布的 npm CLI 版本采集",
  …
}
```

After:

```
3lao7kmv  TC 证据用已发布的 npm CLI 版本采集
Type:  DECISION

What
  本任务 TC/验收证据用客户实际装到的 npm 发布版 CLI 采集,不跑 dev build。

Why
  1.125.1 改了 Record 页 Test cases 区显示…

Implications
  前置是先 npm publish 1.125.1…
```

---

## 4. Time

Two kinds of date exist and must not be mixed up (already documented in `format.ts`): **instants** (created, ruled, detected, run at) and **calendar days** (sprint start/end, milestone start/target, due date).

Decided on 2026-10-18 ([Q2](#q2-absolute-time-only)): **the CLI only prints absolute times.** There are no relative times (`3h ago`, `yesterday`) anywhere, because the CLI is read mostly by agents.

### T-1. Instants in a pipe and in `--json`: ISO 8601 in UTC with `Z`

In the pipe form, an instant is printed as ISO 8601 in UTC with a trailing `Z`, to the second: `2026-10-17T01:24:30Z`. No local time, no offset, no milliseconds. In `--json`, the server's ISO 8601 UTC string (`…Z`) is passed through unchanged.

Helper: `fmtInstant(iso, { tty })` in `format.ts` (new, batch D; replaces direct use of `fmtTimestamp`).

Before (`lumo task history LUM-1185 | cat` — local time, no zone; a reader cannot tell which zone):

```
2026-10-15 17:23  Chao Li  task created
2026-10-16 20:33  system   boundary crossing detected
```

After (pipe):

```
2026-10-15T09:23:00Z⇥Chao Li⇥task created
2026-10-16T12:33:00Z⇥system⇥boundary crossing detected
```

### T-2. Instants on a TTY: local time with its UTC offset

On a terminal, an instant is printed in the shell's local time zone, to the minute, followed by the zone's UTC offset: `2026-10-17 09:24 +11:00`. The same form is used in list columns, facts and prose. The offset is the one in force at that instant (so a date across a daylight-saving change shows its own offset).

Helper: `fmtInstant(iso, { tty })` in `format.ts` (new, batch D). `relativeTime()` is retired; its one caller (`task context`'s session list) moves to `fmtInstant()`.

Before (`lumo crossing list` in a terminal — raw UTC ISO with milliseconds):

```
  Detected:            2026-10-16T17:10:09.714Z
  Occurrences:         ×1 · last seen 2026-10-16T17:10:09.714Z
  Ruled at:            2026-10-16T17:15:41.024Z
```

After (TTY, shell in UTC+8; the same values in a pipe print as `2026-10-16T17:10:09Z` and so on, per T-1):

```
  Detected:     2026-10-17 01:10 +08:00
  Occurrences:  ×1 · last seen 2026-10-17 01:10 +08:00
  Ruled at:     2026-10-17 01:15 +08:00
```

### T-3. Calendar days: `YYYY-MM-DD`, never shifted; instants are never cut to a day

A calendar day prints as `YYYY-MM-DD` in every mode, read from its UTC date and never converted to the local zone. A range is `start → end`. No parentheses, no time, no zone.

An instant is not a calendar day. Where a column only needs the day an instant fell on (for example "completed"), a TTY may show the local day (`2026-10-15`), but the pipe form still prints the full UTC instant from T-1, because a bare day without a zone is ambiguous.

Helper: `fmtCalendarDay()` (existing), `fmtDayRange()` in `format.ts` (new, batch D).

Before (`lumo sprint list`, `lumo task testcase list`, `lumo sprint show` — three spellings):

```
ACTIVE  #13  2026-10-05..2026-10-18  Sprint 13
… PASS on LOCAL @8841947 (2026-10-17) by Chao Li …
  Trend:  ▁▂▃▃▃▄▄▅▆▆▇██·  (2026-10-05 → 2026-10-18)
```

After:

```
#13  ACTIVE  2026-10-05 → 2026-10-18  Sprint 13
TC1  PASS    LOCAL  8841947  2026-10-17 00:53 +08:00  3/3  …
  Trend:  ▁▂▃▃▃▄▄▅▆▆▇██·  2026-10-05 → 2026-10-18
```

(The first line is `sprint list`, ref first per L-4. The testcase "run at" value is an instant, so it follows T-1/T-2, not T-3: a full local time with offset on a TTY.)

---

## 5. Numbers and durations

### N-1. A number appears once, in one form

Never print the same value twice in two spellings. The unit is spelled out once, in the label or header (`Tokens:`, `TOKENS`), not as a suffix like `tok`.

Helper: `fmtTokens()` (existing).

Before (`lumo task runs LUM-1185`):

```
Tokens: 145.7M (145.7M tok) · loops 24 · 1 run  [≈ approximate]
```

After:

```
Tokens:  145.7M (approximate) · 24 loops · 1 run
```

### N-2. Compact in summaries, exact in ledgers

- Summary lines and single facts use compact notation: `145.7M`, `13.5K`, `812` (`fmtTokens`).
- Tables whose columns add up (cost, report, scan budgets) use exact integers with thousands separators on a TTY (`fmtCount`: `4,617,665,938`), right-aligned.
- In the pipe form, ledger numbers are plain integers without separators (`4617665938`) so they can be parsed and summed. `--json` always carries raw numbers.

Helper: `fmtTokens()`, `fmtCount()` (existing); a `{ tty }` switch on `fmtCount` (new, batch D).

Before (`lumo task lineage` — exact digits in a summary line):

```
- Tokens: 11,712,760 (in 70 · out 13,517 · cache-read 11,671,981 · cache-create 27,192)
```

After:

```
  Tokens:     11.7M (input 70 · output 13.5K · cache read 11.7M · cache write 27.2K)
```

### N-3. Durations use s / m / h — never days

`45s`, `12m`, `2h 14m`, `3h`; from 48 hours on, always hours and minutes: `80h 19m`, `1301h 0m`. Never days and never fractional hours, so an agent can compare and add durations directly ([Q8](#q8-durations-stay-in-hours-and-minutes)).

Helper: `formatDuration()`, `formatDurationHours()` in `format.ts` (existing).

Before (`lumo sprint show 13`, batch D output):

```
  Total:  8.2B tokens · 3d 8h agent time · 944 runs  (measured on 190 tasks)
```

After:

```
  Total:  8.2B tokens · 80h 19m agent time · 944 runs  (measured on 190 tasks)
```

Before (`lumo project overview`):

```
Avg completion:  1301.1h
```

After:

```
Avg completion:  1301h 6m
```

### N-4. Percentages and ratios

Percentages are whole numbers (`49%`), with one decimal only below 1% (`0.4%`). Progress is `done/total` (`3/3`, `194/194`), with no spaces around the slash.

Helper: `fmtPercent()` in `format.ts` (new, batch D).

Before (`lumo pr scan 1549`, `lumo sprint show 13`):

```
    AI review budget: diff 60,905 chars · tier 120,000 · 59,095 left, 49.2%
Progress:  194 / 194
```

After:

```
    AI review budget:  diff 60,905 chars · tier 120,000 · 59,095 left (49%)
Progress:  194/194
```

---

## 6. Enums, casing and colour

### E-1. Enum values print exactly as in `--json`

Any value that is an enum in the API (status, priority, severity, state, health, result, environment) prints in UPPER_SNAKE_CASE, exactly as the server sends it and as `--json` shows it. No lower-casing, no hyphens. Flags keep accepting lower case (`--status in_progress`).

Helper: `fmtEnum()` in `format.ts` (new, batch D); `lib/milestone-labels.ts` (existing, changes).

Before (`lumo milestone list`, `lumo pr scan`, `lumo task wrapup`):

```
ACTIVE     ON-TRACK  2026-10-30  security-scan-v2   Security Scan v2
  State:  merged
    #1559  merged   feat: task status --full lists each test case's latest run [LUM-1186]
```

After:

```
security-scan-v2  ACTIVE  ON_TRACK  2026-10-30  Security Scan v2
  State:  MERGED
    #1559  MERGED  feat: task status --full lists each test case's latest run [LUM-1186]
```

(Words that are not enums — `checked`, `skipped`, `open` in prose — stay lower case. The `milestone list` row is shown in its final column order, ref first per L-4; batch D changes only the casing, batch A the order.)

### E-2. Colour only adds; it never carries meaning alone

Colour is applied through `style` only, after sanitizing, and only when `colorEnabled()` is true (TTY, no `NO_COLOR`, no `FORCE_COLOR=0`, `TERM` not `dumb` — already correct today; keep). Every coloured value also reads correctly without colour.

| Colour | Used for                                                                      |
| ------ | ----------------------------------------------------------------------------- |
| green  | success: `DONE`, `PASS`, `CLEAN`, `✓`                                         |
| red    | failure or blocking: `FAIL`, `✗`, `HIGH` / `CRITICAL` severity, `blocks DONE` |
| yellow | attention: `⚠`, `IN_REVIEW`, `AT_RISK`, `UNPROVEN`, `MEDIUM` severity         |
| dim    | labels, secondary text (`↳` rows, timestamps in long reports)                 |
| bold   | the title line, section headings, table headers                               |

Helper: `style`, `colorEnabled()` in `ui.ts` (existing); `enumColor()` in `ui.ts` (new, batch D).

Before (`lumo task status LUM-1185` on a TTY — only labels and headings are styled; `DONE` and `ACCEPTED` look like any other word):

```
Status: DONE
Done gate: ACCEPTED — the task is DONE
```

After: same text; `DONE`, `ACCEPTED` and the `✓` marks are green on a TTY. The piped bytes do not change.

---

## 7. Empty values

### V-1. One placeholder: `-`

A missing value in a table cell or a fact is `-` (`NONE`). It means "no value" or "not measured". `0` is printed only for a measured zero (a null `tokenCost` / `activeTimeSec` is `-`, not `0`). Words like `none`, `not recorded`, `unknown`, `not metered` are not used as empty placeholders. (`unknown` remains valid where it is an actual enum value, e.g. `cause: unknown`.)

Helper: `NONE`, `orNone()` in `format.ts` (existing).

Before (`lumo pr scan 1549`; `lumo task comments list` when a comment has no author; the `testcase list` runner wording documented in the skill):

```
  Tokens:         not metered
#cmusgk4w · unknown · 2026-10-03 23:59
… runner not recorded
```

After:

```
  Tokens:         -
#cmusgk4w · - · 2026-10-03 23:59 +08:00
… -
```

### V-2. Explain an absence in a `Note:`, not in the cell

If the reader needs to know why a value is missing, add one `Note:` line under the block (precision caveat), and keep the cell as `-`.

Helper: `note()` in `feedback.ts` (existing).

Before:

```
  Tokens:         not metered
```

After:

```
  Tokens:         -
Note: this scan ran before token metering was enabled.
```

---

## 8. Symbols

### S-1. One symbol set

Only these symbols appear in human output:

| Symbol | Name      | Meaning                                                 |
| ------ | --------- | ------------------------------------------------------- |
| `✓`    | success   | environment / flow confirmations and passed checks only |
| `✗`    | error     | a failed check                                          |
| `⚠`    | warning   | warnings (also the `warn()` prefix)                     |
| `•`    | bullet    | list items inside a section                             |
| `→`    | arrow     | transitions and ranges (`TODO → DONE`, `start → end`)   |
| `·`    | separator | between facts on one line                               |
| `↳`    | child     | a child row (TTY only, see L-6)                         |
| `…`    | ellipsis  | truncation (TTY only)                                   |
| `×N`   | count     | repeat count (`×6`)                                     |

ASCII stand-ins (`!`, `->`, `*`, `(s)`) are not used. A command to run sits on its own line with no arrow in front, so it can be copied whole.

Helper: `icons` in `ui.ts` (existing; add `separator`, `child`, `ellipsis`, `count` in batch D).

Before (`lumo doctor`):

```
    -> lumo init --force
Warnings
  ! codex-untrusted: Codex hooks trust unverified (…)
```

After:

```
    lumo init --force
Warnings
  ⚠ codex-untrusted: Codex hooks trust unverified (…)
```

### S-2. `✓` is not a resource-change marker

Kept from the existing rule: `✓` marks environment and flow confirmations (login, init, worktree ready, crossing ruling, memory push). Create / update / delete success lines start with the verb (`Created milestone …`) and carry no icon.

Helper: `successLine()` in `feedback.ts` (existing).

Before (captured while writing this document — a flow confirmation and a resource change):

```
✓ Worktree ready: /Users/…/lumo/.worktrees/LUM-1232-cli-output-conventions
Added [audit] "CLI output audit: issue list (1.125.2)" to LUM-1232
```

After: unchanged — both already follow the rule.

---

## 9. Paging and empty states

### PG-1. One paging footer

Every paged command takes `--limit <n>` (default 50, maximum 500) and `--cursor <c>`. When a page does not hold the whole result, the output ends with:

```
Showing 1-50 of 1094.
Next page: lumo task list --cursor 50
```

The second line is reworded from `Hint: next page with …` so that it is data, not a hint ([Q5](#q5-the-paging-footer-ignores---no-hints)). Both lines go to stdout. A result that fits on one page prints no footer. When the total is not known, the first line is `Showing 1-50.`.

Helper: `pageFooter()`, `parsePageArgs()` in `pagination.ts` (existing; wording change in batch A).

Before (four spellings — `task list`, `audit list`, `report`, `sprint show`):

```
Showing 1-50 of 1094.
Hint: next page with `lumo task list --cursor 50`
```

```

Hint: more events with `lumo audit list --cursor WyIyMDI2LTEwLTE1VDIy…`
```

```
Completed tasks (showing 50 of 109; raise --limit for more)
```

```
    … 186 more tasks
```

After (all four):

```
Showing 1-50 of 1094.
Next page: lumo task list --cursor 50
```

```
Showing 1-50.
Next page: lumo audit list --cursor WyIyMDI2LTEwLTE1VDIy…
```

```
Completed tasks
  …
  Showing 1-50 of 109.
  Next page: lumo report --cursor 50
```

```
    Showing 5 of 191.
    All tasks: lumo sprint show 13 --full
```

### PG-2. Rows hidden by a filter

Rows hidden by a default filter (not by paging) are reported once, after the rows, with the flag that shows them, and correct plurals (no `(s)`).

Helper: `hiddenRows(count, noun, flag)` in `pagination.ts` (new, batch A).

Before (`lumo crossing list LUM-1185`, default view; the notice comes before the empty state):

```
Boundary crossings on LUM-1185: 0 open (0 blocking DONE), 6 dispositioned
6 dispositioned crossing(s) not shown — add --all for the ruling history.

No open crossings.
```

After:

```
Boundary crossings on LUM-1185: 0 open (0 blocking DONE), 6 dispositioned

No open crossings on LUM-1185.
6 dispositioned crossings hidden. Show them with --all.
```

### PG-3. Empty state

An empty result prints exactly one sentence on stdout and exits 0: `No <things>.` or `No <things> on <scope>.` An optional `Hint:` line may follow on stdout (suppressed by `--no-hints`). In `--json`, an empty result is the normal envelope with an empty array.

Helper: `emptyState()` in `format.ts` (existing).

Before (six spellings found):

```
No tasks.
Dependencies for LUM-1185: no dependency edges.
  None on record.
  No test-case signals.
  No undispositioned crossings.
No test cases on LUM-1.
```

After:

```
No tasks.
No dependencies on LUM-1185.
  No next actions.
  No test cases on LUM-1186.
  No open crossings on LUM-1186.
No test cases on LUM-1.
```

---

## 10. Hints and `--no-hints`

### H-1. Four kinds of trailing text

| Kind       | Shape                         | Purpose                                   | `--no-hints` |
| ---------- | ----------------------------- | ----------------------------------------- | ------------ |
| Next steps | `Next:` block (command + why) | commands worth running now                | hidden       |
| Hint       | `Hint: <text>`                | advice                                    | hidden       |
| Note       | `Note: <text>`                | how far a printed number can be trusted   | shown        |
| Warning    | `⚠ <text>` on stderr          | something went wrong; the command went on | shown        |

`More:` and free-standing asides such as `(or pick any other task from the list)` are not separate kinds: they become `Hint:` lines.

Helper: `formatNextSteps()` / `emitNextSteps()` in `next-steps.ts`, `hint()` / `note()` in `feedback.ts`, `warn()` in `errors.ts` (existing).

Before (`lumo task runs LUM-1185` and `lumo next` — two extra spellings of a hint):

```
More: --full adds attribution signals, subagents, per-model tokens and injected memories; --json for the raw report.
(or pick any other task from the list)
```

After:

```
Hint: `--full` adds attribution signals, subagents, per-model tokens and injected memories.
Hint: any other task in the list works the same way.
```

### H-2. What `--no-hints` (and `LUMO_NO_HINTS=1`) covers

Hidden: every `Next:` block and every `Hint:` line on a successful run.
Not hidden: data, `Note:` lines, warnings, errors and the hint that belongs to an error, the paging footer ([Q5](#q5-the-paging-footer-ignores---no-hints)), and the exit-4 / exit-5 envelopes.

All hint output goes through one gate, `nextStepsSilenced()`. Commands may not call `formatNextSteps()` directly and print the result.

Helper: `nextStepsSilenced()` (existing); `emitHint()` in `feedback.ts` (new, batch G).

Before (`lumo next --no-hints` — `next.ts` builds the block with `formatNextSteps()` and bypasses the gate; `lumo task runs --no-hints` prints `More:`):

```
Next:
  lumo session attach LUM-1039 && lumo task context LUM-1039
      start on the top-ranked task
(or pick any other task from the list)
```

```
More: --full adds attribution signals, subagents, per-model tokens and injected memories; --json for the raw report.
```

After (`--no-hints`): both blocks are gone. Without `--no-hints`:

```
Next:
  lumo session attach LUM-1039 && lumo task context LUM-1039
      start on the top-ranked task
Hint: any other task in the list works the same way.
```

```
Hint: `--full` adds attribution signals, subagents, per-model tokens and injected memories.
```

---

## 11. `--json`

### J-1. Every read-only command has `--json`

Any command that shows data supports `--json`. The audit found 26 commands with it and 32 read-only commands without it, including `task show`, `task context`, `task wrapup`, `task testcase list/show`, `milestone list/show`, `sprint list/show`, `project list`, `doc list/show`, `memory show`, `next`, `session status`, `worktree list`.

Helper: `emitJson()` in `json-output.ts` (new, batch C).

Before (`lumo task show LUM-1185 --json`):

```
error: unknown option '--json'
(run the command with --help to list its valid flags and arguments)
```

After:

```json
{
  "version": 1,
  "task": {
    "ref": "LUM-1185",
    "title": "task testcase show/list 展示完整判定(UNPROVEN 上限/cause/复核/逐步报告)",
    "status": "DONE",
    "priority": "HIGH",
    "project": "Lumo",
    "assignee": { "name": "Chao Li", "email": "chao@example.com" },
    "url": "https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-1185",
    "description": "…"
  }
}
```

### J-2. One envelope

- The top level is always an object, never a bare array.
- It carries `"version": <integer>`. The version changes only on a breaking change.
- A list puts its items under a plural noun (`tasks`, `events`, `notifications`) and adds `total` (number, or `null` when unknown) and `nextCursor` (string, or `null` on the last page).
- A detail view puts the resource under a singular noun (`task`, `milestone`) and related blocks as siblings (`testCases`, `scans`).
- Data only: no colour, no hints, no prose. Server-computed suggestions may ride along as a `nextSteps` field.

Helper: `emitJson()`, `listEnvelope()`, `detailEnvelope()` in `json-output.ts` (new, batch C); `pageJson()` in `pagination.ts` (existing).

Before (`lumo tag list --json` and `lumo task history --json` are bare arrays — so is `lumo task template list --json`, which the audit missed; `lumo inbox list --json` has no `nextCursor`; only 5 commands carry `version`):

```json
[
  {
    "id": "…",
    "name": "agent-containment",
    "color": "…",
    "taskCount": 6,
    "documentCount": 0,
    "createdAt": "…",
    "workspaceId": "…"
  }
]
```

```json
{ "notifications": [ … ], "unreadCount": 0 }
```

After:

```json
{
  "version": 1,
  "tags": [
    {
      "id": "…",
      "name": "agent-containment",
      "color": "…",
      "taskCount": 6,
      "documentCount": 0,
      "createdAt": "…",
      "workspaceId": "…"
    }
  ],
  "total": 19,
  "nextCursor": null
}
```

```json
{ "version": 1, "notifications": [ … ], "unreadCount": 0, "total": 3, "nextCursor": null }
```

(Every field each tag has today is still there; only the wrapper is new. How the bare arrays get there is [Q3](#q3---json-envelope-add-in-place). The notifications API is not paged — it returns the newest 50 — so `inbox list` always has `nextCursor: null`, and `total` is `null` (unknown) when 50 rows came back.)

### J-3. A declared field list per command

Each command declares the fields it promises (its whitelist) and the skill reference documents them. The whitelist says what callers may rely on; it does not remove anything. Field rules:

- camelCase; the human ref is a field (`ref`), next to `id` where an id is useful;
- timestamps are ISO 8601 strings in UTC; calendar days are `YYYY-MM-DD`;
- enums are UPPER_SNAKE_CASE (as E-1);
- an absent value is `null`, not an omitted key;
- a command added from now on emits only its declared fields, so it never starts exposing internal-only columns (`deletedByClerkId`, `trashRootId`, `claimSnapshot*`, `order`, `workspaceId`, …).

Within a `version`, JSON output only ever gains fields (J-5, [Q3](#q3---json-envelope-add-in-place)). Fields outside the whitelist that commands emit today keep being emitted, unchanged. Removing or renaming a field is only possible through the versioned process:

1. **Mark** the field deprecated in the skill reference and the CLI release notes; it is still emitted. If callers need a replacement, it is added first, in the same or an earlier release.
2. **Wait** at least one published CLI release with the notice in place.
3. **Remove** it only in a release that bumps the command's `version` (for example 1 → 2) and lists the removal in the release notes. Nothing is removed without a `version` bump.

Helper: `stripInternalFields()` in `json-output.ts` (new, batch C) — applied by every command that adds `--json` from now on; `pickFields()` / `parseFieldList()` back the `--fields` selection (J-5). `task list --json` lists its deprecated fields in the envelope as `deprecatedFields`.

Before (`lumo task list --json` — 42 fields per task, including internal ones):

```
agentError, agentStatus, assignee, assigneeActorId, blockedByOpenCount, claimSnapshot, claimSnapshotAt,
claimSnapshotSessionId, claimSnapshotSource, claimable, commentsSummary, commentsSummaryAt, createdAt,
deletedAt, deletedByClerkId, description, dueDate, id, inputReason, milestone, milestoneId, number, order, …
```

After (the declared fields that the reference documents; every other field above is still emitted, unchanged, unless the versioned process removes it):

```
ref, id, title, status, priority, project, assignee, milestone, sprint, tags, dueDate,
blockedByOpenCount, unblocksOpenCount, createdAt, updatedAt
```

### J-4. Errors under `--json` are JSON on stderr

With `--json`, a failure prints nothing on stdout and exactly one JSON object on stderr; the exit code is the same as without `--json`:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "task LUM-999999 not found in workspace lumo",
    "hint": "list tasks with `lumo task list`, or search with `lumo task list --assignee any --search <text>`.",
    "exitCode": 1
  }
}
```

`code` is one of `USAGE`, `COMMAND_REMOVED`, `NOT_FOUND`, `AUTH`, `FORBIDDEN`, `CONFLICT`, `RATE_LIMITED` (a submission limit, e.g. `feedback create`; added by LUM-1240), `SERVER`, `NETWORK`, `UNKNOWN`; `exitCode` repeats the process exit code, and any other stderr line (a warning, the `Usage:` line of a usage error) rides in `details`. The exit-4 confirmation envelope and the exit-5 `DONE_BLOCKED` error keep their current shape and stream (stdout) — they are not errors in this sense.

Helper: `installErrorOutput()` / `finalizeErrorOutput()` / `buildErrorJson()` in `error-output.ts` (batch E), installed by `cli/src/index.ts` and finalised in `exitWith()`.

Before (a `--json` read of a missing task, e.g. `lumo task status LUM-999999 --json`: stdout empty, stderr plain text):

```
Error: task LUM-999999 not found in workspace lumo
```

After (stderr):

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "task LUM-999999 not found in workspace lumo",
    "hint": "list tasks with `lumo task list`, or search with `lumo task list --assignee any --search <text>`.",
    "exitCode": 1
  }
}
```

### J-5. Compatibility

- Only add. Existing fields keep their names, types and meaning.
- A breaking change (renaming, removing, reshaping) only happens through the versioned process in J-3 and always bumps `version`. The one reshaping already decided is wrapping the bare arrays (`tag list`, `task history`, and `task template list`, [Q3](#q3---json-envelope-add-in-place)).
- Field selection is optional and additive: bare `--json` keeps printing every field (see Q3). It is a separate flag, `--fields ref,title,status` (with `--json`), on `task list` — not `--json [fields]`. An optional value on `--json` would take the next word, so `lumo task status --json LUM-42` would read `LUM-42` as a field list.

Helper: `json-output.ts` (new).

Before (`lumo inbox list --json`):

```json
{ "notifications": [ … ], "unreadCount": 0 }
```

After — every existing key keeps its name and meaning; new keys are added beside them:

```json
{ "version": 1, "notifications": [ … ], "unreadCount": 0, "total": 3, "nextCursor": null }
```

---

## 12. Errors and exit codes

### X-1. One error prefix

Every error line starts with `Error: ` (capital E), followed by a message that starts lower case and says what failed. Commander's own messages (`error: unknown option …`) are rewritten to the same prefix.

Helper: `errAuth()`, `errHttp()`, `httpFailed()` in `errors.ts` (existing); `normalizeErrorLine()` in `error-output.ts` and Commander's `configureOutput({ outputError })` + `exitOverride()` in `index.ts` (batch E).

Before (`lumo pr scan` with no number, `lumo task testcase show` with two arguments):

```
error: missing required argument 'number'
(run the command with --help to list its valid flags and arguments)
```

After:

```
Error: missing required argument 'number'
Usage: lumo pr scan [options] <number>
Hint: see `lumo pr scan --help` for every flag and argument.
```

### X-2. Say what to do next

An error that the user can fix ends with one `Hint:` line naming the fix. That line goes to stderr with the error (see the streams table in §1), and `--no-hints` does not remove it. A not-found error names a command that lists the valid values.

Helper: `notFoundHint()` in `error-output.ts` (batch E) adds the listing command to any not-found error without a Hint; `refLookupError()` in `ref-error.ts` (existing).

Before (`lumo task show LUM-999999`):

```
Error: task LUM-999999 not found in workspace lumo
```

After:

```
Error: task LUM-999999 not found in workspace lumo
Hint: list tasks with `lumo task list`, or search with `lumo task list --assignee any --search <text>`.
```

`lumo milestone show nope` already does this (`Try \`lumo milestone list\``); it moves to the `Hint:` line.

### X-3. Never pass tool output through as the whole message

Errors from git, the network or the server are wrapped in a sentence that says what Lumo was doing; the raw text, if useful, follows after a colon.

Helper: `describeThrownError()` in `errors.ts` (batch E), used by `wrap()` in `index.ts` for every thrown error.

Before (`lumo worktree list` outside a repository):

```
Error: fatal: not a git repository (or any of the parent directories): .git
```

After:

```
Error: lumo worktree list must run inside a git checkout (git: not a git repository)
Hint: cd into your project and run it again.
```

### X-4. Exit codes

| Code | Meaning                                                                                                  | stdout                                | stderr                                                   |
| ---- | -------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| 0    | success, including an empty result                                                                       | data, footer, hints                   | runtime warnings, if any                                 |
| 1    | the command failed: not found, auth, permission, server, network                                         | nothing (or the rows already printed) | `Error:` + its `Hint:`; JSON error under `--json`        |
| 2    | usage error: unknown flag, missing or extra argument, invalid flag value ([Q4](#q4-usage-errors-exit-2)) | nothing                               | `Error:` + `Usage:` + `Hint:`; JSON error under `--json` |
| 3    | reserved                                                                                                 | —                                     | —                                                        |
| 4    | confirmation required: an exit-4 envelope was printed; unchanged                                         | the envelope                          | —                                                        |
| 5    | blocked by a human-only gate (`DONE_BLOCKED`); unchanged                                                 | the `DONE_BLOCKED` error              | —                                                        |

These columns follow the streams table in §1.

**Lumo's 4 is not `gh`'s 4.** In `gh`, exit 4 means "authentication required" (and 2 means "cancelled"). In Lumo, 4 means "the user must confirm, then re-run `confirmCommand`" and 5 means "blocked; relay, don't retry". These meanings are fixed and documented in the skill; Lumo does not adopt `gh`'s 2 or 4. Authentication failures stay at exit 1 with the fixed `lumo auth login` message.

The comment in `cli/src/index.ts` that reserves 2 for auth and 3 for validation is replaced by this table.

Helper: `exit-codes.ts` (new, batch E) — collects `EXIT_CONFIRMATION_REQUIRED` (`confirmation.ts`) and `EXIT_BLOCKED` (`blocked-error.ts`) and adds `EXIT_USAGE`.

Before (`lumo task list --status wip` — a usage mistake — and `lumo task show LUM-999999` — a real not-found — both exit 1):

```
$ lumo task list --status wip; echo $?
Error: invalid status "wip". Allowed: backlog, todo, in_progress, in_review, done
1
```

After:

```
$ lumo task list --status wip; echo $?
Error: invalid --status "wip" (allowed: backlog, todo, in_progress, in_review, done)
Usage: lumo task list [options]
Hint: see `lumo task list --help` for every flag and argument.
2
```

### X-5. Warnings

A runtime warning is one line on stderr starting with `⚠` (`warn()`); the command continues and exits by its own outcome. A report section that lists problems as its data (`lumo doctor`'s `Warnings`) is output, not a runtime warning: it stays on stdout, and uses the same `⚠` marker.

Helper: `warn()` in `errors.ts` (existing).

Before (`lumo doctor` — the report's `Warnings` section, on stdout, with an ASCII marker):

```
Warnings
  ! codex-untrusted: Codex hooks trust unverified (…/.codex/hooks.json) — open /hooks in Codex and Trust …
```

After (the section stays on stdout as report data; each line uses `⚠`, see S-1):

```
Warnings
  ⚠ codex-untrusted: Codex hooks trust unverified (…/.codex/hooks.json) — open /hooks in Codex and Trust …
```

---

## 13. Help text

### HT-1. Structure

`lumo <command> --help` prints, in order:

```
Usage: lumo task show [options] <task>

Show one task: status, priority, project, assignee, link and description.

Arguments:
  task          task ref, e.g. LUM-42

Options:
  --json        print the task as JSON
  -h, --help    display help for command

Examples:
  lumo task show LUM-42
  lumo task show LUM-42 --json

Exit codes:
  0  ok   1  failed   2  usage error
```

`Examples` and `Exit codes` are added with `addHelpText('after', …)`. `Exit codes` is printed only by commands that can return 4 or 5 (and lists them); the general table lives in `lumo --help`.

Helper: `examplesHelp()`, `exitCodesHelp()` in `help.ts` (new, batch F).

Before (`lumo task testcase show --help` — no arguments section, no examples; 0 of 177 runnable commands have an `Examples` section):

```
Usage: lumo task testcase show [options] <task/case>

Show one test case (four sections, 1-based step numbers) plus its run history;
evidence is listed under the step it is attached to. Handle: LUM-42/TC3

Options:
  -h, --help  display help for command
```

After (the 40 most-used commands in batch F get 1–3 examples each, checked by the same grammar validator that checks the skill's examples):

```
Usage: lumo task testcase show [options] <task/case>

Show one test case, its steps and its run history, with evidence under the step it belongs to.

Arguments:
  task/case   test case handle, e.g. LUM-42/TC3

Options:
  -h, --help  display help for command

Examples:
  lumo task testcase show LUM-42/TC3
```

### HT-2. Description: one job, at most 200 characters

The description says what the command does in at most 200 characters. Details (field lists, edge cases, protocol) belong in the skill reference, not in `--help`. Flag descriptions stay on one line (aim for 100 characters or less); enum values are written as `a | b | c` (the grammar generator reads that form).

Helper: a lint test over `scripts/cli-grammar/grammar.json` (new, batch F).

Before (`lumo crossing list --help`, 559 characters):

```
Read-only: a task's boundary crossings with every detail the web Record panel
shows (LUM-1187) — state, detail, recurrence (xN, last seen), reversibility,
attribution, policy rule text, edit diff summary + PR file link, turn intent,
system/agent explanations, re-judge, AI triage, remediation task; …
```

After:

```
List a task's boundary crossings with their details. Open crossings only, unless --all.
Defaults to the session-bound task.
```

Today 22 descriptions exceed 300 characters (the longest, `workspace security-scan`, has 1,365) and 47 exceed 200.

### HT-3. No internal ticket numbers, no stale text

Help text is read by customers. It contains no internal ticket refs such as `(LUM-1187)` (39 found: 21 command descriptions, 18 flag descriptions), no competitor names, and no mention of removed features. Sample refs inside `Examples` (`LUM-42`) are fine.

Helper: the lint test from HT-2 (new, batch F) rejects `\((?:LUM|SPEC)-\d+\)`-style provenance.

Before (`lumo task status --help`; the dashboard page was removed):

```
Task self-check (LUM-344): nextActions (…), security-scan coverage, and open boundary crossings. … --full adds the dashboard sections (cost, struggle/rework trail, trend) …
```

After:

```
Show where a task stands: next actions, security scans, open crossings and the Done gate. --full adds cost, rework trail and trend.
```

---

## 14. Formats agents depend on (do not break)

These outputs are parsed by agents or documented byte-for-byte in the skill. A batch may restyle around them but must not change them without its own decision on the task:

- the exit-4 `confirmation_required` envelope (JSON on stdout when piped) and its `confirmCommand`;
- the exit-5 `DONE_BLOCKED` error and its blocker list;
- `lumo task status`: section names and their order, and the `Done gate:` line;
- `lumo task status`: the `DONE readiness` section heading (READY only, LUM-1233);
- the first line of `task create`, `task update`, `doc create`;
- the auth error strings in `errors.ts` (`API key invalid or revoked. Run \`lumo auth login\`.`);
- the `Showing a-b of n.` paging line (its second line changes wording, PG-1);
- the `Next:` block shape (`command` line, indented `why` line);
- the `<untrusted-…>` wrappers;
- the task context body of `lumo task show --full` (Markdown, written for model context; formerly `lumo task context`).

Every batch that changes text output updates `.claude/skills/lumo/SKILL.md` and the affected `references/*.md` in the same PR, regenerates `grammar.json` when flags change, and keeps the doc-examples test green.

---

## 15. Helper map

| Rule area            | Existing helper (file)                                                                                                                    | New in batch                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modes, colour, width | `colorEnabled`, `terminalWidth`, `style` (`ui.ts`)                                                                                        | `enumColor` (D)                                                                                                                                             |
| Lists                | `renderListTable`, `flexColumnCap` (`list-table.ts`); `renderTable` (`ui.ts`)                                                             | TAB separator for pipes, `childRows` (A)                                                                                                                    |
| Details              | `kvBlock` (`ui.ts`); `sectionHeading`, `wrapLines`, `fieldLines` (`report-layout.ts`); `taskTableSection` (`detail-layout.ts`)            | `detailHeader`; no wrap when not a TTY (B)                                                                                                                  |
| Time                 | `fmtCalendarDay`, `fmtDay`, `fmtTimestamp`, `relativeTime` (retired in D) (`format.ts`)                                                   | `fmtInstant`, `fmtDayRange` (D)                                                                                                                             |
| Numbers              | `fmtTokens`, `fmtCount`, `formatDuration` (`format.ts`)                                                                                   | `formatDuration` stays in hours above 48h (Q8), `fmtPercent`, `{ tty }` on `fmtCount` (D)                                                                   |
| Enums                | `milestone-labels.ts`                                                                                                                     | `fmtEnum` (D)                                                                                                                                               |
| Empty values         | `NONE`, `orNone` (`format.ts`)                                                                                                            | —                                                                                                                                                           |
| Symbols              | `icons` (`ui.ts`)                                                                                                                         | `separator`, `child`, `ellipsis`, `count` icons (D)                                                                                                         |
| Paging, empty state  | `parsePageArgs`, `pageFooter`, `pageJson` (`pagination.ts`); `emptyState` (`format.ts`)                                                   | `hiddenRows`; footer wording (A)                                                                                                                            |
| Hints                | `formatNextSteps`, `emitNextSteps`, `nextStepsSilenced` (`next-steps.ts`); `hint`, `note` (`feedback.ts`)                                 | `emitHint` (G)                                                                                                                                              |
| `--json`             | `pageJson` (`pagination.ts`)                                                                                                              | `json-output.ts`: `emitJson`, `listEnvelope`, `detailEnvelope`, `withVersion`, `stripInternalFields`, `pickFields` (C)                                      |
| Errors, exit codes   | `errAuth`, `errHttp`, `httpFailed`, `warn` (`errors.ts`); `refLookupError` (`ref-error.ts`); `EXIT_CONFIRMATION_REQUIRED`, `EXIT_BLOCKED` | `error-output.ts` (`normalizeErrorLine`, `notFoundHint`, JSON errors), `describeThrownError`; `exit-codes.ts`; Commander `outputError` + `exitOverride` (E) |
| Help text            | Commander defaults                                                                                                                        | `help.ts`: `examplesHelp`, `exitCodesHelp`; grammar lint test (F)                                                                                           |

---

## 16. Rollout batches

One PR per batch, all on the same task, in this order. Each batch has tests that fail before it and real before/after output from a worktree build of the CLI.

| Order | Batch | Scope                                | Rules                                   | Size (approx.)                    |
| ----- | ----- | ------------------------------------ | --------------------------------------- | --------------------------------- |
| 1     | D     | time and numbers (mostly `lib/`)     | T-1–T-3, N-1–N-4, E-1, E-2, S-1         | ~12 commands                      |
| 2     | G     | remaining internal ids, `--no-hints` | H-1, H-2 (and ref values in 3 commands) | ~5 commands                       |
| 3     | E     | errors and exit codes                | X-1–X-5, J-4                            | 1 Commander hook + ~25 call sites |
| 4     | A     | lists                                | L-1–L-6, PG-1–PG-3                      | ~12 commands                      |
| 5     | B     | detail views                         | D-1–D-5, V-1, V-2                       | ~15 commands                      |
| 6     | F     | help text                            | HT-1–HT-3                               | ~40 commands + 39 ticket refs     |
| 7     | C     | `--json` everywhere, one envelope    | J-1–J-3, J-5                            | ~58 commands                      |

The per-item audit list (location, current output, rule, batch) is attached to the task as an artifact.

---

## 17. Decisions

The review draft listed seven open questions. The user decided all of them on 2026-10-18; the rulings are recorded with `lumo task decide` on LUM-1232. Q2 differs from the draft's recommendation; the others follow it. Q8 was added on the same day, after batch D shipped durations in days.

### Q1. Piped lists are tab-separated

- **Decision (2026-10-18):** in a pipe, list fields are separated by a single TAB, as in `gh` (L-3).
- **Why:** a title with spaces makes space-split parsing ambiguous; a TAB is not. `awk '{print $1}'` and "the first word is the ref" keep working because a TAB is whitespace.
- **Migration:** ships in batch A, announced in the CLI release notes and in the skill's list section; no compatibility switch. `task testcase list` already uses TABs.

### Q2. Absolute time only

- **Decision (2026-10-18; differs from the draft, which recommended relative times in list columns):** the CLI prints absolute times only, never relative ones, because the CLI is read mostly by agents. On a terminal: local time with its UTC offset, `2026-10-17 09:24 +11:00`. In a pipe or `--json`: ISO 8601 in UTC with a trailing `Z` (T-1, T-2).
- **Calendar days** (sprint, milestone and due dates) are unaffected: `YYYY-MM-DD`, never shifted (T-3).
- **Migration:** batch D. `relativeTime()` is retired.

### Q3. `--json` envelope: add in place

- **Decision (2026-10-18):** existing JSON outputs only gain fields (`version`, `total`, `nextCursor`); an optional `--json <fields>` selection may follow in batch C, with bare `--json` unchanged. No `--json-v2` switch.
- **The one breaking change:** `tag list --json` and `task history --json` stop being bare arrays and are wrapped in the envelope (`{ "version": 1, "tags": [...] }`), announced in the release notes and the skill.
- **As built (batch C):** `task template list --json` was a third bare array the audit missed; it is wrapped the same way (`{ "version": 1, "templates": [...] }`) and announced with the other two. The field selection shipped as `--fields <list>` on `task list` (see J-5 for why not `--json <fields>`).

### Q4. Usage errors exit 2

- **Decision (2026-10-18):** usage errors (unknown flag, missing or extra argument, invalid flag value, caught before any network call) exit 2 (X-4). Authentication failures stay at 1; 4 and 5 are unchanged.
- **Why:** an agent can tell "I called it wrong — fix the command" from "the call was right, the thing failed". `gh` uses 2 for "cancelled", which Lumo has no equivalent for.

### Q5. The paging footer ignores `--no-hints`

- **Decision (2026-10-18):** the footer always prints, on stdout, and its second line stops being a hint: `Next page: lumo task list --cursor 50` (PG-1).
- **Why:** it tells the reader the list is incomplete and carries the cursor; hiding it would let an agent believe it saw everything. `--no-hints` keeps hiding only advice.

### Q6. Enums are UPPER_SNAKE

- **Decision (2026-10-18):** enum values print in UPPER_SNAKE_CASE exactly as in `--json` (`ON_TRACK`, `MERGED`); flags keep accepting lower case (E-1).

### Q7. `task runs` and `task lineage` use the detail layout

- **Decision (2026-10-18):** both move from Markdown to the plain detail layout (D-1–D-3). `task context` keeps Markdown, because its output is meant to be pasted into a model's context. **Update (LUM-1233, 2026-10-18):** `task context` was removed; its body is now printed by `task show --full` after the detail view and keeps Markdown under this same ruling ([cli-command-structure.md](cli-command-structure.md) Q5).

### Q8. Durations stay in hours and minutes

- **Decision (2026-10-18, after batch D):** a duration of 48 hours or more prints as hours and minutes — `80h 19m`, `1301h 6m` — never as days (`3d 8h`, `54d 5h`). Below 48 hours the forms are unchanged (`45s`, `12m`, `2h 14m`, `3h`) (N-3).
- **Why:** agents compare and add durations; one unit above a minute keeps that a string-to-number step instead of a calendar conversion.
