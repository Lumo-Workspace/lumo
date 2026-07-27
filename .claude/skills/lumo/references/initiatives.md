# Initiatives (team-level, `LUM-INIT-<n>`)

An **Initiative** is a team-level strategic goal that tasks roll up to. Two origins land in the same list:

- **Direct** — `lumo initiative create`, no plan run required (`planRunId = null`, status `ACTIVE`).
- **Materialised** — produced by the `lumo plan` converter's gate C, carrying its lineage (see [plan-runs.md](plan-runs.md)).

## `lumo initiative create "<goal>" [--assumption <text>]`

Create an Initiative directly. Prints the `LUM-INIT-<n>` id. `--assumption` records the bet (赌注旁注) behind it — the thing that, if false, makes the initiative the wrong call. A blank goal is rejected (400).

**When to suggest**: the user wants to stand up a strategic initiative directly — "建一个 initiative", "create an initiative", "开一个举措" — without running the converter.

```bash
lumo initiative create "Ship the initiatives browse surface" --assumption "teams curate initiatives directly"
```

## `lumo initiative list`

Print the team's initiatives newest-first, one line each: the `LUM-INIT-<n>` id, status (`ACTIVE` | `DONE` | `DROPPED`) and goal.

Browsable in web at `/workspace/<slug>/initiatives` (sidebar → Initiatives), where each links to its lineage — the ideas it consumed and the tasks attached to it.

**When to suggest**: the user wants to see the team's initiatives ("看看 initiatives", "list the initiatives").

```bash
lumo initiative list
```
