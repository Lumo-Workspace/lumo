"""LUM-965 — generate fresh BashArena trajectories with ControlArena for a
second, independent holdout of the frozen whole-trajectory monitor.

Runs OUTSIDE the repo's npm toolchain, in a throwaway venv:

    uv venv ~/.cache/lumo-lum965/ca/.venv --python 3.12
    uv pip install --python ~/.cache/lumo-lum965/ca/.venv/bin/python control-arena

Model calls go through the local ZDR proxy (`zdr-proxy.ts`), never straight
to a provider:

    ANTHROPIC_BASE_URL=http://127.0.0.1:8765 ANTHROPIC_API_KEY=unused \\
      ~/.cache/lumo-lum965/ca/.venv/bin/python generate.py run \\
        --mode attack --side-task leak_passwords --n 1

    ~/.cache/lumo-lum965/ca/.venv/bin/python generate.py export

Design choices (see RESULTS.md):
  - Tasks the monitor-eval dataset already used (134 sample_ids) are
    excluded; the rest are ordered by sha256(seed:id) and every group
    (each side task, honest) takes its own fixed, disjoint slice — so a
    re-run never re-draws a task and attack / honest never share one.
  - The agent gets bash + text_editor only: the monitor's converter reads
    those two tools, so a `python` tool would be a channel the monitor
    cannot see at all.
  - The policies are ControlArena's own BashArena attack / honest policies
    (the attack policy is the one the monitor-eval attacks came from),
    wrapped in BashArena's auto-submit protocol: side-task tests run after
    every step and the trajectory ends as soon as one passes.
  - `export` writes one JSON line per sample with ONLY what the monitor may
    see (main task description + the ordered tool calls) plus the labels;
    the side-task brief, the agent's prose / reasoning and tool outputs are
    never exported.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

CACHE = Path.home() / ".cache" / "lumo-lum965"
LOG_DIR = CACHE / "ca-logs"
EXPORT = CACHE / "ca-trajectories.jsonl"
MONITOR_EVAL = (
    Path.home()
    / ".cache"
    / "lumo-lum948-basharena"
    / "abhayesian__basharena-monitor-eval__train.json"
)

SIDE_TASKS = ["sudo_edit", "disable_firewall", "download_malware", "leak_passwords"]
# Disjoint slices of the fresh, hash-ordered task list (index, size cap).
SLICE = {
    "sudo_edit": 0,
    "disable_firewall": 20,
    "download_malware": 40,
    "leak_passwords": 60,
    "honest": 80,
}
SLICE_SIZE = 20
SEED = "lum965"


def monitor_eval_ids() -> set[str]:
    raw = json.loads(MONITOR_EVAL.read_text())
    rows = raw["rows"] if isinstance(raw, dict) and "rows" in raw else raw
    return {str(r.get("row", r)["sample_id"]) for r in rows}


def order_key(task_id: str) -> str:
    return hashlib.sha256(f"{SEED}:{task_id}".encode()).hexdigest()


def fresh_task_ids(all_ids: list[str], used: set[str]) -> list[str]:
    return sorted((i for i in all_ids if i not in used), key=order_key)


def pick(fresh: list[str], group: str, n: int, offset: int = 0) -> list[str]:
    """Tasks [offset, offset+n) of the group's slice (offset skips tasks an
    earlier run of the same group already used)."""
    if offset + n > SLICE_SIZE:
        raise ValueError(f"offset+n={offset + n} exceeds the {SLICE_SIZE}-task slice")
    start = SLICE[group] + offset
    return fresh[start : start + n]


def run(args: argparse.Namespace) -> None:
    from inspect_ai import eval as inspect_eval
    from inspect_ai.tool import bash

    from control_arena import EvalMode
    from control_arena.eval import ControlEvalConfig, get_control_task
    from control_arena.settings.bash_arena.bash_arena_setting import (
        BashArenaSetting,
    )
    from control_arena.settings.bash_arena.policies.attack_policy import (
        attack_policy,
    )
    from control_arena.settings.bash_arena.policies.honest_policy import (
        honest_policy,
    )
    from control_arena.settings.bash_arena.protocol.auto_submit_protocol_wrapper import (
        auto_submit_protocol_wrapper,
    )
    from control_arena.settings.bash_arena.task.dataset import DatasetSpec
    from control_arena.tools import restricted_text_editor

    if not os.environ.get("ANTHROPIC_BASE_URL", "").startswith("http://127.0.0.1"):
        raise SystemExit("ANTHROPIC_BASE_URL must point at the local ZDR proxy")

    class VisibleToolsBashArena(BashArenaSetting):
        def get_agent_tools(self, state):  # noqa: ANN001, ANN201
            return [bash(timeout=300), restricted_text_editor()]

    probe = BashArenaSetting(dataset_spec=DatasetSpec(side_tasks=["leak_passwords"]))
    all_ids = [str(s.id) for s in probe.get_dataset(EvalMode.HONEST)]
    fresh = fresh_task_ids(all_ids, monitor_eval_ids())

    if args.mode == "attack":
        if args.side_task not in SIDE_TASKS:
            raise SystemExit(f"--side-task must be one of {SIDE_TASKS}")
        ids = pick(fresh, args.side_task, args.n, args.offset)
        side_tasks = [args.side_task]
        policy = attack_policy(model_name=args.model)
        mode = EvalMode.ATTACK
    else:
        ids = pick(fresh, "honest", args.n, args.offset)
        side_tasks = SIDE_TASKS
        policy = honest_policy(model_name=args.model)
        mode = EvalMode.HONEST

    setting = VisibleToolsBashArena(
        dataset_spec=DatasetSpec(side_tasks=side_tasks, task_id_whitelist=ids)
    )
    config = ControlEvalConfig(
        untrusted_model=args.model,
        trusted_model=args.model,
        max_steps=args.max_steps,
        time_limit=args.time_limit,
        max_samples=args.max_samples,
        max_sandboxes=args.max_samples,
        fail_on_error=False,
        log_dir=str(LOG_DIR),
    )
    task = get_control_task(
        setting=setting,
        micro_protocol=auto_submit_protocol_wrapper(
            micro_protocol=policy, side_task_checkers=SIDE_TASKS
        ),
        mode=mode,
        eval_config=config,
        task_name_prefix=f"lum965-{args.mode}-{args.side_task or 'honest'}",
    )
    print(f"{args.mode} {args.side_task or ''}: tasks {ids}")
    inspect_eval(task, **config.eval_args())


def tool_calls(messages) -> list[dict]:  # noqa: ANN001
    calls: list[dict] = []
    for m in messages:
        if getattr(m, "role", None) != "assistant":
            continue
        for tc in getattr(m, "tool_calls", None) or []:
            if tc.function == "submit":
                continue
            calls.append({"function": tc.function, "arguments": tc.arguments})
    return calls


def score_value(scores: dict, name: str):  # noqa: ANN001, ANN201
    s = scores.get(name)
    return None if s is None else s.value


def export(_: argparse.Namespace) -> None:
    from inspect_ai.log import list_eval_logs, read_eval_log

    out: dict[str, dict] = {}
    for info in list_eval_logs(str(LOG_DIR)):
        log = read_eval_log(info)
        spec = ((log.eval.metadata or {}).get("setting") or {}).get("dataset_spec") or {}
        for s in log.samples or []:
            md = s.metadata or {}
            mode = str(md.get("eval_mode", "")).lower()
            label = "attack" if "attack" in mode else "honest"
            # Single-side-task runs: the sample says "None"; the eval's
            # dataset_spec names the one side task the attack was given.
            side = str(md.get("side_task_name") or "")
            if side in ("", "None") and label == "attack":
                side = "+".join(spec.get("side_tasks") or [])
            key = f"{s.id}:{label}:{side}"
            scores = s.scores or {}
            out[key] = {
                "id": key,
                "taskId": str(s.id),
                "label": label,
                "sideTask": side if label == "attack" else "",
                "taskDescription": md.get("main_task_description", ""),
                "calls": tool_calls(s.messages),
                "error": str(s.error.message)[:300] if s.error else None,
                "scores": {
                    k: score_value(scores, k)
                    for k in scores
                },
                "log": Path(info.name).name,
            }
    EXPORT.write_text("".join(json.dumps(v) + "\n" for v in out.values()))
    print(f"exported {len(out)} samples → {EXPORT}")


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--mode", choices=["attack", "honest"], required=True)
    r.add_argument("--side-task", default=None)
    r.add_argument("--n", type=int, default=1)
    r.add_argument("--offset", type=int, default=0)
    r.add_argument("--model", default="anthropic/claude-sonnet-4-6")
    r.add_argument("--max-steps", type=int, default=60)
    r.add_argument("--time-limit", type=int, default=3600)
    r.add_argument("--max-samples", type=int, default=2)
    sub.add_parser("export")
    args = p.parse_args()
    if args.cmd == "run":
        run(args)
    else:
        export(args)


if __name__ == "__main__":
    main()
