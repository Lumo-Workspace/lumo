# Plan runs (design-thinking 转换器)

A **plan run** turns the team's captured idea pool + the current priority declaration into an executable plan, through a 3-gate recoverable state machine: **聚类 → 对齐 → 成计划**.

The CLI only **triggers and reports**. All editing and gate confirmation happen in **web** — the CLI hands off a deep-link.

Inputs come from [ideas.md](ideas.md) (the `CAPTURED` pool) and [priority.md](priority.md) (the current declaration). Materialisation produces tasks plus, when the plan calls for one, an Initiative — see [initiatives.md](initiatives.md).

## `lumo plan [--abandon-active]`

Start a converter run. Freezes the input snapshot at start and enforces **one active run per team**: if a run is already active it refuses and points to `lumo plan status`. `--abandon-active` abandons the prior run first, then starts fresh.

On success it prints (and opens) the **gate-A** web deep-link, `/workspace/<slug>/plan/<runId>`.

Invoked bare (`lumo plan`) it starts a run; `lumo plan --abandon-active` clears a stuck one first. The command is a parent with its own action — `status` below is a subcommand added on top of it, not a required one.

**When to suggest**: the user wants to turn the parked idea pool into a plan — "跑一下转换器", "start a planning run", "把想法变成计划".

```bash
lumo plan
lumo plan --abandon-active
```

## `lumo plan status`

Print the active run's current stage — either the working segment or the open `*_READY` gate — plus the deep-link to act on its next gate. With no active run, prompts to run `lumo plan`.

**When to suggest**: the user asks where an in-flight run stands ("plan 到哪一步了", "plan status"). The gate work itself is web-only.

```bash
lumo plan status
```
