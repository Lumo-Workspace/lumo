# CLI command structure conventions

**Status: agreed (2026-10-18).** The open questions of the review draft were decided by the user on 2026-10-18 and recorded on LUM-1233 with `lumo task decide`; the outcomes are in [Decisions](#14-decisions). Q3 differs from the draft's recommendation; the others follow it. Code changes follow in batches 1, 3 and 4 (see [Rollout batches](#13-rollout-batches)). Until a batch lands, the "current" column of the [mapping](#12-mapping-current--target) is what the CLI accepts.

This document is the one rulebook for **which commands exist and what they are called**: command shape, verbs, read/write separation, flags versus subcommands, the bound task, global flags, confirmation, and how a command is renamed or removed. It is the sister of [`cli-output-conventions.md`](cli-output-conventions.md), which governs **what a command prints**. Where the two meet (help text, `--json`, exit codes), the output conventions win and this document only refers to them.

The model is the GitHub CLI (`gh`), with ideas from `kubectl`, `vercel`, `stripe` and [clig.dev](https://clig.dev). Lumo's main reader is an agent, so the rules favour names an agent can guess right on the first try and commands that answer a question in one call.

Each rule has an id (`CS-1`, `VB-2`, …) so PRs and the skill can cite it. Each rule says where it is enforced; "new" means a batch has to add the check.

## Contents

1. [Why, and the numbers behind it](#1-why-and-the-numbers-behind-it)
2. [Command shape](#2-command-shape)
3. [Verbs](#3-verbs)
4. [Reads and writes](#4-reads-and-writes)
5. [Aspects are flags, not subcommands](#5-aspects-are-flags-not-subcommands)
6. [Arguments and the bound task](#6-arguments-and-the-bound-task)
7. [Global flags and short flags](#7-global-flags-and-short-flags)
8. [Confirmation and `--force`](#8-confirmation-and---force)
9. [Renaming and removing commands](#9-renaming-and-removing-commands)
10. [Codex sandbox rules come from the grammar](#10-codex-sandbox-rules-come-from-the-grammar)
11. [Frozen commands (do not change)](#11-frozen-commands-do-not-change)
12. [Mapping: current → target](#12-mapping-current--target)
13. [Rollout batches](#13-rollout-batches)
14. [Decisions](#14-decisions)

---

## 1. Why, and the numbers behind it

Measured on 2026-10-18 against `scripts/cli-grammar/grammar.json` (CLI 1.125.4):

| Measure                                                        | Value                                      |
| -------------------------------------------------------------- | ------------------------------------------ |
| Top-level commands                                             | 32                                         |
| Leaf commands                                                  | 177 (28 of them `hook *`)                  |
| Leaves three words deep (`task testcase run`)                  | 46                                         |
| A group that is itself a command                               | 1 (`priority [text]`)                      |
| Hand-kept Codex sandbox entries (`cli/src/lib/codex-rules.ts`) | ~134, checked against every leaf by a test |

Usage comes from the transcripts of one development machine: 1,039 Claude Code and Codex sessions in the last 30 days, about 11,900 `lumo` calls. **It shows how we use the CLI while building Lumo; it is not evidence about customers** and is only used to rank risk (a rename of a command we call 1,800 times needs more care than one we never call).

| Signal                                   | Commands (calls)                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Most called                              | `task testcase run` 1815 · `task testcase add` 1474 · `task status` 753 · `task update` 739 · `crossing disposition` 646 · `task testcase list` 640 |
| Four ways to read one task (since 10-04) | `task status` 413 · `task show` 258 · `task context` 237 · `task wrapup` 118                                                                        |
| Almost unused in 30 days                 | `next`, `priority`, `outcome show`, `inbox list`, `draft list`, `sprint *`, most of `doc *`, `task slack/web/figma *`                               |
| Names agents guessed that do not exist   | `crossing show` 43 · top-level `testcase …` 19+ · `pr show` 7 · `workspace overview` 6 · top-level `comment(s) list` 7                              |
| Help lookups                             | `lumo crossing --help` 116                                                                                                                          |

What the numbers say:

- **Too many ways to read a task.** Four commands overlap, and each answers part of the same question.
- **The same thing lives in two places.** Test cases exist as `task testcase *` and `milestone testcase *` (16 leaves for one concept); memory as `task memory *`, `project memory *` and `memory *`.
- **Wrong guesses follow a pattern.** Agents reach for a top-level noun (`testcase`), the `show` verb (`crossing show`, `pr show`) and a `comment list` that does not exist. The tree breaks those patterns in places.
- **Synonyms.** `rm` and `delete`, `edit` and `update`, `comments` and `comment`, `--yes` and `--confirm` all exist side by side.

**Ruling that shapes the whole document (user, 2026-10-18):** no command or flag gets an alias — not an old name, not a name agents often guess. A superseded command is deleted. Correct use comes from clear names, help text and `SKILL.md`. See [§9](#9-renaming-and-removing-commands).

---

## 2. Command shape

### CS-1. `lumo <noun> <verb>`

Every command is a noun followed by a verb: `lumo task show`, `lumo doc update`, `lumo task testcase run`.

- **Nouns are singular**: `task`, `comment`, `dep`, `testcase` — never `comments`, `deps`, `learnings`.
- **At most two noun levels**: `lumo task artifact add` is the deepest shape. A third noun level becomes a flag or its own top-level noun.
- **One word or kebab-case** for each segment: `security-scan`, `rebuild-source`. No camelCase, no underscores.

`gh` follows the same shape (`gh pr view`, `gh repo clone`, `gh run list`) with one noun level. Lumo allows two because tasks own many things (artifacts, Figma links, comments).

Enforced: new test over `grammar.json` (batch 3).

### CS-2. A noun is never itself a command

`lumo priority "text"` (a group that also writes) is the only case today. A noun prints its help and exits 0 when called alone. Every action is a verb under it.

Enforced: the grammar test above (`isInvokable && hasSubcommands` must be false).

### CS-3. Tool-level commands are the only verbs without a noun

Commands about the CLI itself, or about "me" across everything, have no noun:

| Command      | Job                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| `init`       | install the hooks, Codex rule and skill stub into this repo (frozen; project only, no `--scope`, no `--force`) |
| `uninstall`  | remove what `init` installed from this repo (no `--scope`, no `--force`)                                       |
| `skill read` | print the Lumo skill (SKILL.md or a `references/` file) from the installed CLI package                         |
| `update`     | update the CLI                                                                                                 |
| `doctor`     | diagnose the local install (frozen)                                                                            |
| `whoami`     | the logged-in identity                                                                                         |
| `status`     | my inbox, drafts and next tasks ([Q1](#q1-name-of-the-summary-that-replaces-inbox-draft-and-next))             |

The list is closed: a new tool-level command needs a change to this table. `setup` (an alias of `init`) is removed under [RN-1](#rn-1-no-aliases).

---

## 3. Verbs

### VB-1. The core verbs

| Verb     | Meaning                                                                               | Reads or writes |
| -------- | ------------------------------------------------------------------------------------- | --------------- |
| `list`   | many objects of the noun, filtered and paged                                          | read            |
| `show`   | one object by its ref, with aspect flags ([§5](#5-aspects-are-flags-not-subcommands)) | read            |
| `create` | make a new object that did not exist                                                  | write           |
| `update` | change fields of an existing object                                                   | write           |
| `delete` | destroy an object                                                                     | write           |
| `add`    | attach an existing thing to a container, or append an entry                           | write           |
| `remove` | detach a thing from a container; the thing itself survives                            | write           |
| `run`    | execute or record an execution (`task testcase run`)                                  | write           |

`delete` versus `remove` is the one distinction to get right: `milestone remove <m> LUM-4` takes the task out of the milestone and the task survives; `task testcase delete LUM-4/TC2` destroys the test case. When the object is owned by its parent and has no life outside it (a test case, an artifact, a comment), the verb is `delete`. When it is a link between two things that both survive (a dependency edge, a Figma link, a task in a sprint), the verb is `remove`.

### VB-2. Banned synonyms

These words never appear as a verb. The right word is in the second column.

| Banned                               | Use                              |
| ------------------------------------ | -------------------------------- |
| `rm`, `del`, `destroy`               | `delete` (or `remove`, per VB-1) |
| `edit`, `set`, `modify`              | `update`                         |
| `view`, `get`, `describe`, `context` | `show`                           |
| `ls`                                 | `list`                           |
| `new`                                | `create`                         |

`gh` uses `view`; Lumo uses `show` and does not accept `view`. The one exception is `worktree rm`, which is frozen ([§11](#11-frozen-commands-do-not-change)).

### VB-3. Domain verbs

Some actions are not any of the eight. They are allowed when they name a real domain action that none of the core verbs describes, and they are listed here; a new one needs a change to this table.

| Verb                                                                  | Where                                                        | Why not a core verb                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `status`                                                              | `task`, `session`                                            | a computed state check, not a stored object (`task status`, `session status` are frozen) |
| `attach`                                                              | `session`                                                    | frozen                                                                                   |
| `decide`                                                              | `task`                                                       | records a ruling in the task's Decisions                                                 |
| `disposition`                                                         | `crossing`, `finding`, `task testcase`, `milestone testcase` | the human-only ruling handshake                                                          |
| `explain`                                                             | `crossing`                                                   | the agent's account of a crossing                                                        |
| `confirm`, `dismiss`                                                  | `task dep`                                                   | rule on a detected candidate edge                                                        |
| `download`                                                            | `task testcase`, `milestone testcase`                        | writes evidence files to a local directory                                               |
| `review`                                                              | `pr`                                                         | request or control an AI review (new, batch 3)                                           |
| `diff`, `patch`, `append`, `move`, `sync`, `import`, `rebuild-source` | `doc`                                                        | live-doc editing and import                                                              |
| `archive`, `unarchive`, `move`, `reorder`, `triage`                   | `milestone`                                                  | ordering and lifecycle                                                                   |
| `start`, `close`                                                      | `sprint`                                                     | lifecycle                                                                                |
| `sync`, `push`, `fold`                                                | `memory`                                                     | local memory store                                                                       |
| `refresh`                                                             | `task figma`                                                 | re-fetch from Figma                                                                      |
| `resync`                                                              | `usage`                                                      | correct historical usage                                                                 |
| `prune`                                                               | `worktree`                                                   | clean up                                                                                 |
| `scan`                                                                | `security`                                                   | run Lumo's scanners on local changes before a push; reads, but starts work, not a `show` |
| `login`, `logout`                                                     | `auth`                                                       | authentication                                                                           |
| hook event names                                                      | `hook`                                                       | frozen; named after the agent's hook events                                              |

A domain verb must not mean the same as a core verb (`context` meant `show`; it goes).

---

## 4. Reads and writes

### RW-1. A read command has no flag with a side effect

`list` and `show` (and `status`, `diff`) never change state. A flag that writes belongs on a write command. Today three commands break this:

| Command                               | Side-effect flag                             | Target                                                             |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `pr scan`                             | `--review`, `--pause`, `--resume`, `--limit` | `pr review` ([mapping 3d](#3d-pr-show-reads-and-pr-review-writes)) |
| `milestone summary`, `sprint summary` | `--retry` (queues a regeneration)            | `milestone update` / `sprint update --refresh-summary`             |
| `workspace security-scan`             | every setting flag (no flag = read)          | `workspace security-scan show` / `update`                          |

Enforced: new grammar test — leaves whose verb is `list`, `show` or `status` may not declare a flag from a deny list (batch 3).

### RW-2. A write runs when called; `--dry-run` previews

A write command does its job when called. If it can preview, the preview is `--dry-run` (as `init`, `memory sync`, `memory push` already do). A write that needs the user's approval uses `--confirm` and exit 4 ([CF-1](#cf-1-confirmation-is---confirm-plus-exit-4-only)), never a default-off "apply" switch. `usage resync --apply` was the one switch of that kind; it goes ([Q7](#q7-shape-of-usage-and-the---apply-switch-on-usage-resync)).

### RW-3. A write ends with its result, not a second read

Unchanged from today: writes print what changed, and the writes that already end with the `task status` digest keep it (frozen, [§11](#11-frozen-commands-do-not-change)). An agent should never need a follow-up read to learn what its write did.

---

## 5. Aspects are flags, not subcommands

### AF-1. One `show` per object; aspects are flags on it

Everything an agent reads to understand one object comes from that object's `show`, with a flag per aspect. Aspects do not get their own subcommand.

For a task (`--full`, `--comments`, `--history`, `--scans`, `--runs` and `--outcome` were ruled by the user on 2026-10-18; `--lineage`, `--deps` and `--memory` were proposed by the draft and accepted the same day):

```
lumo task show [<task>]                 # the task: title, status, fields, description
lumo task show [<task>] --full          # + everything `task context` printed (prior sessions, memory index, sources, test cases)
lumo task show [<task>] --comments      # + the comment thread         (was: task comments list)
lumo task show [<task>] --history       # + field-change history       (was: task history)
lumo task show [<task>] --scans         # + security scans of its PRs  (was: task scans)
lumo task show [<task>] --runs          # + agent runs                 (was: task runs)
lumo task show [<task>] --outcome       # + the post-hoc outcome well  (was: outcome show)
lumo task show [<task>] --lineage       # + the causal trail           (was: task lineage)
lumo task show [<task>] --deps          # + dependency edges           (was: task deps list)
lumo task show [<task>] --memory        # + full memory bodies         (was: task context --full)
lumo task status [<task>]               # state and next actions; READY adds the DONE-readiness section (was: task wrapup)
```

The same rule applies to milestones (`--summary`, `--changelog`), sprints (`--summary`), docs (`--members`) and memory (`--learnings`); see the [mapping](#12-mapping-current--target). `task show --full` prints the detail view and then the old `task context` body unchanged as Markdown ([Q5](#q5-what-task-show---full-prints)).

A sub-object that has its own ref and its own lifecycle (a test case, an artifact, a Figma link) keeps its own noun with `list` and `show`. The test is: "would an agent read this to understand the parent?" — then it is an aspect.

### AF-2. Aspect flags combine

`task show LUM-4 --comments --history` prints the task, then both sections, in the order of the table above. Under `--json`, each aspect is a key of the one envelope (`{ version, task, comments, history }`, J-2 of the output conventions).

### AF-3. `--full` and `--all` mean the same everywhere

- `--full` = the long form of what is shown. On `task show` alone it adds the old `task context` content; with an aspect flag it is that aspect's long form (`--runs --full` = attribution signals and per-model tokens, `--scans --full` = hunt detail, `--comments --full` = every comment).
- `--all` = include rows a default filter hides (resolved crossings, every pushed head's scan, archived milestones).
- Paging flags of an aspect (`--limit`, `--cursor`) apply to the one aspect selected; with two paged aspects they are a usage error (exit 2).

---

## 6. Arguments and the bound task

### AR-1. The primary object is positional; context objects are flags

The thing the command acts on is the positional argument. Things that only locate it are flags: `--task`, `--milestone`, `--repo`, and the global `--project` ([GF-1](#gf-1-two-global-flags-and-one-standard-flag)).

```
lumo task testcase run LUM-4/TC2 …     # the case is positional
lumo crossing disposition 3f2a… --task LUM-4   # the crossing is positional; the task only locates it
```

### AR-2. A task ref may be left out; the session-bound task fills it

When the task is the primary object or the context of a command, it may be omitted; the task bound by `lumo session attach` is used. Resolution order:

1. the positional task ref, if given;
2. `--task <ref>`, if the command has it;
3. the session-bound task;
4. otherwise exit 2, `Error: no task given and this session is not attached` with `Hint: pass a task ref, or run lumo session attach <task>`.

The output's first line names the resolved ref (D-1 of the output conventions), so an implicit target is always visible.

**An optional positional never comes before a required one.** The task may be an optional positional only when it is the command's only positional, or the last one (`task show [<task>]`, `task dep add [<task>] --blocked-by …`, `task testcase list [<task>]`). When the command has another required positional, the task becomes the `--task <ref>` flag instead, so the parser never has to guess which word is the task:

```
lumo task comment add "Looks good" [--task LUM-4]     # body is the only positional
lumo task comment update <comment> <body> [--task LUM-4]
```

Today 6 commands accept this (`task status`, `task runs`, `task wrapup`, `task memory add/list`, `crossing list`). Batches 1 and 3 extend it to every command whose primary or context object is a task (`task show`, `task update`, `task comment add`, `task testcase list/add`, …).

Enforced: grammar — every `task` positional is `required: false` unless listed in AR-3, and no optional positional precedes a required one (batch 3).

### AR-3. What is deleted is always named

A `delete` or `remove` never takes its target from the binding: `task delete` requires the task ref, `task testcase delete` the full case handle (`LUM-4/TC2`).

---

## 7. Global flags and short flags

### GF-1. Two global flags and one standard flag

| Flag              | Kind     | Meaning                                                                                                      | Status                                                     |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `--no-hints`      | global   | hide advice (`Next:`, `Hint:`); same as `LUMO_NO_HINTS=1` (output conventions §10)                           | global today                                               |
| `--project <ref>` | global   | the project to resolve names in (milestones, docs, memory, task lists); defaults to the bound task's project | batch 3: replaces ~30 per-command `--project` flags        |
| `--json`          | standard | one JSON document on stdout (output conventions §11)                                                         | on every read since LUM-1232 batch C; see below for writes |

- **Global** means defined once on the program: every command accepts it and it means the same everywhere. A command that has no use for it (`--project` on `whoami`) accepts and ignores it.
- **Standard** means defined per command, with the same name and meaning wherever it exists. `--json` exists on every read command. A write command gains `--json` when a batch touches it; until then `--json` on that write is an unknown option and fails like any other usage error (exit 2) — it is never silently ignored.

`--project` is a project name everywhere; `init` and `uninstall` no longer take a scope or project flag (they install into the current repo only), so the old boolean ([Q6](#q6-the-boolean---project-on-init-and-skill-update)) is gone.

**Flag order (LUM-1292).** For commands that are not server-only (they write local files, read local files or are human-only rulings: `init`, `update`, `auth`, `worktree`, `memory sync/push`, `session attach`, `task update`, `doc create/update/patch --file`, …), global flags go **after** the command words: `lumo memory sync --project x`, not `lumo --project x memory sync`. Codex's rules only recognise those commands when the command words come first, so the CLI refuses the other order with exit 2 and a hint showing the reordered command. Server-only commands accept either order.

`--help` and `--version` stay as they are.

### GF-2. A short flag has one meaning

| Short | Long          | Note                                                                          |
| ----- | ------------- | ----------------------------------------------------------------------------- |
| `-n`  | `--limit`     | `next --count -n` becomes `--limit -n` under `status`                         |
| `-s`  | `--status`    |                                                                               |
| `-m`  | `--milestone` |                                                                               |
| `-a`  | `--assignee`  |                                                                               |
| `-p`  | `--priority`  | `task list -p` (project) is removed; the global `--project` has no short form |

---

## 8. Confirmation and `--force`

### CF-1. Confirmation is `--confirm` plus exit 4, only

A gated write without `--confirm` prints the `confirmation_required` envelope on stdout and exits 4; the user approves; the agent runs the envelope's `confirmCommand` verbatim. That protocol is frozen ([§11](#11-frozen-commands-do-not-change)).

- **`--yes` is removed** from the 11 commands that still accept it as an alias of `--confirm` ([mapping 3i](#3i---yes-removed)), including the frozen `worktree rm` (see [§11](#11-frozen-commands-do-not-change) for why that is not a conflict).
- No interactive y/N prompt anywhere; `priority` without text went with [Q2](#q2-where-priority-lives), and `init` never asks inside a git repo: it installs into that repo (`--scope` was removed in LUM-1292; earlier it defaulted to `--scope project`, user ruling 2026-10-19). One exception to this no-prompt decision, by user ruling 2026-10-21 (LUM-1292 Task 11): `lumo init` outside a git repo is a folder install and asks `[y/N]` (stdin; EOF or a 60 s timeout = no) because that path is run by a human and the files cannot be shared via git; agents must relay the question to the user, not answer it. `$HOME` and `/` are refused; doctor/uninstall work in a folder install (uninstall keeps `--confirm`).
- The three disposition handshakes (`--confirm-read`, `--receipt`, `--confirm`) on `crossing disposition`, `finding disposition` and test-case `disposition` keep their flags exactly.

### CF-2. `--force` has one meaning: discard local edits on this machine

`--force` means "go ahead even though it throws away local changes": uncommitted work in a worktree. It never means "approve" (that is `--confirm`) and never touches server data.

| Command              | `--force` today                                                               | Target                                                                        |
| -------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `worktree rm`        | remove with uncommitted changes                                               | unchanged                                                                     |
| `init`, `uninstall`  | (LUM-1292) no `--force`: nothing Lumo installs is a user-edited copy any more | **removed**                                                                   |
| `doc rebuild-source` | replace the existing server-side source                                       | **removed**: the exit-4 envelope already gates it, `--confirm` alone approves |
| `setup`              | as `init`                                                                     | command removed                                                               |

---

## 9. Renaming and removing commands

### RN-1. No aliases

A renamed or merged command has exactly one name: the new one. The old name is deleted in the same PR — no alias, no hidden command, no deprecation period. This also applies to names agents often guess (`crossing show`, `pr view`, `task comment list`): none is added. Agents learn the right name from help text and `SKILL.md`.

### RN-2. What a removal must ship with

Every PR that removes or renames a command or flag also:

1. **Release notes** — one line per removed name under "Removed", in this form:
   `` `lumo task context` → use `lumo task show --full` ``
   The [mapping](#12-mapping-current--target) has the exact line for every command. (The release itself happens once per milestone, not per PR.)
2. **`SKILL.md` and `references/`** — every example uses the new name; the old name is added to "Commands & flags that do NOT exist" with its replacement, which is how an agent with a fresh skill avoids the old name.
3. **Grammar** — `npx tsx scripts/cli-grammar/emit-grammar.ts`; the doc-examples test then rejects any stale example.
4. **Codex rules** — regenerated from the grammar ([§10](#10-codex-sandbox-rules-come-from-the-grammar)).
5. **Server-written command text** — `Next:` blocks (`lib/context/render/next-steps.ts`), test-case reminders (`lib/context/render/test-case-reminder.ts`), overflow lines (`lib/services/task-context.service.ts`), confirmation envelopes' `confirmCommand`, and hook-injected context. The server knows the caller's CLI version (`X-Lumo-Cli-Version`, `lib/api/cli-version-gate.ts`; stored per session since LUM-1136, `lib/session/client-versions.ts`) and **must keep emitting the old name to a CLI older than the release that removed it**. A request without the header is treated as old.
6. **Web copy** — any web string that quotes a CLI command is updated in every locale file.

### RN-3. Running a removed name

A removed name never runs. It fails with exit 2 and a pointer to its replacement ([Q4](#q4-what-a-removed-command-prints)):

```
Error: lumo task context was removed. Use: lumo task show --full
```

Under `--json` the error object has `"code": "COMMAND_REMOVED"`. The pointers live in one tombstone table in the CLI; tombstones are hidden from `--help` and from `grammar.json`, the same table feeds the release notes and the skill's "do not exist" list, and an entry is dropped two minor releases after the removal. This is not an alias: nothing the old name did is reachable through it.

---

## 10. Codex sandbox rules come from the grammar

### CX-1. One classification per leaf, declared where the command is defined

Today `cli/src/lib/codex-rules.ts` keeps three hand-written lists (server-only, reads a local file, sandboxed with a reason), and `__tests__/cli/codex-sandbox-network.test.ts` fails when a leaf is in none of them. Every rename in batches 1 and 3 would touch that file by hand.

Target (batch 4):

- each command declares its sandbox class where it is defined: `server-only`, `reads-local-file:<flag>` or `sandboxed:<reason>`;
- `emit-grammar.ts` writes the class into `grammar.json`, and refuses to emit when a leaf has none;
- `codex-rules.ts` builds the `prefix_rule` list from the grammar instead of from its own lists; the test checks the generated rules against the grammar, and the generated `.rules` file is byte-identical to today's for unchanged commands.

The safety rule does not change: a command that can read an arbitrary local file and send it to the API never runs unsandboxed.

---

## 11. Frozen commands (do not change)

These are relied on by hooks, installed settings, server-written envelopes or the gates. **The freeze covers the command name, its behaviour and the flags listed here** (including `--confirm` and `--force` where the command has them): no batch renames, removes or changes their meaning. It does not protect a compatibility alias: `--yes`, an alias of `--confirm`, is removed from every command by CF-1, frozen ones included (`worktree rm --yes` → `worktree rm --confirm`). Envelopes already print `--confirm`, so nothing that reads them changes.

| What                                                                                             | Why                                                                        |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `session attach`, `session status`                                                               | session binding; SessionStart text and every agent's first command         |
| `task status`                                                                                    | several writes end with its digest; batch 1 only adds the READY section    |
| `task update --status`                                                                           | the DONE path and its exit-4 / exit-5 protocol                             |
| `hook *` (all 28)                                                                                | `init` writes these names into Claude Code settings and Codex `hooks.json` |
| the handshake flags of `crossing disposition`, `finding disposition` and test-case `disposition` | human-only ruling protocol                                                 |
| `--confirm` + exit 4                                                                             | the confirmation protocol (CF-1)                                           |
| `worktree add`, `worktree rm`                                                                    | worktree tooling and envelopes (exempt from VB-2)                          |
| `init`, `doctor`                                                                                 | install and diagnosis                                                      |

Test-case `disposition` keeps its handshake flags; batch 3a only changes the milestone form's case argument (`<m> <n>` → `<m>/TC<n>`), and the server-written `confirmCommand` follows RN-2 step 5.

---

## 12. Mapping: current → target

One row per command. **Batch** is the PR that changes it. **Release note** is the line that goes under "Removed" (or "Changed") when the batch ships; `—` means nothing user-visible changes. Command names are without the `lumo` prefix.

### Batch 1 — one way to read a task

Ruled by the user on 2026-10-18 (`--lineage`, `--deps` and `--memory` accepted the same day). Removed names print the Q4 pointer.

| Current                      | Target                                                                         | Release note                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task context <task>`        | `task show [<task>] --full` ([Q5](#q5-what-task-show---full-prints))           | `task context` removed → use `task show --full`                                                                                                                         |
| `task context <task> --full` | `task show [<task>] --full --memory`                                           | `task context --full` removed → use `task show --full --memory`                                                                                                         |
| `task wrapup [<task>]`       | `task status [<task>]` (READY adds the readiness section and the next command) | `task wrapup` removed → use `task status`                                                                                                                               |
| `task show <task>`           | `task show [<task>]` + aspect flags                                            | Changed: `task show` takes `--full`, `--comments`, `--history`, `--scans`, `--runs`, `--outcome`, `--lineage`, `--deps`, `--memory`; the task defaults to the bound one |
| `task status [<task>]`       | unchanged name; READY output adds the readiness section                        | Changed: `task status` shows DONE readiness and the next command when READY                                                                                             |
| `task comments list <task>`  | `task show [<task>] --comments`                                                | `task comments list` removed → use `task show --comments`                                                                                                               |
| `task history <task>`        | `task show [<task>] --history`                                                 | `task history` removed → use `task show --history`                                                                                                                      |
| `task scans <task>`          | `task show [<task>] --scans [--all] [--full]`                                  | `task scans` removed → use `task show --scans`                                                                                                                          |
| `task runs [<task>]`         | `task show [<task>] --runs [--full]`                                           | `task runs` removed → use `task show --runs`                                                                                                                            |
| `outcome show <task>`        | `task show [<task>] --outcome`                                                 | `outcome show` removed → use `task show --outcome`                                                                                                                      |
| `task lineage <task>`        | `task show [<task>] --lineage [--signal]`                                      | `task lineage` removed → use `task show --lineage`                                                                                                                      |
| `task deps list <task>`      | `task show [<task>] --deps`                                                    | `task deps list` removed → use `task show --deps`                                                                                                                       |

Also in batch 1 (no command of its own): `session attach` output and SessionStart text, server `Next:` hints (version-gated, RN-2), `SKILL.md` Core workflow, and Q7 of the output conventions (which names `task context`).

### Batch 3 — merges, renames and flag clean-up

Batch 3 is several PRs, one per sub-batch, in the order below.

#### 3a. One argument shape for test cases

Decided by the user on 2026-10-18 ([Q3](#q3-test-case-arguments), differs from the draft): `task testcase` and `milestone testcase` both stay. Every per-case command takes one handle, `<parent>/TC<n>` — `LUM-42/TC3` for a task, `<milestone-slug>/TC3` for a milestone (for example `headless-web-cli/TC3`). The two nouns have the same verbs, flags and output, built on one implementation; `SKILL.md` and `references/` describe them once. `rm` becomes `delete` (Q9).

| Current                                     | Target                                                       | Release note                                                                                |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `task testcase add <task>`                  | `task testcase add [<task>]`                                 | Changed: the task defaults to the bound one                                                 |
| `task testcase list <task>`                 | `task testcase list [<task>]`                                | Changed: the task defaults to the bound one                                                 |
| `task testcase show <task>/TC<n>`           | unchanged                                                    | —                                                                                           |
| `task testcase update <task>/TC<n>`         | unchanged                                                    | —                                                                                           |
| `task testcase rm <task>/TC<n>`             | `task testcase delete <task>/TC<n>`                          | `task testcase rm` removed → use `task testcase delete`                                     |
| `task testcase run <task>/TC<n>`            | unchanged                                                    | —                                                                                           |
| `task testcase download <task>/TC<n> <dir>` | unchanged                                                    | —                                                                                           |
| `task testcase disposition <task>/TC<n>`    | unchanged (handshake flags unchanged)                        | —                                                                                           |
| `milestone testcase add <m>`                | `milestone testcase add <m>` (same flags as the task form)   | —                                                                                           |
| `milestone testcase list <m>`               | `milestone testcase list <m>` (same output as the task form) | —                                                                                           |
| `milestone testcase show <m> <n>`           | `milestone testcase show <m>/TC<n>`                          | Changed: `milestone testcase show <m> <n>` → `milestone testcase show <m>/TC<n>`            |
| `milestone testcase update <m> <n>`         | `milestone testcase update <m>/TC<n>`                        | Changed: `milestone testcase update <m> <n>` → `<m>/TC<n>`                                  |
| `milestone testcase rm <m> <n>`             | `milestone testcase delete <m>/TC<n>`                        | `milestone testcase rm` removed → use `milestone testcase delete <m>/TC<n>`                 |
| `milestone testcase run <m> <n>`            | `milestone testcase run <m>/TC<n>`                           | Changed: `milestone testcase run <m> <n>` → `<m>/TC<n>`                                     |
| `milestone testcase download <m> <n> <dir>` | `milestone testcase download <m>/TC<n> <dir>`                | Changed: `milestone testcase download <m> <n> <dir>` → `<m>/TC<n> <dir>`                    |
| `milestone testcase disposition <m> <n>`    | `milestone testcase disposition <m>/TC<n>`                   | Changed: `milestone testcase disposition <m> <n>` → `<m>/TC<n>` (handshake flags unchanged) |

The old two-argument milestone form fails with exit 2 and the Q4 pointer (`Use: lumo milestone testcase run headless-web-cli/TC3`). A milestone slug is unique within a project; when two projects share a slug, the global `--project` picks one, as today.

#### 3b. Memory scope is a flag

| Current                                                    | Target                                                                                  | Release note                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `task memory add [<task>]`                                 | `memory add [--task <task>]` (scope `task`, the default)                                | `task memory add` removed → use `memory add`                      |
| `task memory list [<task>]`                                | `memory list [--task <task>]`                                                           | `task memory list` removed → use `memory list`                    |
| `project memory add [<project>]`                           | `memory add --scope project` (project from the global `--project` or the bound task)    | `project memory add` removed → use `memory add --scope project`   |
| `project memory list [<project>]`                          | `memory list --scope project`                                                           | `project memory list` removed → use `memory list --scope project` |
| `memory promote <memory>`                                  | `memory update <memory> --scope project`                                                | `memory promote` removed → use `memory update --scope project`    |
| `memory rm <memory>`                                       | `memory delete <memory>`                                                                | `memory rm` removed → use `memory delete`                         |
| `workspace learnings [--repo]`                             | `memory list --learnings [--repo]` (they are memory rows; deleted with `memory delete`) | `workspace learnings` removed → use `memory list --learnings`     |
| `memory show`, `memory sync`, `memory push`, `memory fold` | unchanged (`--project` on sync/push becomes the global flag, same spelling)             | —                                                                 |

#### 3c. Doc sharing and task binding are fields of `doc update`

Same pattern as the existing `--add-tag` / `--remove-tag`.

| Current                             | Target                                            | Release note                                             |
| ----------------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| `doc share <doc> <member> [--role]` | `doc update <doc> --add-member <member> [--role]` | `doc share` removed → use `doc update --add-member`      |
| `doc unshare <doc> <member>`        | `doc update <doc> --remove-member <member>`       | `doc unshare` removed → use `doc update --remove-member` |
| `doc share-list <doc>`              | `doc show <doc> --members`                        | `doc share-list` removed → use `doc show --members`      |
| `doc bind <doc> <task>`             | `doc update <doc> --add-task <task>`              | `doc bind` removed → use `doc update --add-task`         |
| `doc unbind <doc> <task>`           | `doc update <doc> --remove-task <task>`           | `doc unbind` removed → use `doc update --remove-task`    |
| `doc import-gdoc <url>`             | `doc import --gdoc <url>`                         | `doc import-gdoc` removed → use `doc import --gdoc`      |

#### 3d. `pr show` reads and `pr review` writes

`pr scan` becomes `pr show` ([Q8](#q8-keep-pr-scan-or-rename-it-to-pr-show)); its write flags move to the new `pr review`.

| Current                                    | Target                                            | Release note                                          |
| ------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------- |
| `pr scan <n> [--all --full --repo --json]` | `pr show <n> [--all --full --repo --json]`        | `pr scan` removed → use `pr show`                     |
| `pr scan <n> --review incremental\|full`   | `pr review <n> [--full]` (incremental by default) | `pr scan --review` removed → use `pr review`          |
| `pr scan <n> --pause [--limit N]`          | `pr review <n> --pause [--limit N]`               | `pr scan --pause` removed → use `pr review --pause`   |
| `pr scan <n> --resume [--limit N]`         | `pr review <n> --resume [--limit N]`              | `pr scan --resume` removed → use `pr review --resume` |

#### 3e. One `usage` noun

Shape per [Q7](#q7-shape-of-usage-and-the---apply-switch-on-usage-resync).

| Current                                     | Target                                                                                  | Release note                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `cost [--by --task --session --since]`      | `usage show [--by tool\|model\|member\|session] [--task] [--session] [--since --until]` | `cost` removed → use `usage show`                                                       |
| `report [--member --since --until --limit]` | `usage show --by member [--member] [--since --until] [--tasks]`                         | `report` removed → use `usage show --by member --tasks`                                 |
| `usage resync [--apply]`                    | `usage resync [--dry-run]`                                                              | Changed: `usage resync` applies by default; `--apply` removed, preview with `--dry-run` |

As built: `--tasks` selects the per-member window summary with the completed tasks (the former `report`, default 7 days); without it `usage show` is the per-operation view (default 30 days, `--until` now also bounds it). `--member`, `--project` and `--limit` filter the task summary only, so they need `--tasks`; `--task` / `--session` and a `--by` other than `member` do not go with it. Each mismatch is exit 2, never a silently ignored flag.

#### 3f. One summary for "what is on my plate"

`lumo status` per [Q1](#q1-name-of-the-summary-that-replaces-inbox-draft-and-next); `priority` per [Q2](#q2-where-priority-lives).

| Current                                          | Target                                                    | Release note                                             |
| ------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------- |
| `inbox list`                                     | `status --inbox`                                          | `inbox list` removed → use `status --inbox`              |
| `draft list`                                     | `status --drafts`                                         | `draft list` removed → use `status --drafts`             |
| `next [--claimable] [--count N]`                 | `status --next [--claimable] [--limit N]`                 | `next` removed → use `status --next`                     |
| `priority [text]` (writes; prompts without text) | `priority create <text>`                                  | `priority <text>` removed → use `priority create <text>` |
| `priority list`                                  | `priority list` (the current line also shows in `status`) | —                                                        |

As built: bare `lumo status` prints the priority line, then Inbox, Drafts and Next. One section flag prints exactly the old command's output and `--json` envelope (no heading). Two section flags, or none, print headed sections, and `--json` nests them as `{ version, priority?, inbox, drafts, next }`. `--claimable` / `--limit` exit 2 unless Next is printed. A section whose request fails reports its error on stderr; the others still print and the exit code is 1. `priority create` with blank text exits 2; bare `lumo priority` prints the group's help.

#### 3g. Global `--project`

Spelling stays `--project <ref>` where it is a project name, so most rows need no release note.

| Current                                | Target                                                                                                                  | Release note                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `init --project` / `--user` (booleans) | `init` (project only; LUM-1292 removed `--scope` as well, see [Q6](#q6-the-boolean---project-on-init-and-skill-update)) | `init --project`/`--user`/`--scope` removed → `init` installs into this repo |
| `skill update --project` (boolean)     | removed with `skill update` / `skill status` (the skill is served by `skill read`)                                      | `skill update`, `skill status` removed → use `lumo skill read`               |
| `setup` (alias of `init`)              | removed                                                                                                                 | `setup` removed → use `init`                                                 |
| `task list -p <project>`               | `task list --project <project>` (no short form)                                                                         | `task list -p` removed → use `--project`                                     |
| `task create --project`                | global `--project`                                                                                                      | —                                                                            |
| `task list --project`                  | global `--project`                                                                                                      | —                                                                            |
| `doc create --project`                 | global `--project`                                                                                                      | —                                                                            |
| `doc list --project`                   | global `--project`                                                                                                      | —                                                                            |
| `doc update --project`                 | global `--project`                                                                                                      | —                                                                            |
| `memory sync --project`                | global `--project`                                                                                                      | —                                                                            |
| `memory push --project`                | global `--project`                                                                                                      | —                                                                            |
| `milestone add --project`              | global `--project`                                                                                                      | —                                                                            |
| `milestone archive --project`          | global `--project`                                                                                                      | —                                                                            |
| `milestone changelog --project`        | global `--project` (command itself: 3j)                                                                                 | —                                                                            |
| `milestone create --project`           | global `--project`                                                                                                      | —                                                                            |
| `milestone delete --project`           | global `--project`                                                                                                      | —                                                                            |
| `milestone list --project`             | global `--project`                                                                                                      | —                                                                            |
| `milestone move --project`             | global `--project`                                                                                                      | —                                                                            |
| `milestone remove --project`           | global `--project`                                                                                                      | —                                                                            |
| `milestone reorder --project`          | global `--project`                                                                                                      | —                                                                            |
| `milestone show --project`             | global `--project`                                                                                                      | —                                                                            |
| `milestone summary --project`          | global `--project` (command itself: 3j)                                                                                 | —                                                                            |
| `milestone triage --project`           | global `--project`                                                                                                      | —                                                                            |
| `milestone unarchive --project`        | global `--project`                                                                                                      | —                                                                            |
| `milestone update --project`           | global `--project`                                                                                                      | —                                                                            |
| `report --project`                     | global `--project` (command itself: 3e)                                                                                 | —                                                                            |
| `milestone testcase * --project`       | global `--project` (case argument: 3a)                                                                                  | —                                                                            |

As built: `--project <ref>` is defined once on the program, so it works before or after the command words, and each command's `--help` lists it under Global Options. Its value lands in the command's own `project` option, so the commands above behave exactly as before; the others accept it and ignore it. This also covers `task testcase * --project`, `usage show --project` (still `--tasks` only) and `memory add|list --project`, which the table does not list. `grammar.json` records the program flags as `globalFlags`, and the validator accepts them on every command. Tombstone: `setup` → `init` (LUM-1292 later removed `init --scope`, `skill update` and `skill status` outright, with no tombstones). `task list -p <x>` → `--project <x>`.

#### 3h. `--force` has one meaning

| Current                                | Target                            | Release note                                                                        |
| -------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `doc rebuild-source --force --confirm` | `doc rebuild-source --confirm`    | `doc rebuild-source --force` removed; `--confirm` alone replaces an existing source |
| `worktree rm --force`                  | unchanged ("discard local edits") | `init --force`, `skill update --force`, `uninstall --force` removed in LUM-1292     |

#### 3i. `--yes` removed

Every row: `--yes` removed, `--confirm` unchanged. Release note per row: `` `<command> --yes` removed → use `--confirm` ``.

| Current                       | Target                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `doc delete --yes`            | `doc delete --confirm`                                                            |
| `memory rm --yes`             | `memory delete --confirm` (rename: 3b)                                            |
| `milestone delete --yes`      | `milestone delete --confirm`                                                      |
| `milestone testcase rm --yes` | `milestone testcase delete --confirm` (rename: 3a)                                |
| `sprint close --yes`          | `sprint close --confirm`                                                          |
| `sprint delete --yes`         | `sprint delete --confirm`                                                         |
| `task artifact rm --yes`      | `task artifact delete --confirm` (rename: 3j)                                     |
| `task deps rm --yes`          | `task dep remove --confirm` (rename: 3j)                                          |
| `task template rm --yes`      | `task template delete --confirm` (rename: 3j)                                     |
| `task testcase rm --yes`      | `task testcase delete --confirm` (rename: 3a)                                     |
| `worktree rm --yes`           | `worktree rm --confirm` (name and behaviour frozen; only the alias goes, see §11) |

As built (3h and 3i in one PR, recorded with `task decide`): `doc rebuild-source --force` was the only `--force` that had to change. `--confirm` alone now approves replacing an existing source; the CLI still sends the API's `force` field, so the server is unchanged, and the envelope's `confirmCommand` adds only `--confirm`. `--yes` went from the 8 commands that still had it; the other 3 rows had already gone with their 3a/3b renames. Both are tombstones: `<command> --yes` → the same command with `--confirm`, and `doc rebuild-source --force` → `--confirm`, never doubled.

#### 3j. Names that break VB-1, VB-2, CS-1 or RW-1

Renames and aspect moves, no behaviour change; shipped per [Q9](#q9-do-pure-renames-ship). Optional task refs follow AR-2: never before a required positional.

| Current                                     | Target                                                                                     | Release note                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `task comment <task> <body>`                | `task comment add <body> [--task <task>]`                                                  | `task comment <task> <body>` removed → use `task comment add`                  |
| `task comments edit <task> <id> <body>`     | `task comment update <id> <body> [--task <task>]`                                          | `task comments edit` removed → use `task comment update`                       |
| `task comments rm <task> <id>`              | `task comment delete <id> [--task <task>]`                                                 | `task comments rm` removed → use `task comment delete`                         |
| `task deps add <task> --blocked-by`         | `task dep add [<task>] --blocked-by`                                                       | `task deps add` removed → use `task dep add`                                   |
| `task deps confirm <task> <edge>`           | `task dep confirm <task> <edge>`                                                           | `task deps confirm` removed → use `task dep confirm`                           |
| `task deps dismiss <task> <edge>`           | `task dep dismiss <task> <edge>`                                                           | `task deps dismiss` removed → use `task dep dismiss`                           |
| `task deps rm <task> <edge>`                | `task dep remove <task> <edge>`                                                            | `task deps rm` removed → use `task dep remove`                                 |
| `task artifact rm <task> <artifact>`        | `task artifact delete <task> <artifact>`                                                   | `task artifact rm` removed → use `task artifact delete`                        |
| `task template edit <key>`                  | `task template update <key>`                                                               | `task template edit` removed → use `task template update`                      |
| `task template rm <key>`                    | `task template delete <key>`                                                               | `task template rm` removed → use `task template delete`                        |
| `task figma rm <task> <link>`               | `task figma remove <task> <link>`                                                          | `task figma rm` removed → use `task figma remove`                              |
| `task figma context <task> <ref>`           | `task figma show <task> <ref>`                                                             | `task figma context` removed → use `task figma show`                           |
| `project overview <project>`                | `project show <project> [--report]`                                                        | `project overview` removed → use `project show`                                |
| `milestone summary <m>`                     | `milestone show <m> --summary`                                                             | `milestone summary` removed → use `milestone show --summary`                   |
| `milestone summary <m> --retry`             | `milestone update <m> --refresh-summary`                                                   | `milestone summary --retry` removed → use `milestone update --refresh-summary` |
| `milestone changelog <m>`                   | `milestone show <m> --changelog`                                                           | `milestone changelog` removed → use `milestone show --changelog`               |
| `sprint summary <s>`                        | `sprint show <s> --summary`                                                                | `sprint summary` removed → use `sprint show --summary`                         |
| `sprint summary <s> --retry`                | `sprint update <s> --refresh-summary`                                                      | `sprint summary --retry` removed → use `sprint update --refresh-summary`       |
| `workspace security-scan` (no setting flag) | `workspace security-scan show`                                                             | Changed: reading the settings is `workspace security-scan show`                |
| `workspace security-scan --<setting> …`     | `workspace security-scan update --<setting> …`                                             | Changed: changing a setting is `workspace security-scan update`                |
| `task statuses`                             | unchanged — exception to CS-1 (`task status` is frozen and taken; it lists the status set) | —                                                                              |

As built:

- Every old name is a tombstone (exit 2; it names the new form, keeps the caller's arguments and maps `--yes` to `--confirm`). None appears in `--help` or `grammar.json`.
- `task comment` and `workspace security-scan` are plain groups now. Their tombstones fire only for the old shapes: `task comment <task> <body>`, and flags right after `security-scan` (a setting flag → `update`, otherwise → `show`).
- `task comment add|update|delete` and `task dep add` take the task from `--task` / `[task]`, defaulting to the session-bound task.
- `milestone show --summary --changelog` and `sprint show --summary` are aspects: sections after the detail view, and keys of the `--json` envelope. A failed aspect read is one `Could not read (…)` line. `milestone|sprint update --refresh-summary` can be combined with field flags or used on its own.
- `workspace security-scan update` with no setting exits 2.
- Each new command keeps the old command's Codex class, so the generated whitelist changes in names only (pinned by a test).
- Server text naming a renamed command follows `X-Lumo-Cli-Version`: the figma hint in task context and the stale-dependency hint (`RENAMES_MIN_CLI_VERSION` 1.125.5, env override). Texts with no version (the `--parent` 400, GitHub PR replies) give the new form with the 1.125-and-older form in parentheses.

#### 3k. `task search` folded into `task list`

Per [Q10](#q10-one-task-query). One task query, modelled on `gh issue list`: a repeated flag ORs its values, different flags AND.

| Current                         | Target                                                  | Release note                                                            |
| ------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `task search [query] [filters]` | `task list --assignee any [--search <query>] [filters]` | `task search` removed → use `task list --assignee any --search`         |
| `task list` (my tasks only)     | `task list` — still my tasks without `--assignee`       | Added: every `task search` filter, `--search`, `--exact` on `task list` |

As built:

- `task list` takes `--assignee` (me by default; `any`, `none`, an email or a name; repeatable), `--search`/`--exact`, and repeatable `--status`, `--priority` and `--tag`, plus `--milestone`, `--sprint`/`--team`, `--due-after`/`--due-before`, the global `--project`, paging, `--json` and `--fields`. No `-p` short flag: it was `--project` until 3g.
- With no flags it sends the 1.126.0 request unchanged (`GET /api/tasks/me?limit=50`) and prints the same table. With `--assignee` the table adds ASSIGNEE and DUE columns. `--json` gains `truncated` (a fuzzy `--search` hit the 500-match ranking cap).
- Server: `GET /api/tasks/me` (paged path) now runs the workspace query: the same WHERE, order and ranking as `/api/tasks/workspace`. It only gained params (`assignee=any`, `assigneeActorIds`, `unassigned`, `priorities`, `tagIds`, `projectIds`, `q`, `match`, `dueAfter`, `dueBefore`); the old ones mean what they meant, and `/api/tasks/workspace` is unchanged for CLI 1.126.0 and the web board. A new CLI that gets no `truncated` back for a new filter fails instead of printing the unfiltered list. No server text named `task search`, so nothing is version-gated.
- The `task search` tombstone keeps the caller's filters, adds `--assignee any` when none was given (search spanned the workspace), turns the query words into `--search`, `-p` into `--priority`, and drops `--exact` when there was no query.
- Codex: `task list` keeps its class; the generated whitelist only loses `task search` (pinned by a test).

### Batch 4 — Codex rules from the grammar

No command changes its name. `cli/src/lib/codex-rules.ts` stops keeping its own lists and is generated from per-command metadata in `grammar.json` (CX-1). Release note: none, as long as the generated `.rules` file is identical for unchanged commands.

As built:

- Each command declares `.codex(SERVER_ONLY | readsLocalFile(flag) | writesLocal(what) | sandboxed(why))` in `cli/src/index.ts`. That records two facts: whether the command is server-only, and whether it reads or writes local files (`cli/src/lib/command-class.ts`). A class on a group (`hook`, `worktree`) covers everything below it.
- `emit-grammar` writes the classes into `grammar.json` and `cli/src/lib/codex-classes.generated.ts`. It refuses to emit when a leaf has no class, or when a class is declared twice on one path.
- `codex-rules.ts` derives its three lists from those classes. A tombstone is never registered, so it can never be allowed.
- The generated rules equal the last hand-kept ones with one deliberate exception, pinned in a test. `priority` was allowed as a whole group, which also allowed the removed `priority <text>`; now only `priority create` and `priority list` are allowed. So the rules file changes in that one rule.

### Not affected

Every other leaf keeps its name and flags: `audit list`, `auth login/logout`, `crossing disposition/explain/list`, `doc append/create/delete/diff/list/move/patch/show/sync/update` (except the flags above), `doctor`, `finding disposition`, all `hook *`, `init` (except Q6), `member list`, `milestone add/archive/create/delete/list/move/remove/reorder/show/triage/unarchive/update`, `project create/list/update`, `session attach/status`, `skill read`, `sprint add/close/create/delete/list/remove/show/start/update`, `tag create/list`, `task artifact add/list/show/update`, `task create/decide/delete/statuses/update`, `task figma add/list/refresh`, `task pr show`, `task slack show`, `task web show`, `task template create/list/show`, `uninstall`, `update`, `whoami`, `worktree add/list/prune/rm`.

### Counts

"Names removed" are leaf commands that stop existing; "new names" are leaves that did not exist before; "flag-only" rows keep the command name.

| Batch | Rows | Names removed                           | New names | Flag- or argument-only rows |
| ----- | ---- | --------------------------------------- | --------- | --------------------------- |
| 1     | 12   | 9 (`task context --full` is a flag row) | 0         | 3                           |
| 3a    | 16   | 2                                       | 2         | 14                          |
| 3b    | 8    | 7                                       | 4         | 1                           |
| 3c    | 5    | 5                                       | 0         | 0                           |
| 3d    | 4    | 1                                       | 2         | 3                           |
| 3e    | 3    | 2                                       | 1         | 1                           |
| 3f    | 5    | 3 (+ `priority` stops being invokable)  | 2         | 0                           |
| 3g    | 28   | 1                                       | 0         | 27                          |
| 3h    | 2    | 0                                       | 0         | 1                           |
| 3i    | 11   | 0                                       | 0         | 11                          |
| 3j    | 21   | 17                                      | 15        | 3                           |
| 4     | 0    | 0                                       | 0         | 0                           |

Leaf commands excluding `hook *`: **149 today → 127** after batches 1 and 3 (22 fewer), and 6 fewer top-level commands, 32 → 26 (`outcome`, `inbox`, `draft`, `cost`, `report`, `next`, `setup` go; `status` arrives). Each batch's PR prints the exact grammar diff.

---

## 13. Rollout batches

| Order | Batch | Scope                                                | Branch                                | Depends on                                        |
| ----- | ----- | ---------------------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| 0     | —     | this document                                        | `lumo/LUM-1233-cli-command-structure` | —                                                 |
| 1     | 1     | one way to read a task                               | `lumo/LUM-1233-read-entry`            | this document (agreed 2026-10-18)                 |
| 2     | 3a–3j | merges, renames, flag clean-up; one PR per sub-batch | `lumo/LUM-1233-<sub-batch>`           | batch 1                                           |
| 3     | 4     | Codex rules from the grammar                         | `lumo/LUM-1233-codex-rules`           | can go before batch 3 to make its renames cheaper |

Batch 2 of the original plan (aliases) is cancelled by the 2026-10-18 ruling.

**LUM-1232.** The brief asked batch 1 to be ordered against LUM-1232 batch D, and batch 3 to follow LUM-1232 batches A and B. As of `origin/main` `ab6a353d6` (2026-10-18) all seven LUM-1232 batches (D, G, E, A, B, F, C) are merged, so there is no open PR to order against; batches here start from its output rules.

**Every batch**: tests that fail before it; before/after output from a worktree build of the CLI; `SKILL.md` and `references/` updated (catalog stays one line per domain; the body budget is ~30k characters); grammar regenerated; doc-examples test green; every RN-2 step done. No version bump and no release per batch: the CLI is released once, when the milestone is done, with all release-note lines from §12.

---

## 14. Decisions

The review draft listed nine open questions. The user decided all of them on 2026-10-18; the rulings are recorded with `lumo task decide` on LUM-1233. **Q3 differs from the draft's recommendation**; the others follow it.

### Q1. Name of the summary that replaces `inbox`, `draft` and `next`

- **Decision (2026-10-18):** `lumo status`, with the sections Inbox, Drafts and Next; `--inbox`, `--drafts` and `--next` print one section. `next --count` becomes `--limit` (`-n`).
- **Why:** it is `gh status` (assigned work, review requests and mentions in one call), the name an agent guesses first, and one call instead of three. Its help text says it is about "me across the workspace", to keep it apart from `task status` and `session status`; it never takes a task ref.
- **Rejected:** `lumo inbox` with flags, `lumo home`, keeping three commands.

### Q2. Where `priority` lives

- **Decision (2026-10-18):** `priority create <text>` and `priority list`; the current priority also shows as one line in `lumo status`. `lumo priority [text]` stops being a command and its interactive prompt goes.
- **Why:** the smallest change that satisfies CS-2 (no invokable group) and CF-1 (no interactive prompt), and the append-only history stays readable from the CLI. The priority is a team declaration, so it does not move under `project`.

### Q3. Test-case arguments

- **Decision (2026-10-18; differs from the draft, which recommended one top-level `testcase` noun):** no top-level `testcase`. `task testcase` and `milestone testcase` both stay. Every per-case command takes a single handle `<parent>/TC<n>`: `LUM-42/TC3` for a task case, `<milestone-slug>/TC3` for a milestone case (`headless-web-cli/TC3`). The two nouns have identical verbs, flags and output and share one implementation; `SKILL.md` and `references/` describe them once.
- **Consequences:** the task form is unchanged except `rm` → `delete` (Q9) and the optional task on `list`/`add` (AR-2). The milestone form changes from two positionals (`<m> <n>`) to the handle. See [mapping 3a](#3a-one-argument-shape-for-test-cases).
- **Why:** the parent stays explicit in the command, and one handle shape covers both, without a flag.

### Q4. What a removed command prints

- **Decision (2026-10-18):** a tombstone error, not an alias: `Error: lumo task context was removed. Use: lumo task show --full`, exit 2, `"code": "COMMAND_REMOVED"` under `--json`. The command never runs. Tombstones are hidden from `--help` and `grammar.json`, live in one table that also feeds the release notes and the skill's "do not exist" list, and are dropped two minor releases after the removal ([RN-3](#rn-3-running-a-removed-name)).
- **Why:** agents reading a stale skill keep calling removed names after an upgrade (since LUM-1292 the skill is served by `lumo skill read` from the installed CLI, so it only lags the CLI itself); one line saves a `--help` round trip and a guess.

### Q5. What `task show --full` prints

- **Decision (2026-10-18):** `task show --full` prints the detail view (D-1–D-3), then the old `task context` body unchanged as Markdown, with the one-line memory index. Full memory bodies (old `task context --full`) come from the aspect flag `--memory`.
- **Why:** keeps both LUM-1232 rulings (detail layout for `show`, Markdown for the paste-into-context body; output conventions Q7 moves from `task context` to `task show --full`), lets the batch-1 test compare the old context output section by section, and keeps the common `--full` call at today's `task context` size.

### Q6. The boolean `--project` on `init` and `skill update`

- **Decision (2026-10-18, superseded by LUM-1292):** `init --project` / `--user` became `--scope project|user`; LUM-1292 then removed the scope entirely (`init`/`uninstall` are project-only, `skill update` is gone). `--project <ref>` is global (GF-1).
- **Why:** one flag, one meaning. The `init` command name, its behaviour and the hook names it writes are unchanged, so the freeze is not touched; only the typed flag changes, with a release note.

### Q7. Shape of `usage` and the `--apply` switch on `usage resync`

- **Decision (2026-10-18):** one `usage show` with `--by tool|model|member|session` (default `tool`), the local-day window flags of `report` (`--since`, `--until`), and `--tasks` to append the completed-task list. `usage resync` applies when called; `--dry-run` previews; `--apply` is removed.
- **Why:** one noun and one read verb for usage (VB-1), and RW-2: writes run when called and preview with `--dry-run`, like `init`, `memory sync` and `memory push`.

### Q8. Keep `pr scan`, or rename it to `pr show`

- **Decision (2026-10-18):** rename to `pr show <n>` (read only) in the 3d PR; write flags move to `pr review`. `pr scan` is removed with a release note and a Q4 tombstone.
- **Why:** "scan" reads like an action (it sounds like it starts a scan), `show` is the core read verb (VB-1), and the task side is `task show --scans`.

### Q9. Do pure renames ship

- **Decision (2026-10-18):** yes, all of 3j: `rm` → `delete`/`remove`, `edit` → `update`, `comments` → `comment`, `deps` → `dep`, `overview` → `show`, and the summary/changelog aspects. Exceptions stay listed: `worktree rm` (frozen) and `task statuses` (`task status` is taken).
- **Why:** an agent can predict a name from the rules only if the rules have no silent exceptions; the renamed commands are mostly rarely called (`task comments edit` 3, `task template rm` 1, `task deps rm` 0 in 30 days), so the habit cost is low.

### Q10. One task query

- **Decision (2026-10-19):** `task list` takes every `task search` filter plus `--search <text>` (same ranking and typo tolerance, `--exact` kept); `task search` becomes a tombstone. Without `--assignee` `task list` still lists only my tasks; `--assignee any` lists everyone's, `--assignee none` the unassigned ones.
- **Why:** two commands for one query made agents pick between "mine" and "all" before filtering; one command with an assignee filter is the `gh issue list` shape agents already know.
