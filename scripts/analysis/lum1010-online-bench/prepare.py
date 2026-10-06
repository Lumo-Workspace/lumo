"""LUM-1010 — turn analysed online-ETL PRs into the LUM-988 replay layout, at
the commit the bot reviewed.

For every PR the ETL analysed (`llm_analyses` row), it takes the commit the
bot reviewed — the ETL's own `_find_bot_review_commit` ("hash X") — and
writes what Lumo's AI review would have seen at that moment:

  <out>/prs.json                 PR urls, the replay scripts' input
  <out>/meta.json                url → { bot, hashX, base, actions }
  <out>/<prKey>/diff.patch       base...hashX (three-dot, GitHub compare API)
  <out>/<prKey>/files/<path>     every changed file at hashX (≤ 200 KB)
  <checkouts>/co/<prKey>         detached worktree at hashX (verifier's shell)

Reviewing hashX, not the merged head, is the point: the commits after the bot
review are where the human fixes (the ground truth) live.

Run from the ETL directory (imports its analysis helpers):

  cd <crb>/online/etl && uv run python <this file> --out <data dir> --checkouts <root>

Needs DATABASE_URL, a logged-in `gh` and `git`. Re-running skips what exists.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import re
import subprocess
import sys

sys.path.insert(0, os.getcwd())
from db.connection import DBAdapter  # noqa: E402
from pipeline.analyze import _find_bot_review_commit  # noqa: E402

MAX_FILE_BYTES = 200_000  # REVIEW_CONTEXT_MAX_FILE_CHARS: the packer never includes bigger files


def pr_key(url: str) -> str:
    """Same as scripts/analysis/lum988-code-review-replay/pr-key.ts."""
    return re.sub(r"[^a-zA-Z0-9]+", "_", url)


def gh(args: list[str], accept: str | None = None) -> bytes:
    head = ["-H", f"Accept: {accept}"] if accept else []
    return subprocess.run(["gh", "api", *head, *args], check=True, capture_output=True).stdout


def git(cwd: Path, args: list[str]) -> str:
    # LFS repos: keep the pointer files instead of needing git-lfs to smudge them.
    lfs_off = ["-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false"]
    return subprocess.run(["git", *lfs_off, *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


def changed_paths(diff: str) -> list[str]:
    """Paths a unified diff adds or modifies (deleted files have `+++ /dev/null`)."""
    paths = []
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            paths.append(line[len("+++ b/"):].rstrip("\t"))
    return paths


def col(row: dict, name: str) -> list | dict:
    raw = row.get(name)
    if raw is None:
        return []
    return json.loads(raw) if isinstance(raw, str) else raw


def checkout(root: Path, repo_name: str, sha: str, dest: Path) -> None:
    if dest.exists():
        return
    repo_dir = root / "repos" / repo_name.replace("/", "_")
    if not repo_dir.exists():
        repo_dir.mkdir(parents=True)
        git(repo_dir, ["init", "-q"])
        git(repo_dir, ["remote", "add", "origin", f"https://github.com/{repo_name}.git"])
    git(repo_dir, ["fetch", "-q", "--depth", "1", "origin", sha])
    git(repo_dir, ["worktree", "add", "-q", "--detach", str(dest), sha])


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--checkouts", required=True)
    a = ap.parse_args()
    out, root = Path(a.out), Path(a.checkouts)
    (root / "co").mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)

    db = DBAdapter(os.environ["DATABASE_URL"])
    await db.connect()
    rows = await db.fetchall(
        "SELECT p.*, c.github_username AS bot, a.human_actions FROM prs p "
        "JOIN chatbots c ON c.id = p.chatbot_id JOIN llm_analyses a ON a.pr_id = p.id "
        "ORDER BY p.id"
    )
    await db.close()

    urls: list[str] = []
    meta: dict[str, dict] = {}
    for row in rows:
        url = row["pr_url"]
        repo_name, num = row["repo_name"], row["pr_number"]
        assembled = col(row, "assembled") or {}
        hash_x = _find_bot_review_commit(
            col(row, "reviews"), assembled.get("events", []), col(row, "commits"), row["bot"]
        )
        if not hash_x:
            print(f"{repo_name}#{num} SKIP no hashX", flush=True)
            continue
        d = out / pr_key(url)
        try:
            pr = json.loads(gh([f"repos/{repo_name}/pulls/{num}"]))
            base = pr["base"]["sha"]
            if not (d / "diff.patch").exists():
                (d / "files").mkdir(parents=True, exist_ok=True)
                (d / "diff.patch").write_bytes(
                    gh([f"repos/{repo_name}/compare/{base}...{hash_x}"], "application/vnd.github.diff")
                )
            co = root / "co" / pr_key(url)
            checkout(root, repo_name, hash_x, co)
            fetched = 0
            # From the diff, not the compare JSON: that one lists at most 300 files.
            for filename in changed_paths((d / "diff.patch").read_text(errors="replace")):
                src, dest = co / filename, d / "files" / filename
                if src.is_file() and src.stat().st_size <= MAX_FILE_BYTES:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(src.read_bytes())
                    fetched += 1
        except subprocess.CalledProcessError as e:
            msg = (e.stderr or b"")[:160]
            print(f"{repo_name}#{num} SKIP {msg!r}", flush=True)
            continue
        except (OSError, ValueError, KeyError) as e:  # bad JSON, missing field, file I/O: skip this PR only
            print(f"{repo_name}#{num} SKIP {type(e).__name__}: {str(e)[:160]}", flush=True)
            continue
        urls.append(url)
        meta[url] = {
            "bot": row["bot"],
            "hashX": hash_x,
            "base": base,
            "actions": len(col(row, "human_actions")),
        }
        print(f"{repo_name}#{num} bot={row['bot']} hashX={hash_x[:10]} files={fetched}", flush=True)

    (out / "prs.json").write_text(json.dumps(urls, indent=1))
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"wrote {len(urls)} PRs to {out}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
