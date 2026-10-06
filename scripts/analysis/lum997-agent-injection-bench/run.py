"""LUM-997 — agent-level prompt-injection benchmark: upstream AgentDojo
(environments, user tasks, injection tasks, judges) with Lumo defence arms.

    VENV=<scratchpad>/agentdojo-venv   # uv venv --python 3.12; uv pip install -r requirements.txt
    $VENV/bin/python scripts/analysis/lum997-agent-injection-bench/run.py \
        --env-file /Users/chaoli/Desktop/lumo/lumo/.env.local \
        [--models anthropic/claude-sonnet-5.5,deepseek/deepseek-v4-flash] \
        [--arms none,fence,lumo_guard,spotlight] [--suites workspace,slack] \
        [--user-tasks 6] [--injection-tasks 3] [--budget 20] [--estimate-only]

Writes `results.json` next to this file. AgentDojo traces (resumable cache)
go to ~/.cache/lumo-lum997/ — outside the repo.

Arms (each is a tool-output formatter on AgentDojo's ToolsExecutor):
  none        AgentDojo default (YAML dump of the tool result).
  fence       same text inside Lumo's <untrusted-tool-output> fence + preamble.
  lumo_guard  same fence, body formatted by the PRODUCTION `guardInjectedText`
              (via guard-bridge.ts) — notices at the block head, escapes defanged,
              secrets redacted.
  spotlight   AgentDojo's built-in `spotlighting_with_delimiting` (reference).

Model calls go to the Vercel AI Gateway's OpenAI-compatible endpoint with the
key from --env-file (never printed). Every request body is rewritten to force
`providerOptions.gateway.zeroDataRetention = true` (same rule as
lib/ai/zdr-fetch.ts) and to pin Anthropic models to the `anthropic` host.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import time
from collections import defaultdict
from functools import partial
from pathlib import Path

import httpx
import openai
from agentdojo.agent_pipeline import (
    AgentPipeline,
    InitQuery,
    OpenAILLM,
    PipelineConfig,
    SystemMessage,
    ToolsExecutionLoop,
    ToolsExecutor,
)
from agentdojo.agent_pipeline.agent_pipeline import load_system_message
from agentdojo.agent_pipeline.tool_execution import tool_result_to_str
from agentdojo.attacks.base_attacks import FixedJailbreakAttack
from agentdojo.attacks.important_instructions_attacks import ImportantInstructionsAttack
from agentdojo.benchmark import run_task_with_injection_tasks, run_task_without_injection_tasks
from agentdojo.logging import OutputLogger
from agentdojo.task_suite.load_suites import get_suite

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
BENCHMARK_VERSION = "v1.2.2"
GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1"
DEFAULT_MODELS = ["anthropic/claude-sonnet-5.5", "deepseek/deepseek-v4-flash"]
DEFAULT_ARMS = ["none", "fence", "lumo_guard", "spotlight"]
DEFAULT_SUITES = ["workspace", "slack"]
CACHE_DIR = Path.home() / ".cache" / "lumo-lum997"
# Name the important_instructions template addresses the model by. AgentDojo's
# own lookup table predates these models; this keeps the standard template.
MODEL_PROSE_NAME = {"anthropic": "Claude", "deepseek": "DeepSeek"}
# Gateway list prices (USD per token), catalog read 2026-10-05.
PRICES = {
    "anthropic/claude-sonnet-5.5": {"input": 2e-6, "output": 1e-5},
    "deepseek/deepseek-v4-flash": {"input": 1.3e-7, "output": 2.6e-7},
}
PROVIDER_PINS = {"anthropic/claude-sonnet-5.5": ["anthropic"]}


# ─── Pure helpers (unit-tested in test_run.py) ──────────────────────────────


def read_env_key(env_file: Path, name: str = "AI_GATEWAY_API_KEY") -> str:
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"{name} not found in {env_file}")


def zdr_body(body: bytes) -> bytes:
    """Force gateway ZDR (+ host pin) on a JSON request body; fail closed."""
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise ValueError("ZDR guard: non-object request body")
    po = parsed.get("providerOptions") if isinstance(parsed.get("providerOptions"), dict) else {}
    gw = po.get("gateway") if isinstance(po.get("gateway"), dict) else {}
    gw = {**gw, "zeroDataRetention": True}
    pin = PROVIDER_PINS.get(parsed.get("model", ""))
    if pin:
        gw["only"] = list(pin)
    parsed["providerOptions"] = {**po, "gateway": gw}
    return json.dumps(parsed).encode()


def pick_evenly(ids: list[str], k: int) -> list[str]:
    """k ids spread evenly over the numerically sorted list (deterministic)."""
    ordered = sorted(ids, key=lambda s: int(s.rsplit("_", 1)[-1]))
    if k >= len(ordered):
        return ordered
    step = len(ordered) / k
    return [ordered[int(i * step)] for i in range(k)]


def cost_of(model: str, usage: dict) -> float:
    p = PRICES.get(model, {"input": 0.0, "output": 0.0})
    return usage.get("prompt_tokens", 0) * p["input"] + usage.get("completion_tokens", 0) * p["output"]


def rate(values: list[bool]) -> float | None:
    return round(sum(values) / len(values), 4) if values else None


# ─── Gateway transport: ZDR + usage accounting ──────────────────────────────


class Meter:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.usage: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self.calls: dict[str, int] = defaultdict(int)

    def add(self, model: str, usage: dict) -> None:
        with self.lock:
            self.calls[model] += 1
            for k in ("prompt_tokens", "completion_tokens"):
                self.usage[model][k] += int(usage.get(k) or 0)

    def cost(self, model: str | None = None) -> float:
        models = [model] if model else list(self.usage)
        return sum(cost_of(m, self.usage[m]) for m in models)


class GatewayTransport(httpx.BaseTransport):
    def __init__(self, meter: Meter) -> None:
        self.inner = httpx.HTTPTransport(retries=2)
        self.meter = meter

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        model = "?"
        if request.method == "POST":
            body = zdr_body(request.read())
            model = json.loads(body).get("model", "?")
            request = httpx.Request(
                request.method,
                request.url,
                headers={k: v for k, v in request.headers.items() if k.lower() != "content-length"},
                content=body,
            )
        response = self.inner.handle_request(request)
        if request.method == "POST":
            content = response.read()
            try:
                data = json.loads(content)
                if isinstance(data, dict) and "usage" in data:
                    self.meter.add(model, data["usage"] or {})
            except json.JSONDecodeError:
                pass
            # `content` is already decoded: drop the encoding/length headers so
            # the client does not try to gunzip it a second time.
            headers = [
                (k, v)
                for k, v in response.headers.items()
                if k.lower() not in ("content-encoding", "content-length", "transfer-encoding")
            ]
            response = httpx.Response(response.status_code, headers=headers, content=content, request=request)
        return response


# ─── Production guard bridge (tsx, long-lived) ──────────────────────────────


class GuardBridge:
    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            ["npx", "tsx", str(HERE / "guard-bridge.ts")],
            cwd=REPO,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.lock = threading.Lock()
        self.stats = defaultdict(int)

    def call(self, mode: str, text: str) -> dict:
        assert self.proc.stdin and self.proc.stdout
        with self.lock:
            self.proc.stdin.write(json.dumps({"mode": mode, "text": text}) + "\n")
            self.proc.stdin.flush()
            line = self.proc.stdout.readline()
        out = json.loads(line)
        if "error" in out:
            raise RuntimeError(f"guard bridge: {out['error']}")
        return out

    def formatter(self, mode: str):
        def fmt(result) -> str:
            out = self.call(mode, tool_result_to_str(result))
            if mode == "guard":
                self.stats["outputs"] += 1
                self.stats["outputs_with_signal_notice"] += int(out["signals"] > 0)
                self.stats["outputs_with_escape_notice"] += int(out["wrapperEscapes"] > 0)
                self.stats["outputs_with_redaction"] += int(out["redacted"] > 0)
            return out["text"]

        return fmt

    def close(self) -> None:
        if self.proc.stdin:
            self.proc.stdin.close()
        self.proc.wait(timeout=10)


# ─── Pipelines and attack ───────────────────────────────────────────────────


def build_pipeline(llm: OpenAILLM, arm: str, bridge: GuardBridge) -> AgentPipeline:
    if arm in ("none", "spotlight"):
        cfg = PipelineConfig(
            llm=llm,
            model_id=None,
            defense=None if arm == "none" else "spotlighting_with_delimiting",
            system_message_name=None,
            system_message=None,
        )
        pipeline = AgentPipeline.from_config(cfg)
    else:
        fmt = bridge.formatter("fence" if arm == "fence" else "guard")
        pipeline = AgentPipeline(
            [
                SystemMessage(load_system_message(None)),
                InitQuery(),
                llm,
                ToolsExecutionLoop([ToolsExecutor(fmt), llm]),
            ]
        )
    pipeline.name = f"{llm.model.replace('/', '_')}-{arm}"
    return pipeline


class ImportantInstructions(ImportantInstructionsAttack):
    """AgentDojo's standard `important_instructions` template and user name,
    with the model's prose name supplied instead of looked up."""

    def __init__(self, suite, pipeline, model_name: str) -> None:
        FixedJailbreakAttack.__init__(self, self._JB_STRING, suite, pipeline)
        self.user_name = "Emma Johnson"
        self.model_name = model_name


