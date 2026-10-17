# CLI output conventions

**Status: draft for review.** Nothing here is in effect until the open questions at the end are decided and recorded on the task. Code changes follow in batches A–G (see [Rollout](#rollout-batches)).

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
16. [Rollout batches](#rollout-batches)
17. [Open questions](#open-questions)

---

## 1. Principles

These apply to every rule below; each rule's examples show them at work.

**Three output modes, picked by the environment, never by guessing.**

| Mode     | When                                                | Shape                                                                       |
| -------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| TTY      | stdout is a terminal                                | Aligned columns, header row, colour, truncation to terminal width, wrapping |
| Pipe     | stdout is not a terminal (agents, `\| grep`, files) | No colour, no header row, no truncation, no wrapping, machine-stable fields |
| `--json` | the flag is given                                   | One JSON document on stdout, nothing else                                   |

`gh` uses the same split: tables with headers and relative times on a terminal; tab-separated rows with absolute times in a pipe; `--json` for scripts. Lumo agents read the pipe form, so the pipe form is a contract, not a degraded view.

Helper: `colorEnabled()`, `terminalWidth()` in `ui.ts` (existing); `renderListTable()` in `list-table.ts` (existing).

**Streams.** Data, success lines, hints and the `Next:` block go to **stdout**. Errors and warnings (`Error:`, `⚠`) go to **stderr**. The audit found this already holds everywhere; keep it. The exit-4 confirmation envelope and the exit-5 `DONE_BLOCKED` error stay on stdout (see [§14](#14-formats-agents-depend-on-do-not-break)).

**Presentation only.** These rules change how output looks, never what a command does, which rows it returns, or which exit code a given outcome gets (except usage errors, see [Q4](#q4-should-usage-errors-exit-2)).

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
ID   RESULT  ENV    COMMIT   RUN AT    STEPS   TITLE
TC1  PASS    LOCAL  8841947  1d ago    3/3     show 显示 UNPROVEN 封顶及原因与 required env
TC2  PASS    LOCAL  8841947  1d ago    3/3     show 显示 cause、抽查复核和完整逐步报告

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

In a pipe the table has no header row, no colour and no truncation; one item is one line, and column order never changes. The field separator is decided in [Q1](#q1-should-piped-lists-be-tab-separated) (recommended: a single TAB, as `gh` does).

Helper: `renderListTable()` non-TTY branch (existing; separator change is new in batch A).

Before (`lumo task list | cat`, space-aligned):

```
LUM-1    DONE  MEDIUM  Lumo    Add Keyboard Shortcuts to Description Editor Bubble Menu
LUM-858  DONE  HIGH    Lumo    工作区数据导出(GDPR 可携带权)
```

After (if Q1 is accepted; `⇥` marks a TAB):

```
LUM-1⇥DONE⇥MEDIUM⇥Lumo⇥Add Keyboard Shortcuts to Description Editor Bubble Menu
LUM-858⇥DONE⇥HIGH⇥Lumo⇥工作区数据导出(GDPR 可携带权)
```

### L-4. The first column is the ref

The first column is the item's human-readable ref — the same handle the matching `show` command accepts (`LUM-42`, `LUM-X924`, `TC3`, `#13`, a slug). No rank number, bullet or other prefix goes in front of it; if rank matters, the row order carries it.

Helper: `renderListTable()` (existing); refs from the server (LUM-1230).

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
Chao Li⇥⇥⇥⇥⇥4836645438⇥18⇥109
Chao Li/claude-opus-5-5⇥39254⇥12667583⇥154347275⇥4601079263⇥4768133375
```

(In the pipe form numbers are printed without separators so they can be summed; see N-2.)

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

Exception: `lumo task context` stays Markdown. Its output is written to be pasted into a model's context, and that is documented in the skill.

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

The numbered headings of `task wrapup` (`[1/4] Test cases`) are an allowed variant: the numbers are a step order agents rely on.

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

### T-1. Instants in a pipe: RFC 3339 in UTC

In the pipe form, an instant is printed as RFC 3339 in UTC, to the second: `2026-10-17T01:24:30Z`. No local time without a zone, no milliseconds. In `--json`, the server's ISO string is passed through unchanged.

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

### T-2. Instants on a TTY: decided in Q2

Recommended (see [Q2](#q2-relative-time-or-local-time-with-zone)): relative time in list columns (`3h ago`, `yesterday`, `5 days ago`, then the local date after 30 days), and local time with its UTC offset in detail views: `2026-10-17 09:24 +08:00`.

Helper: `relativeTime()` (existing) and `fmtInstant()` (new).

Before (`lumo crossing list` in a terminal — raw UTC ISO with milliseconds):

```
  Detected:            2026-10-16T17:10:09.714Z
  Occurrences:         ×1 · last seen 2026-10-16T17:10:09.714Z
  Ruled at:            2026-10-16T17:15:41.024Z
```

After (TTY, shell in UTC+8):

```
  Detected:     2026-10-17 01:10 +08:00
  Occurrences:  ×1 · last seen 2026-10-17 01:10 +08:00
  Ruled at:     2026-10-17 01:15 +08:00
```

### T-3. Calendar days: `YYYY-MM-DD`, never shifted

A calendar day prints as `YYYY-MM-DD` in every mode, read from its UTC date and never converted to the local zone. A range is `start → end`. No parentheses, no time, no zone.

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
TC1  PASS    LOCAL  8841947  1d ago  3/3  …
  Trend:  ▁▂▃▃▃▄▄▅▆▆▇██·  2026-10-05 → 2026-10-18
```

(The testcase "run at" value is an instant, so it follows T-1/T-2, not T-3.)

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

### N-3. Durations use s / m / h / d

`45s`, `12m`, `2h 14m`, `3h`; from 48 hours on, days and hours: `54d 5h`. Never fractional hours.

Helper: `formatDuration()` (existing; the day unit is new in batch D).

Before (`lumo project overview`):

```
Avg completion:  1301.1h
```

After:

```
Avg completion:  54d 5h
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

(Words that are not enums — `checked`, `skipped`, `open` in prose — stay lower case.)

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

Before (captured while writing this draft — a flow confirmation and a resource change):

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

The second line is reworded from `Hint: next page with …` so that it is data, not a hint (see [Q5](#q5-should-the-paging-footer-obey---no-hints)). A result that fits on one page prints no footer. When the total is not known, the first line is `Showing 1-50.`.

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

An empty result prints exactly one sentence on stdout and exits 0: `No <things>.` or `No <things> on <scope>.` An optional `Hint:` line may follow (suppressed by `--no-hints`). In `--json`, an empty result is the normal envelope with an empty array.

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

| Kind       | Shape                         | Purpose                                    | `--no-hints` |
| ---------- | ----------------------------- | ------------------------------------------ | ------------ |
| Next steps | `Next:` block (command + why) | commands worth running now                 | hidden       |
| Hint       | `Hint: <text>`                | advice                                     | hidden       |
| Note       | `Note: <text>`                | how far a printed number can be trusted    | shown        |
| Warning    | `⚠ <text>` on stderr          | something is wrong but the command went on | shown        |

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
Not hidden: data, `Note:` lines, warnings, errors and the hint that belongs to an error, the paging footer (pending [Q5](#q5-should-the-paging-footer-obey---no-hints)), and the exit-4 / exit-5 envelopes.

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

Before (`lumo tag list --json` and `lumo task history --json` are bare arrays; `lumo inbox list --json` has no `nextCursor`; only 5 commands carry `version`):

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
      "name": "agent-containment",
      "color": "…",
      "taskCount": 6,
      "documentCount": 0
    }
  ],
  "total": 19,
  "nextCursor": null
}
```

```json
{ "version": 1, "notifications": [ … ], "unreadCount": 0, "total": 50, "nextCursor": "50" }
```

(How the bare arrays get there without breaking callers is [Q3](#q3-how-does-the---json-envelope-migrate).)

### J-3. A declared field list per command

Each command declares the fields it promises (its whitelist) and the skill reference documents them. Field rules:

- camelCase; the human ref is a field (`ref`), next to `id` where an id is useful;
- timestamps are ISO 8601 strings in UTC; calendar days are `YYYY-MM-DD`;
- enums are UPPER_SNAKE_CASE (as E-1);
- an absent value is `null`, not an omitted key;
- no internal-only columns (`deletedByClerkId`, `trashRootId`, `claimSnapshot*`, `order`, `workspaceId`, …).

Fields outside the whitelist that commands emit today are kept (Non-goal: `--json` only adds), marked deprecated in the reference, and only removed through the two-release process in `docs/database-migrations.md`'s spirit: announce, then drop.

Helper: `pickFields(row, FIELDS)` in `json-output.ts` (new, batch C).

Before (`lumo task list --json` — 42 fields per task, including internal ones):

```
agentError, agentStatus, assignee, assigneeActorId, blockedByOpenCount, claimSnapshot, claimSnapshotAt,
claimSnapshotSessionId, claimSnapshotSource, claimable, commentsSummary, commentsSummaryAt, createdAt,
deletedAt, deletedByClerkId, description, dueDate, id, inputReason, milestone, milestoneId, number, order, …
```

After (declared fields; the rest kept but deprecated until removed):

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
    "hint": "lumo task list"
  }
}
```

`code` is one of `USAGE`, `NOT_FOUND`, `AUTH`, `FORBIDDEN`, `CONFLICT`, `SERVER`, `NETWORK`, `UNKNOWN`. The exit-4 confirmation envelope and the exit-5 `DONE_BLOCKED` error keep their current shape and stream (stdout) — they are not errors in this sense.

Helper: `emitJsonError()` in `json-output.ts` (new, batch E); hooked into `wrap()` in `cli/src/index.ts`.

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
    "hint": "lumo task list"
  }
}
```

### J-5. Compatibility

- Only add. Existing fields keep their names, types and meaning.
- A breaking change (renaming, removing, reshaping) bumps `version` and follows [Q3](#q3-how-does-the---json-envelope-migrate).
- Field selection like `gh`'s (`--json ref,title,status`) is optional and additive: bare `--json` keeps printing every field (see Q3).

Helper: `json-output.ts` (new).

Before (`lumo inbox list --json`):

```json
{ "notifications": [ … ], "unreadCount": 0 }
```

After — every existing key keeps its name and meaning; new keys are added beside them:

```json
{ "version": 1, "notifications": [ … ], "unreadCount": 0, "total": 50, "nextCursor": "50" }
```

---

## 12. Errors and exit codes

### X-1. One error prefix

Every error line starts with `Error: ` (capital E), followed by a message that starts lower case and says what failed. Commander's own messages (`error: unknown option …`) are rewritten to the same prefix.

Helper: `errAuth()`, `errHttp()`, `httpFailed()` in `errors.ts` (existing); `usageError()` in `errors.ts` and a `configureOutput({ outputError })` hook in `index.ts` (new, batch E).

Before (`lumo pr scan` with no number, `lumo task testcase show` with two arguments):

```
error: missing required argument 'number'
(run the command with --help to list its valid flags and arguments)
```

After:

```
Error: missing required argument <number>
Usage: lumo pr scan <number> [options]
Hint: see `lumo pr scan --help` for every flag.
```

### X-2. Say what to do next

An error that the user can fix ends with one `Hint:` line naming the fix. A not-found error names a command that lists the valid values.

Helper: `notFound(kind, ref, listCommand)` in `errors.ts` (new, batch E); `refLookupError()` in `ref-error.ts` (existing).

Before (`lumo task show LUM-999999`):

```
Error: task LUM-999999 not found in workspace lumo
```

After:

```
Error: task LUM-999999 not found in workspace lumo
Hint: list tasks with `lumo task list`, or search with `lumo task search <text>`.
```

`lumo milestone show nope` already does this (`Try \`lumo milestone list\``); it moves to the `Hint:` line.

### X-3. Never pass tool output through as the whole message

Errors from git, the network or the server are wrapped in a sentence that says what Lumo was doing; the raw text, if useful, follows after a colon.

Helper: `errors.ts` (existing pattern of `httpFailed`); `gitFailed(action, detail)` in `errors.ts` (new, batch E).

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

| Code | Meaning                                                                                                         | Stream of the message |
| ---- | --------------------------------------------------------------------------------------------------------------- | --------------------- |
| 0    | success, including an empty result                                                                              | —                     |
| 1    | the command failed: not found, auth, permission, server, network                                                | stderr                |
| 2    | usage error: unknown flag, missing or extra argument, invalid flag value ([Q4](#q4-should-usage-errors-exit-2)) | stderr                |
| 3    | reserved                                                                                                        | —                     |
| 4    | confirmation required: an exit-4 envelope was printed; unchanged                                                | stdout                |
| 5    | blocked by a human-only gate (`DONE_BLOCKED`); unchanged                                                        | stdout                |

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
2
```

### X-5. Warnings

A warning is one line on stderr starting with `⚠` (`warn()`); the command continues and exits by its own outcome.

Helper: `warn()` in `errors.ts` (existing).

Before (`lumo doctor` — the warning is on stdout with an ASCII marker):

```
Warnings
  ! codex-untrusted: Codex hooks trust unverified (…/.codex/hooks.json) — open /hooks in Codex and Trust …
```

After (the `Warnings` section stays in the report; each line uses `⚠`, see S-1):

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
- `lumo task wrapup`: the `[n/4]` section headings;
- the first line of `task create`, `task update`, `doc create`;
- the auth error strings in `errors.ts` (`API key invalid or revoked. Run \`lumo auth login\`.`);
- the `Showing a-b of n.` paging line (its second line changes wording, PG-1);
- the `Next:` block shape (`command` line, indented `why` line);
- the `<untrusted-…>` wrappers;
- `lumo task context` (Markdown, written for model context).

Every batch that changes text output updates `.claude/skills/lumo/SKILL.md` and the affected `references/*.md` in the same PR, regenerates `grammar.json` when flags change, and keeps the doc-examples test green.

---

## 15. Helper map

| Rule area            | Existing helper (file)                                                                                                                    | New in batch                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Modes, colour, width | `colorEnabled`, `terminalWidth`, `style` (`ui.ts`)                                                                                        | `enumColor` (D)                                                                                       |
| Lists                | `renderListTable`, `flexColumnCap` (`list-table.ts`); `renderTable` (`ui.ts`)                                                             | TAB separator for pipes, `childRows` (A)                                                              |
| Details              | `kvBlock` (`ui.ts`); `sectionHeading`, `wrapLines`, `fieldLines` (`report-layout.ts`); `taskTableSection` (`detail-layout.ts`)            | `detailHeader`; no wrap when not a TTY (B)                                                            |
| Time                 | `fmtCalendarDay`, `fmtDay`, `fmtTimestamp`, `relativeTime` (`format.ts`)                                                                  | `fmtInstant`, `fmtDayRange` (D)                                                                       |
| Numbers              | `fmtTokens`, `fmtCount`, `formatDuration` (`format.ts`)                                                                                   | days in `formatDuration`, `fmtPercent`, `{ tty }` on `fmtCount` (D)                                   |
| Enums                | `milestone-labels.ts`                                                                                                                     | `fmtEnum` (D)                                                                                         |
| Empty values         | `NONE`, `orNone` (`format.ts`)                                                                                                            | —                                                                                                     |
| Symbols              | `icons` (`ui.ts`)                                                                                                                         | `separator`, `child`, `ellipsis`, `count` icons (D)                                                   |
| Paging, empty state  | `parsePageArgs`, `pageFooter`, `pageJson` (`pagination.ts`); `emptyState` (`format.ts`)                                                   | `hiddenRows`; footer wording (A)                                                                      |
| Hints                | `formatNextSteps`, `emitNextSteps`, `nextStepsSilenced` (`next-steps.ts`); `hint`, `note` (`feedback.ts`)                                 | `emitHint` (G)                                                                                        |
| `--json`             | `pageJson` (`pagination.ts`)                                                                                                              | `json-output.ts`: `emitJson`, `listEnvelope`, `detailEnvelope`, `pickFields` (C); `emitJsonError` (E) |
| Errors, exit codes   | `errAuth`, `errHttp`, `httpFailed`, `warn` (`errors.ts`); `refLookupError` (`ref-error.ts`); `EXIT_CONFIRMATION_REQUIRED`, `EXIT_BLOCKED` | `usageError`, `notFound`, `gitFailed`; `exit-codes.ts`; Commander `outputError` hook (E)              |
| Help text            | Commander defaults                                                                                                                        | `help.ts`: `examplesHelp`, `exitCodesHelp`; grammar lint test (F)                                     |

---

## Rollout batches

One PR per batch, all on the same task, in this order. Each batch has tests that fail before it and real before/after output from a worktree build of the CLI.

| Order | Batch | Scope                                | Rules                           | Size (approx.)                    |
| ----- | ----- | ------------------------------------ | ------------------------------- | --------------------------------- |
| 1     | D     | time and numbers (mostly `lib/`)     | T-1–T-3, N-1–N-4, E-1, E-2, S-1 | ~12 commands                      |
| 2     | G     | remaining internal ids, `--no-hints` | H-1, H-2, L-4 (refs)            | ~5 commands                       |
| 3     | E     | errors and exit codes                | X-1–X-5, J-4                    | 1 Commander hook + ~25 call sites |
| 4     | A     | lists                                | L-1–L-6, PG-1–PG-3              | ~12 commands                      |
| 5     | B     | detail views                         | D-1–D-5, V-1, V-2               | ~15 commands                      |
| 6     | F     | help text                            | HT-1–HT-3                       | ~40 commands + 39 ticket refs     |
| 7     | C     | `--json` everywhere, one envelope    | J-1–J-3, J-5                    | ~58 commands                      |

The per-item audit list (location, current output, rule, batch) is attached to the task as an artifact.

---

## Open questions

Each needs a decision from the user before the matching batch starts. The recommendation is what this draft assumes.

### Q1. Should piped lists be tab-separated?

- **Today:** pipes get space-aligned columns; `task testcase list` already uses tabs in every mode.
- **Options:** (a) keep space alignment; (b) single TAB between fields, like `gh`.
- **Recommendation: (b) TAB.** A title with spaces makes space-split parsing ambiguous; a TAB is not. `awk '{print $1}'` and "first word is the ref" keep working because a TAB is whitespace. Callers that cut by fixed character positions break; none were found in the skill or our scripts. Migration: ship in batch A, call it out in the CLI release notes and in the skill's list section, no compatibility switch.

### Q2. Relative time, or local time with zone?

- **Today:** a mix of raw UTC ISO (`crossing list`), local time without a zone (`history`, `audit list`, `inbox`), and bare dates.
- **Options:** (a) relative everywhere on a TTY (`gh`'s choice); (b) local time with offset everywhere; (c) relative in list columns, local time with offset in detail views.
- **Recommendation: (c),** with RFC 3339 UTC in every pipe and in `--json` (T-1). A list is scanned for "how recent"; a detail view is read for "exactly when", and an offset (`+08:00`) makes it unambiguous for teammates in other zones. Agents read the pipe form, so they always get the unambiguous UTC value.

### Q3. How does the `--json` envelope migrate?

- **Today:** 24 different shapes; 2 bare arrays (`tag list`, `task history`); 5 with `version`.
- **Options:** (a) add fields in place (`version`, `total`, `nextCursor`) with a compatibility layer; (b) a switch such as `--json-v2` or `LUMO_JSON_VERSION=2`; (c) `gh`-style field selection, where `--json` alone keeps the old shape.
- **Recommendation: (a) in place, plus optional field selection from (c).** Object outputs only gain fields, so nothing that reads them breaks, and no permanent second code path is needed. The two bare arrays are the only breaking change: wrap them into the envelope once (`{ "version": 1, "tags": [...] }`), announced in the release notes and the skill. `--json <fields>` (optional value, so bare `--json` is unchanged) can come later in batch C for callers that want a smaller payload. A `--json-v2` switch is not recommended: it doubles the code and the docs for every command, for the sake of two commands.

### Q4. Should usage errors exit 2?

- **Today:** usage errors, not-found and server errors all exit 1; `index.ts` reserves 2 for auth.
- **Recommendation: yes, 2 for usage errors** (unknown flag, missing or extra argument, invalid flag value, caught before any network call). It lets an agent tell "I called it wrong — fix the command" from "the call was right, the thing failed". This follows the long-standing Unix convention for bad usage; `gh` uses 2 for "cancelled", which Lumo has no equivalent for. Auth stays 1. Codes 4 and 5 are unchanged.

### Q5. Should the paging footer obey `--no-hints`?

- **Today:** the footer's second line is a `Hint:` line and `--no-hints` does not hide it.
- **Recommendation: no — the footer always prints, and its second line stops being a hint** (`Next page: lumo task list --cursor 50`). It tells the reader the list is incomplete and carries the cursor; hiding it would let an agent believe it saw everything, which is exactly what the footer exists to prevent. `--no-hints` keeps hiding only advice.

### Q6. Enum casing in human output

- **Today:** `DONE`, `merged`, `ON-TRACK` side by side.
- **Recommendation: UPPER_SNAKE exactly as in `--json`** (E-1). One spelling to grep for across text and JSON, and it matches the web app. Flags keep accepting lower case.

### Q7. Markdown output of `task runs` and `task lineage`

- **Today:** both print Markdown (`#`, `**`, `-`), unlike every other detail view.
- **Recommendation: move both to the plain detail layout** (D-1–D-3). Keep Markdown only for `task context`, whose output is meant to be pasted into a model's context.
