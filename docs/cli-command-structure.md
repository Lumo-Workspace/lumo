# CLI command structure conventions

**Status: draft for review (2026-10-18).** Nothing in this document is implemented yet. The [Open questions](#14-open-questions) need the user's ruling before batch 1 starts; once decided, they move to a Decisions section and the status changes to "agreed". Until a batch lands, the "current" column of the [mapping](#12-mapping-current--target) is what the CLI accepts.

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
14. [Open questions](#14-open-questions)

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

Every command is a noun followed by a verb: `lumo task show`, `lumo doc update`, `lumo testcase run`.

- **Nouns are singular**: `task`, `comment`, `dep`, `testcase` — never `comments`, `deps`, `learnings`.
- **At most two noun levels**: `lumo task artifact add` is the deepest shape. A third noun level becomes a flag or its own top-level noun.
- **One word or kebab-case** for each segment: `security-scan`, `import-gdoc`. No camelCase, no underscores.

`gh` follows the same shape (`gh pr view`, `gh repo clone`, `gh run list`) with one noun level. Lumo allows two because tasks own many things (artifacts, Figma links, comments).

Enforced: new test over `grammar.json` (batch 3).

### CS-2. A noun is never itself a command

`lumo priority "text"` (a group that also writes) is the only case today. A noun prints its help and exits 0 when called alone. Every action is a verb under it.

Enforced: the grammar test above (`isInvokable && hasSubcommands` must be false).

### CS-3. Tool-level commands are the only verbs without a noun

Commands about the CLI itself, or about "me" across everything, have no noun:

| Command     | Job                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| `init`      | install the skill, hooks and Codex rule (frozen)                                                             |
| `uninstall` | remove what `init` installed                                                                                 |
| `update`    | update the CLI                                                                                               |
| `doctor`    | diagnose the local install (frozen)                                                                          |
| `whoami`    | the logged-in identity                                                                                       |
| `status`    | proposed: my inbox, drafts and next tasks ([Q1](#q1-name-of-the-summary-that-replaces-inbox-draft-and-next)) |

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
| `run`    | execute or record an execution (`testcase run`)                                       | write           |

`delete` versus `remove` is the one distinction to get right: `milestone remove <m> LUM-4` takes the task out of the milestone and the task survives; `testcase delete LUM-4/TC2` destroys the test case. When the object is owned by its parent and has no life outside it (a test case, an artifact, a comment), the verb is `delete`. When it is a link between two things that both survive (a dependency edge, a Figma link, a task in a sprint), the verb is `remove`.

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

| Verb                                                                       | Where                             | Why not a core verb                                                                      |
| -------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| `status`                                                                   | `task`, `session`, `skill`        | a computed state check, not a stored object (`task status`, `session status` are frozen) |
| `attach`                                                                   | `session`                         | frozen                                                                                   |
| `decide`                                                                   | `task`                            | records a ruling in the task's Decisions                                                 |
| `disposition`                                                              | `crossing`, `finding`, `testcase` | the human-only ruling handshake                                                          |
| `explain`                                                                  | `crossing`                        | the agent's account of a crossing                                                        |
| `confirm`, `dismiss`                                                       | `task dep`                        | rule on a detected candidate edge                                                        |
| `download`                                                                 | `testcase`                        | writes evidence files to a local directory                                               |
| `review`                                                                   | `pr`                              | request or control an AI review (new, batch 3)                                           |
| `scan`                                                                     | `pr`                              | read a PR's scans ([Q8](#q8-keep-pr-scan-or-rename-it-to-pr-show))                       |
| `diff`, `patch`, `append`, `move`, `sync`, `import-gdoc`, `rebuild-source` | `doc`                             | live-doc editing and import                                                              |
| `archive`, `unarchive`, `move`, `reorder`, `triage`                        | `milestone`                       | ordering and lifecycle                                                                   |
| `start`, `close`                                                           | `sprint`                          | lifecycle                                                                                |
| `sync`, `push`, `fold`                                                     | `memory`                          | local memory store                                                                       |
| `refresh`                                                                  | `task figma`                      | re-fetch from Figma                                                                      |
| `resync`                                                                   | `usage`                           | correct historical usage                                                                 |
| `prune`                                                                    | `worktree`                        | clean up                                                                                 |
| `login`, `logout`                                                          | `auth`                            | authentication                                                                           |
| hook event names                                                           | `hook`                            | frozen; named after the agent's hook events                                              |

A domain verb must not mean the same as a core verb (`context` meant `show`; it goes).

---

## 4. Reads and writes

### RW-1. A read command has no flag with a side effect

`list` and `show` (and `status`, `scan`, `diff`) never change state. A flag that writes belongs on a write command. Today three commands break this:

| Command                               | Side-effect flag                             | Target                                                           |
| ------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| `pr scan`                             | `--review`, `--pause`, `--resume`, `--limit` | `pr review` ([mapping 3d](#3d-pr-scan-read-and-pr-review-write)) |
| `milestone summary`, `sprint summary` | `--retry` (queues a regeneration)            | `milestone update` / `sprint update --refresh-summary`           |
| `workspace security-scan`             | every setting flag (no flag = read)          | `workspace security-scan show` / `update`                        |

Enforced: new grammar test — leaves whose verb is `list`, `show` or `status` may not declare a flag from a deny list (batch 3).

### RW-2. A write runs when called; `--dry-run` previews

A write command does its job when called. If it can preview, the preview is `--dry-run` (as `init`, `skill update`, `memory sync`, `memory push` already do). A write that needs the user's approval uses `--confirm` and exit 4 ([CF-1](#cf-1-confirmation-is---confirm-plus-exit-4-only)), never a default-off "apply" switch. `usage resync --apply` is the one switch of that kind ([Q7](#q7-shape-of-usage-and-the---apply-switch-on-usage-resync)).

### RW-3. A write ends with its result, not a second read

Unchanged from today: writes print what changed, and the writes that already end with the `task status` digest keep it (frozen, [§11](#11-frozen-commands-do-not-change)). An agent should never need a follow-up read to learn what its write did.

---

## 5. Aspects are flags, not subcommands

### AF-1. One `show` per object; aspects are flags on it

Everything an agent reads to understand one object comes from that object's `show`, with a flag per aspect. Aspects do not get their own subcommand.

For a task (`--full`, `--comments`, `--history`, `--scans`, `--runs` and `--outcome` were ruled by the user on 2026-10-18; `--lineage` and `--deps` are this draft's proposal under the same rule):

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
lumo task status [<task>]               # state and next actions; READY adds the DONE-readiness section (was: task wrapup)
```

The same rule applies to milestones (`--summary`, `--changelog`), sprints (`--summary`), docs (`--members`) and memory (`--learnings`); see the [mapping](#12-mapping-current--target).

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

The thing the command acts on is the positional argument. Things that only locate it are flags: `--task`, `--milestone`, `--repo`, and the global `--project` ([GF-1](#gf-1-three-global-flags)).

```
lumo testcase run LUM-4/TC2 …          # the case is positional
lumo crossing disposition 3f2a… --task LUM-4   # the crossing is positional; the task only locates it
```

### AR-2. A task ref may be left out; the session-bound task fills it

When the task is the primary object or the context of a command, it may be omitted; the task bound by `lumo session attach` is used. Resolution order:

1. the positional task ref, if given;
2. `--task <ref>`, if the command has it;
3. the session-bound task;
4. otherwise exit 2, `Error: no task given and this session is not attached` with `Hint: pass a task ref, or run lumo session attach <task>`.

The output's first line names the resolved ref (D-1 of the output conventions), so an implicit target is always visible.

Today 6 commands accept this (`task status`, `task runs`, `task wrapup`, `task memory add/list`, `crossing list`). Batches 1 and 3 extend it to every command whose primary or context object is a task (`task show`, `task update`, `task comment add`, `testcase list/add`, …).

Enforced: grammar — every `task` positional is `required: false` unless listed in AR-3 (batch 3).

### AR-3. What is deleted is always named

A `delete` or `remove` never takes its target from the binding: `task delete` requires the task ref, `testcase delete` the case handle. The owning task of a case handle (`TC2` → `LUM-4/TC2`) may still come from the binding, because the case itself is named.

---

## 7. Global flags and short flags

### GF-1. Three global flags

| Flag              | Meaning                                                                                                      | Status                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `--json`          | one JSON document on stdout (output conventions §11)                                                         | on every read since LUM-1232 batch C; writes gain it when touched |
| `--no-hints`      | hide advice (`Next:`, `Hint:`); same as `LUMO_NO_HINTS=1` (output conventions §10)                           | global today                                                      |
| `--project <ref>` | the project to resolve names in (milestones, docs, memory, task lists); defaults to the bound task's project | batch 3: replaces ~30 per-command `--project` flags               |

A global flag means the same on every command and is accepted on every command. A command that cannot honour it (`--json` on a write not yet converted) fails with exit 2 instead of ignoring it.

`--project` today has two meanings: a project name on most commands, and a boolean "install into this repo" on `init`, `setup` and `skill update`. The boolean has to move before `--project` can be global ([Q6](#q6-the-boolean---project-on-init-and-skill-update)).

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

- **`--yes` is removed** from the 11 commands that still accept it as an alias of `--confirm` ([mapping 3i](#3i---yes-removed)).
- No interactive y/N prompt anywhere; `priority` without text is the last interactive prompt and goes ([Q2](#q2-where-priority-lives)).
- The three disposition handshakes (`--confirm-read`, `--receipt`, `--confirm`) on `crossing disposition`, `finding disposition` and test-case `disposition` keep their flags exactly.

### CF-2. `--force` has one meaning: discard local edits on this machine

`--force` means "go ahead even though it throws away local changes": uncommitted work in a worktree, or skill files edited by hand. It never means "approve" (that is `--confirm`) and never touches server data.

| Command              | `--force` today                                                 | Target                                                                        |
| -------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `worktree rm`        | remove with uncommitted changes                                 | unchanged                                                                     |
| `init`               | overwrite locally modified skill files and a foreign Codex rule | unchanged                                                                     |
| `skill update`       | overwrite locally modified skill copies                         | unchanged                                                                     |
| `uninstall`          | also delete locally edited skill copies                         | unchanged                                                                     |
| `doc rebuild-source` | replace the existing server-side source                         | **removed**: the exit-4 envelope already gates it, `--confirm` alone approves |
| `setup`              | as `init`                                                       | command removed                                                               |

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

By default a removed name fails like any unknown command: exit 2, `Error: unknown command …`. Whether the CLI also prints a pointer to the new name is [Q4](#q4-what-a-removed-command-prints). Either way the command does not run.

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

These names and flags are relied on by hooks, installed settings, server-written envelopes or the gates. No batch renames, removes or changes their meaning:

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

Moving test-case `disposition` from `task testcase` to `testcase` (batch 3) keeps its flags; the server-written `confirmCommand` follows RN-2 step 5.

---

## 12. Mapping: current → target

One row per command. **Batch** is the PR that changes it. **Release note** is the line that goes under "Removed" (or "Changed") when the batch ships; `—` means nothing user-visible changes. Command names are without the `lumo` prefix.

### Batch 1 — one way to read a task

Ruled by the user on 2026-10-18.

| Current                        | Target                                                                                  | Release note                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task context <task> [--full]` | `task show [<task>] --full` (memory bodies: see [Q5](#q5-what-task-show---full-prints)) | `task context` removed → use `task show --full`                                                                                                   |
| `task wrapup [<task>]`         | `task status [<task>]` (READY adds the readiness section and the next command)          | `task wrapup` removed → use `task status`                                                                                                         |
| `task show <task>`             | `task show [<task>]` + aspect flags                                                     | Changed: `task show` takes `--full`, `--comments`, `--history`, `--scans`, `--runs`, `--outcome`, `--lineage`; the task defaults to the bound one |
| `task status [<task>]`         | unchanged name; READY output adds the readiness section                                 | Changed: `task status` shows DONE readiness and the next command when READY                                                                       |
| `task comments list <task>`    | `task show [<task>] --comments`                                                         | `task comments list` removed → use `task show --comments`                                                                                         |
| `task history <task>`          | `task show [<task>] --history`                                                          | `task history` removed → use `task show --history`                                                                                                |
| `task scans <task>`            | `task show [<task>] --scans [--all] [--full]`                                           | `task scans` removed → use `task show --scans`                                                                                                    |
| `task runs [<task>]`           | `task show [<task>] --runs [--full]`                                                    | `task runs` removed → use `task show --runs`                                                                                                      |
| `outcome show <task>`          | `task show [<task>] --outcome`                                                          | `outcome show` removed → use `task show --outcome`                                                                                                |
| `task lineage <task>`          | `task show [<task>] --lineage [--signal]`                                               | `task lineage` removed → use `task show --lineage`                                                                                                |

Also in batch 1 (no command of its own): `session attach` output and SessionStart text, server `Next:` hints (version-gated, RN-2), `SKILL.md` Core workflow, and Q7 of the output conventions (which names `task context`).

### Batch 3 — merges, renames and flag clean-up

Batch 3 is several PRs, one per sub-batch, in the order below.

#### 3a. One `testcase` noun

Argument shape per [Q3](#q3-arguments-of-the-top-level-testcase) (recommended form shown).

| Current                                     | Target                                                    | Release note                                                                      |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `task testcase add <task>`                  | `testcase add [<task>]`                                   | `task testcase add` removed → use `testcase add`                                  |
| `task testcase list <task>`                 | `testcase list [<task>]`                                  | `task testcase list` removed → use `testcase list`                                |
| `task testcase show <task>/TC<n>`           | `testcase show <task>/TC<n>` (or `TC<n>`)                 | `task testcase show` removed → use `testcase show`                                |
| `task testcase update <task>/TC<n>`         | `testcase update <case>`                                  | `task testcase update` removed → use `testcase update`                            |
| `task testcase rm <task>/TC<n>`             | `testcase delete <case>`                                  | `task testcase rm` removed → use `testcase delete`                                |
| `task testcase run <task>/TC<n>`            | `testcase run <case>`                                     | `task testcase run` removed → use `testcase run`                                  |
| `task testcase download <case> <dir>`       | `testcase download <case> <dir>`                          | `task testcase download` removed → use `testcase download`                        |
| `task testcase disposition <case>`          | `testcase disposition <case>` (handshake flags unchanged) | `task testcase disposition` removed → use `testcase disposition`                  |
| `milestone testcase add <m>`                | `testcase add --milestone <m>`                            | `milestone testcase add` removed → use `testcase add --milestone`                 |
| `milestone testcase list <m>`               | `testcase list --milestone <m>`                           | `milestone testcase list` removed → use `testcase list --milestone`               |
| `milestone testcase show <m> <n>`           | `testcase show TC<n> --milestone <m>`                     | `milestone testcase show` removed → use `testcase show --milestone`               |
| `milestone testcase update <m> <n>`         | `testcase update TC<n> --milestone <m>`                   | `milestone testcase update` removed → use `testcase update --milestone`           |
| `milestone testcase rm <m> <n>`             | `testcase delete TC<n> --milestone <m>`                   | `milestone testcase rm` removed → use `testcase delete --milestone`               |
| `milestone testcase run <m> <n>`            | `testcase run TC<n> --milestone <m>`                      | `milestone testcase run` removed → use `testcase run --milestone`                 |
| `milestone testcase download <m> <n> <dir>` | `testcase download TC<n> <dir> --milestone <m>`           | `milestone testcase download` removed → use `testcase download --milestone`       |
| `milestone testcase disposition <m> <n>`    | `testcase disposition TC<n> --milestone <m>`              | `milestone testcase disposition` removed → use `testcase disposition --milestone` |

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

#### 3d. `pr scan` reads and `pr review` writes

| Current                                    | Target                                                                                           | Release note                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `pr scan <n> [--all --full --repo --json]` | `pr scan <n>` with the same read flags (name per [Q8](#q8-keep-pr-scan-or-rename-it-to-pr-show)) | Changed: `pr scan` only reads                         |
| `pr scan <n> --review incremental\|full`   | `pr review <n> [--full]` (incremental by default)                                                | `pr scan --review` removed → use `pr review`          |
| `pr scan <n> --pause [--limit N]`          | `pr review <n> --pause [--limit N]`                                                              | `pr scan --pause` removed → use `pr review --pause`   |
| `pr scan <n> --resume [--limit N]`         | `pr review <n> --resume [--limit N]`                                                             | `pr scan --resume` removed → use `pr review --resume` |

#### 3e. One `usage` noun

Shape per [Q7](#q7-shape-of-usage-and-the---apply-switch-on-usage-resync) (recommended form shown).

| Current                                     | Target                                                                                  | Release note                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `cost [--by --task --session --since]`      | `usage show [--by tool\|model\|member\|session] [--task] [--session] [--since --until]` | `cost` removed → use `usage show`                                                       |
| `report [--member --since --until --limit]` | `usage show --by member [--member] [--since --until] [--tasks]`                         | `report` removed → use `usage show --by member --tasks`                                 |
| `usage resync [--apply]`                    | `usage resync [--dry-run]`                                                              | Changed: `usage resync` applies by default; `--apply` removed, preview with `--dry-run` |

#### 3f. One summary for "what is on my plate"

Name per [Q1](#q1-name-of-the-summary-that-replaces-inbox-draft-and-next), placement of priority per [Q2](#q2-where-priority-lives).

| Current                                          | Target                                                    | Release note                                             |
| ------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------- |
| `inbox list`                                     | `status --inbox`                                          | `inbox list` removed → use `status --inbox`              |
| `draft list`                                     | `status --drafts`                                         | `draft list` removed → use `status --drafts`             |
| `next [--claimable] [--count N]`                 | `status --next [--claimable] [--limit N]`                 | `next` removed → use `status --next`                     |
| `priority [text]` (writes; prompts without text) | `priority create <text>`                                  | `priority <text>` removed → use `priority create <text>` |
| `priority list`                                  | `priority list` (the current line also shows in `status`) | —                                                        |

#### 3g. Global `--project`

Spelling stays `--project <ref>` where it is a project name, so most rows need no release note.

| Current                                | Target                                                                                      | Release note                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `init --project` / `--user` (booleans) | `init --scope project\|user` (per [Q6](#q6-the-boolean---project-on-init-and-skill-update)) | Changed: `init --project`/`--user` → `init --scope project\|user` |
| `skill update --project` (boolean)     | `skill update --scope project\|user`                                                        | Changed: `skill update --project` → `--scope project`             |
| `setup` (alias of `init`)              | removed                                                                                     | `setup` removed → use `init`                                      |
| `task list -p <project>`               | `task list --project <project>` (no short form)                                             | `task list -p` removed → use `--project`                          |
| `task create --project`                | global `--project`                                                                          | —                                                                 |
| `task list --project`                  | global `--project`                                                                          | —                                                                 |
| `task search --project`                | global `--project`                                                                          | —                                                                 |
| `doc create --project`                 | global `--project`                                                                          | —                                                                 |
| `doc list --project`                   | global `--project`                                                                          | —                                                                 |
| `doc update --project`                 | global `--project`                                                                          | —                                                                 |
| `memory sync --project`                | global `--project`                                                                          | —                                                                 |
| `memory push --project`                | global `--project`                                                                          | —                                                                 |
| `milestone add --project`              | global `--project`                                                                          | —                                                                 |
| `milestone archive --project`          | global `--project`                                                                          | —                                                                 |
| `milestone changelog --project`        | global `--project` (command itself: 3j)                                                     | —                                                                 |
| `milestone create --project`           | global `--project`                                                                          | —                                                                 |
| `milestone delete --project`           | global `--project`                                                                          | —                                                                 |
| `milestone list --project`             | global `--project`                                                                          | —                                                                 |
| `milestone move --project`             | global `--project`                                                                          | —                                                                 |
| `milestone remove --project`           | global `--project`                                                                          | —                                                                 |
| `milestone reorder --project`          | global `--project`                                                                          | —                                                                 |
| `milestone show --project`             | global `--project`                                                                          | —                                                                 |
| `milestone summary --project`          | global `--project` (command itself: 3j)                                                     | —                                                                 |
| `milestone triage --project`           | global `--project`                                                                          | —                                                                 |
| `milestone unarchive --project`        | global `--project`                                                                          | —                                                                 |
| `milestone update --project`           | global `--project`                                                                          | —                                                                 |
| `report --project`                     | global `--project` (command itself: 3e)                                                     | —                                                                 |
| `milestone testcase * --project`       | global `--project` (commands themselves: 3a)                                                | —                                                                 |

#### 3h. `--force` has one meaning

| Current                                                                            | Target                                     | Release note                                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `doc rebuild-source --force --confirm`                                             | `doc rebuild-source --confirm`             | `doc rebuild-source --force` removed; `--confirm` alone replaces an existing source |
| `worktree rm --force`, `init --force`, `skill update --force`, `uninstall --force` | unchanged (all mean "discard local edits") | —                                                                                   |

#### 3i. `--yes` removed

Every row: `--yes` removed, `--confirm` unchanged. Release note per row: `` `<command> --yes` removed → use `--confirm` ``.

| Current                       | Target                                                     |
| ----------------------------- | ---------------------------------------------------------- |
| `doc delete --yes`            | `doc delete --confirm`                                     |
| `memory rm --yes`             | `memory delete --confirm` (rename: 3b)                     |
| `milestone delete --yes`      | `milestone delete --confirm`                               |
| `milestone testcase rm --yes` | `testcase delete --confirm` (rename: 3a)                   |
| `sprint close --yes`          | `sprint close --confirm`                                   |
| `sprint delete --yes`         | `sprint delete --confirm`                                  |
| `task artifact rm --yes`      | `task artifact delete --confirm` (rename: 3j)              |
| `task deps rm --yes`          | `task dep remove --confirm` (rename: 3j)                   |
| `task template rm --yes`      | `task template delete --confirm` (rename: 3j)              |
| `task testcase rm --yes`      | `testcase delete --confirm` (rename: 3a)                   |
| `worktree rm --yes`           | `worktree rm --confirm` (name frozen; only the alias goes) |

#### 3j. Names that break VB-1, VB-2, CS-1 or RW-1

Renames and aspect moves, no behaviour change; whether they ship at all is [Q9](#q9-do-pure-renames-ship).

| Current                                     | Target                                                                                     | Release note                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `task comment <task> <body>`                | `task comment add [<task>] <body>`                                                         | `task comment <task> <body>` removed → use `task comment add`                  |
| `task comments edit <task> <id> <body>`     | `task comment update <task> <id> <body>`                                                   | `task comments edit` removed → use `task comment update`                       |
| `task comments rm <task> <id>`              | `task comment delete <task> <id>`                                                          | `task comments rm` removed → use `task comment delete`                         |
| `task deps add <task> --blocked-by`         | `task dep add [<task>] --blocked-by`                                                       | `task deps add` removed → use `task dep add`                                   |
| `task deps list <task>`                     | `task show [<task>] --deps`                                                                | `task deps list` removed → use `task show --deps`                              |
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

### Batch 4 — Codex rules from the grammar

No command changes its name. `cli/src/lib/codex-rules.ts` stops keeping its own lists and is generated from per-command metadata in `grammar.json` (CX-1). Release note: none, as long as the generated `.rules` file is identical for unchanged commands.

### Not affected

Every other leaf keeps its name and flags: `audit list`, `auth login/logout`, `crossing disposition/explain/list`, `doc append/create/delete/diff/import-gdoc/list/move/patch/show/sync/update` (except the flags above), `doctor`, `finding disposition`, all `hook *`, `init` (except Q6), `member list`, `milestone add/archive/create/delete/list/move/remove/reorder/show/triage/unarchive/update`, `project create/list/update`, `session attach/status`, `skill status`, `sprint add/close/create/delete/list/remove/show/start/update`, `tag create/list`, `task artifact add/list/show/update`, `task create/decide/delete/list/search/statuses/update`, `task figma add/list/refresh`, `task pr show`, `task slack show`, `task web show`, `task template create/list/show`, `uninstall`, `update`, `whoami`, `worktree add/list/prune/rm`.

### Counts

"Names removed" are leaf commands that stop existing; "new names" are leaves that did not exist before; "flag-only" rows keep the command name.

| Batch | Rows | Names removed                          | New names | Flag-only rows |
| ----- | ---- | -------------------------------------- | --------- | -------------- |
| 1     | 10   | 8                                      | 0         | 2              |
| 3a    | 16   | 16                                     | 8         | 0              |
| 3b    | 8    | 7                                      | 4         | 1              |
| 3c    | 5    | 5                                      | 0         | 0              |
| 3d    | 4    | 0                                      | 1         | 4              |
| 3e    | 3    | 2                                      | 1         | 1              |
| 3f    | 5    | 3 (+ `priority` stops being invokable) | 2         | 0              |
| 3g    | 28   | 1                                      | 0         | 27             |
| 3h    | 2    | 0                                      | 0         | 1              |
| 3i    | 11   | 0                                      | 0         | 11             |
| 3j    | 22   | 18                                     | 15        | 3              |
| 4     | 0    | 0                                      | 0         | 0              |

Leaf commands excluding `hook *`: **149 today → 119** after batches 1 and 3 (30 fewer), and 5 fewer top-level commands, 32 → 27 (`outcome`, `inbox`, `draft`, `cost`, `report`, `next`, `setup` go; `testcase` and `status` arrive). If Q8 picks `pr show`, one more rename, same count. Each batch's PR prints the exact grammar diff.

---

## 13. Rollout batches

| Order | Batch | Scope                                                | Branch                                | Depends on                                        |
| ----- | ----- | ---------------------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| 0     | —     | this document                                        | `lumo/LUM-1233-cli-command-structure` | —                                                 |
| 1     | 1     | one way to read a task                               | `lumo/LUM-1233-read-entry`            | this document agreed                              |
| 2     | 3a–3j | merges, renames, flag clean-up; one PR per sub-batch | `lumo/LUM-1233-<sub-batch>`           | batch 1 (3j's `task show --deps` needs AF-1)      |
| 3     | 4     | Codex rules from the grammar                         | `lumo/LUM-1233-codex-rules`           | can go before batch 3 to make its renames cheaper |

Batch 2 of the original plan (aliases) is cancelled by the 2026-10-18 ruling.

**LUM-1232.** The brief asked batch 1 to be ordered against LUM-1232 batch D, and batch 3 to follow LUM-1232 batches A and B. As of `origin/main` `ab6a353d6` (2026-10-18) all seven LUM-1232 batches (D, G, E, A, B, F, C) are merged, so there is no open PR to order against; batches here start from its output rules.

**Every batch**: tests that fail before it; before/after output from a worktree build of the CLI; `SKILL.md` and `references/` updated (catalog stays one line per domain; the body budget is ~30k characters); grammar regenerated; doc-examples test green; every RN-2 step done. No version bump and no release per batch: the CLI is released once, when the milestone is done, with all release-note lines from §12.

---

## 14. Open questions

Each needs the user's ruling before the batch that depends on it. The recommendation is the draft's default.

### Q1. Name of the summary that replaces `inbox`, `draft` and `next`

- **Options:** (a) `lumo status` — sections Inbox, Drafts, Next, with `--inbox`, `--drafts`, `--next` to pick one; (b) `lumo inbox` with `--drafts` and `--next`; (c) `lumo home`; (d) keep three commands, renamed to `inbox list`, `draft list`, `task list --next`.
- **Recommendation: (a) `lumo status`.** It is `gh status` (assigned work, review requests and mentions in one call), so it is the name an agent guesses first, and it is one call instead of three. The risk is confusion with `task status` and `session status`; the help text of each says which scope it covers, and the three never take the same arguments (`lumo status` takes no task ref).

### Q2. Where `priority` lives

Today `lumo priority [text]` is a group that writes (and prompts interactively without text), with `priority list` under it. It was not called in 30 days.

- **Options:** (a) `priority create <text>` and `priority list`, plus the current priority as one line in `lumo status`; (b) only `lumo status` shows it, and writing it moves to the web; (c) under a project: `project update --priority`.
- **Recommendation: (a).** Smallest change that satisfies CS-2 (no invokable group) and CF-1 (no interactive prompt); keeps the append-only history readable from the CLI. (c) is wrong because the priority is a team declaration, not a project field.

### Q3. Arguments of the top-level `testcase`

`task testcase run` is the most called command (1,815). Its handle `LUM-42/TC3` is well learned.

- **Options:**
  - (a) **Task cases keep the handle; milestone cases use a flag.** `testcase list [<task>]`, `testcase add [<task>] --title …`, `testcase run <task>/TC<n>` or `testcase run TC<n>` (bound task); milestone: `testcase list --milestone <m>`, `testcase run TC<n> --milestone <m>`.
  - (b) **Owner always a flag.** `testcase run TC3 --task LUM-42`, `testcase run TC3 --milestone m1`.
  - (c) **One handle for both.** `LUM-42/TC3` and `m1/TC3`, told apart by shape.
- **Recommendation: (a).** The common call only loses the word `task` (`lumo testcase run LUM-42/TC3 …`), which is exactly what agents already guessed 19+ times. (b) makes the most frequent call longer. (c) is ambiguous because milestone slugs are free text and can look like task refs.

### Q4. What a removed command prints

Not an alias: the command fails either way, with exit 2.

- **Options:** (a) plain `Error: unknown command 'context'` (Commander's default, with its generic "did you mean" when the spelling is close); (b) a tombstone: `Error: lumo task context was removed in 1.N. Use: lumo task show --full`, also under `--json` as `{"error":{"code":"COMMAND_REMOVED",…}}`.
- **Recommendation: (b).** Skill copies in customer repos lag the CLI (`skill update` skips locally edited copies and never downgrades), so agents with an old `SKILL.md` will keep calling removed names after an upgrade; one line saves them a `--help` round trip and a guess. Keep it honest: tombstones are hidden from help and from `grammar.json`, never run anything, live in one table that also feeds the release notes and the skill's "do not exist" list, and are dropped after two minor releases.
- If the user rejects (b), RN-3 stays as written: unknown command, exit 2.

### Q5. What `task show --full` prints

`task context` prints Markdown (output conventions Q7 kept it that way, because it is pasted into a model's context); `task show` uses the plain detail layout (D-1–D-3). `task context --full` additionally prints every memory body.

- **Options for the format:** (a) `task show --full` prints the detail view, then the old context body unchanged as Markdown sections; (b) all of it converted to the detail layout; (c) all Markdown.
- **Options for memory bodies:** (i) `--full` keeps the one-line memory index, and a new aspect flag `--memory` prints the full bodies (old `task context --full`); (ii) `--full` always prints full bodies.
- **Recommendation: (a) + (i).** (a) is the only one that keeps both LUM-1232 rulings and lets the batch-1 test compare the old context output section by section. (i) keeps the default `--full` call at today's `task context` size; full memory bodies are rare and expensive.

### Q6. The boolean `--project` on `init` and `skill update`

`init`, `setup` and `skill update` use `--project` as a boolean ("install into this repo"), which collides with a global `--project <ref>`. `init` is on the frozen list.

- **Options:** (a) rename to `--scope project|user`, as `uninstall --scope` already does; (b) keep the booleans and exempt these commands from the global flag; (c) give the global flag another name (`--in-project`).
- **Recommendation: (a).** One flag, one meaning (GF-1). The `init` command name, its effect and the hook names it writes are unchanged, so the freeze's reason (installed settings depend on the names) is not touched; only the user-typed flag changes, with a release note. Asking because `init` is frozen.

### Q7. Shape of `usage` and the `--apply` switch on `usage resync`

- **`cost` + `report`:** `cost` groups token cost by tool/model/member/session over an ISO-date window; `report` gives team totals per member over local days plus a completed-task list. **Recommendation:** one `usage show` with `--by` (default `tool`), the window flags of `report` (`--since`, `--until`, local days), and `--tasks` to append the completed-task list. Alternative: two verbs, `usage show` and `usage report` (`report` would be a new domain verb).
- **`usage resync --apply`:** today a dry run unless `--apply`. RW-2 says writes run when called and preview with `--dry-run`. **Recommendation:** `usage resync` applies; `--dry-run` previews; `--apply` is removed. Alternative: keep the safe default by making it a gated write (exit 4 + `--confirm`), which means an agent could no longer run it without the user.

### Q8. Keep `pr scan`, or rename it to `pr show`

The brief keeps `pr scan` as the read and adds `pr review` for writes. Agents guessed `pr show` 7 times, and the task-side equivalent becomes `task show --scans`.

- **Options:** (a) keep `pr scan <n>` (read only); (b) rename to `pr show <n>` (scans are what a Lumo PR record shows), so the noun's read verb is `show` like everywhere else.
- **Recommendation: (b)**, in the same 3d PR, because "scan" reads like an action (it sounds like it starts a scan), and `show` is the core read verb (VB-1). This is a rename, not an alias: `pr scan` would be removed with a release note. If the user prefers the brief's wording, (a) is fine and `scan` stays in the domain-verb table.

### Q9. Do pure renames ship

Sub-batch 3j renames commands only to satisfy VB-1/VB-2/CS-1 (`rm` → `delete`, `edit` → `update`, `comments` → `comment`, `deps` → `dep`, `overview` → `show`), without merging anything. With no aliases, each one breaks a habit and old skill copies.

- **Options:** (a) ship all of 3j; (b) ship only the renames inside nouns that batch 3 already touches (`memory`, `testcase`), leave the rest as listed exceptions; (c) none.
- **Recommendation: (a).** The point of the convention is that an agent can predict a name from the rules; every exception is one more thing `SKILL.md` has to spell out. The renamed commands are mostly rarely called (`task comments edit` 3, `task template rm` 1, `task deps rm` 0), so the habit cost is low. `worktree rm` stays an exception because it is frozen, and `task statuses` because `task status` is taken.