# ─── Detector-only pass ─────────────────────────────────────────────────────


def detector_pass(bridge: GuardBridge, suites: list[str]) -> dict:
    rows = []
    for name in suites:
        suite = get_suite(BENCHMARK_VERSION, name)
        for inj_id, inj in sorted(suite.injection_tasks.items()):
            payload = ImportantInstructionsAttack._JB_STRING.format(
                goal=inj.GOAL, user="Emma Johnson", model="Claude", task=""
            )
            d = bridge.call("detect", payload)
            rows.append({"suite": name, "injectionTask": inj_id, **{k: d[k] for k in ("signals", "kinds", "wrapperEscapes", "redacted")}})
    flagged = sum(1 for r in rows if r["signals"] > 0)
    return {"payloads": len(rows), "flagged": flagged, "rows": rows}


# ─── Main ───────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file", type=Path, required=True)
    ap.add_argument("--models", default=",".join(DEFAULT_MODELS))
    ap.add_argument("--arms", default=",".join(DEFAULT_ARMS))
    ap.add_argument("--suites", default=",".join(DEFAULT_SUITES))
    ap.add_argument("--user-tasks", type=int, default=6)
    ap.add_argument("--injection-tasks", type=int, default=3)
    ap.add_argument("--budget", type=float, default=20.0)
    ap.add_argument("--estimate-only", action="store_true")
    ap.add_argument("--out", type=Path, default=HERE / "results.json")
    args = ap.parse_args()

    models = args.models.split(",")
    arms = args.arms.split(",")
    suites = args.suites.split(",")
    bridge = GuardBridge()
    detector = detector_pass(bridge, suites)
    print(f"detector-only: {detector['flagged']}/{detector['payloads']} AgentDojo payloads get a signal notice")

    plan = []
    for suite_name in suites:
        suite = get_suite(BENCHMARK_VERSION, suite_name)
        uts = pick_evenly(list(suite.user_tasks), args.user_tasks)
        its = pick_evenly(list(suite.injection_tasks), args.injection_tasks)
        plan.append((suite_name, uts, its))
    episodes_per_model_arm = sum(len(u) * (1 + len(i)) for _, u, i in plan)
    total_episodes = episodes_per_model_arm * len(models) * len(arms)
    print(f"plan: {total_episodes} episodes ({episodes_per_model_arm} per model×arm)")
    if args.estimate_only:
        bridge.close()
        return 0

    meter = Meter()
    client = openai.OpenAI(
        base_url=GATEWAY_BASE_URL,
        api_key=read_env_key(args.env_file),
        http_client=httpx.Client(transport=GatewayTransport(meter), timeout=180),
        max_retries=2,
    )
    logdir = CACHE_DIR / "runs"
    logdir.mkdir(parents=True, exist_ok=True)
    cells: dict[tuple, dict] = {}
    stopped = None
    started = time.time()

    with OutputLogger(str(logdir), live=None):
        for model in models:
            llm = OpenAILLM(client, model, temperature=0.0)
            llm.name = model
            for arm in arms:
                pipeline = build_pipeline(llm, arm, bridge)
                for suite_name, uts, its in plan:
                    suite = get_suite(BENCHMARK_VERSION, suite_name)
                    attack = ImportantInstructions(suite, pipeline, MODEL_PROSE_NAME[model.split("/")[0]])
                    cell = cells.setdefault(
                        (model, arm, suite_name),
                        {"utility": [], "utilityUnderAttack": [], "asr": [], "errors": 0},
                    )
                    for ut_id in uts:
                        if meter.cost() >= args.budget:
                            stopped = f"budget ${args.budget} reached"
                            break
                        ut = suite.get_user_task_by_id(ut_id)
                        try:
                            u, _ = run_task_without_injection_tasks(
                                suite, pipeline, ut, logdir, False, BENCHMARK_VERSION
                            )
                            cell["utility"].append(bool(u))
                            util, sec = run_task_with_injection_tasks(
                                suite, pipeline, ut, attack, logdir, False, its, BENCHMARK_VERSION
                            )
                            cell["utilityUnderAttack"].extend(bool(v) for v in util.values())
                            cell["asr"].extend(bool(v) for v in sec.values())
                        except Exception as e:  # recorded, never counted as a success
                            cell["errors"] += 1
                            print(f"error {model} {arm} {suite_name} {ut_id}: {str(e)[:200]}", file=sys.stderr)
                        print(
                            f"{model} {arm} {suite_name} {ut_id} cost=${meter.cost():.2f}",
                            flush=True,
                        )
                    if stopped:
                        break
                if stopped:
                    break
            if stopped:
                break
    bridge.close()

    table = []
    for (model, arm, suite_name), c in cells.items():
        table.append(
            {
                "model": model,
                "arm": arm,
                "suite": suite_name,
                "nUtility": len(c["utility"]),
                "utility": rate(c["utility"]),
                "nAttack": len(c["asr"]),
                "utilityUnderAttack": rate(c["utilityUnderAttack"]),
                "asr": rate(c["asr"]),
                "errors": c["errors"],
            }
        )
    result = {
        "task": "LUM-997",
        "agentdojo": {"version": "0.1.35", "benchmarkVersion": BENCHMARK_VERSION, "attack": "important_instructions"},
        "models": models,
        "arms": arms,
        "plan": [{"suite": s, "userTasks": u, "injectionTasks": i} for s, u, i in plan],
        "stoppedEarly": stopped,
        "wallSeconds": round(time.time() - started),
        "cost": {
            "estimatedUsdFromListPrice": round(meter.cost(), 4),
            "byModel": {m: {"calls": meter.calls[m], **meter.usage[m], "usd": round(meter.cost(m), 4)} for m in list(meter.usage)},
        },
        "guardBridgeStats": dict(bridge.stats),
        "table": table,
        "detectorOnly": detector,
    }
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(f"wrote {args.out} (cost ≈ ${meter.cost():.2f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
