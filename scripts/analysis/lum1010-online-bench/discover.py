"""LUM-1010 — discover recent merged PRs that a review bot reviewed, into the
Martian online-ETL database, cheaply.

The ETL's own `discover` bisects each day's window until it fits the Search
API's 1,000-result cap, which for CodeRabbit-sized bots means hundreds of
rate-limited queries per day. For a benchmark sample we only need a handful
per bot per day, so this issues ONE search per (bot, day), takes the first
page, and samples from it:

  - at most --per-repo PRs per repository across ALL bots (no repo dominates),
  - each PR assigned to only one bot (the first that picks it), so a PR is
    scored once,
  - --per-day PRs per (bot, day), random sample with a fixed seed.

Run from the ETL directory (it imports the ETL's db layer):

  cd <crb>/online/etl && uv run python <this file> \
    --bots 'coderabbitai[bot],augmentcode[bot]' --start 2026-09-22 --end 2026-09-28 \
    --per-day 3 [--per-repo 1] [--seed 1010]

Needs DATABASE_URL and GITHUB_TOKEN in the environment.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import date, timedelta
import os
import random
import sys
import time

import httpx

sys.path.insert(0, os.getcwd())
from db.connection import DBAdapter  # noqa: E402
from db.repository import PRRepository  # noqa: E402
from db.schema import create_tables  # noqa: E402
from pipeline.discover import _parse_search_item  # noqa: E402
from pipeline.volumes import SEARCH_API_USERNAME_MAP  # noqa: E402

SEARCH_SLEEP_S = 2.5  # authenticated Search API: 30 requests / minute


def search(client: httpx.Client, query: str) -> list[dict]:
    for attempt in range(4):
        r = client.get("https://api.github.com/search/issues", params={"q": query, "per_page": "100"})
        if r.status_code in (403, 429):
            wait = int(r.headers.get("retry-after", "0") or 0) or 30 * (attempt + 1)
            print(f"  rate limited, waiting {wait}s", flush=True)
            time.sleep(wait)
            continue
        r.raise_for_status()
        return r.json().get("items", [])
    return []


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bots", required=True)
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--per-day", type=int, default=3)
    ap.add_argument("--per-repo", type=int, default=1)
    ap.add_argument("--seed", type=int, default=1010)
    a = ap.parse_args()

    rng = random.Random(a.seed)
    db = DBAdapter(os.environ["DATABASE_URL"])
    await db.connect()
    await create_tables(db)
    repo = PRRepository(db)

    # Seed the caps with what earlier runs already inserted.
    rows = await db.fetchall("SELECT repo_name, pr_number FROM prs")
    repo_count: dict[str, int] = {}
    taken: set[tuple[str, int]] = set()
    for row in rows:
        repo_count[row["repo_name"]] = repo_count.get(row["repo_name"], 0) + 1
        taken.add((row["repo_name"], row["pr_number"]))

    headers = {"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": "application/vnd.github+json"}
    start, end = date.fromisoformat(a.start), date.fromisoformat(a.end)
    with httpx.Client(headers=headers, timeout=30) as client:
        for bot in [b.strip() for b in a.bots.split(",") if b.strip()]:
            chatbot_id = await repo.upsert_chatbot(bot)
            # The Search API wants the full app login, `[bot]` included.
            search_name = SEARCH_API_USERNAME_MAP.get(bot, bot)
            inserted = 0
            d = start
            while d <= end:
                q = f"type:pr reviewed-by:{search_name} is:merged merged:{d.isoformat()}"
                items = [_parse_search_item(i) for i in search(client, q)]
                time.sleep(SEARCH_SLEEP_S)
                rng.shuffle(items)
                picked = 0
                for pr in items:
                    if picked >= a.per_day:
                        break
                    key = (pr["repo_name"], pr["pr_number"])
                    if key in taken or repo_count.get(pr["repo_name"], 0) >= a.per_repo:
                        continue
                    ok = await repo.insert_pr(
                        chatbot_id=chatbot_id,
                        repo_name=pr["repo_name"],
                        pr_number=pr["pr_number"],
                        pr_url=pr["pr_url"],
                        pr_title=pr["pr_title"],
                        pr_author=pr["pr_author"],
                        pr_created_at=pr["pr_created_at"],
                        pr_merged=pr["pr_merged"],
                        status="pending",
                        bq_events=None,
                        bot_reviewed_at=pr.get("bot_reviewed_at"),
                    )
                    if ok:
                        taken.add(key)
                        repo_count[pr["repo_name"]] = repo_count.get(pr["repo_name"], 0) + 1
                        picked += 1
                        inserted += 1
                print(f"{bot} {d} results={len(items)} picked={picked}", flush=True)
                d += timedelta(days=1)
            print(f"{bot}: inserted {inserted}", flush=True)
    # aiosqlite leaves the last implicit transaction open; close() alone drops it.
    if db._sqlite_conn:
        await db._sqlite_conn.commit()
    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
