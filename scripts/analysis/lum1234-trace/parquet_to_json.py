"""LUM-1234 — convert a local TRACE parquet copy into the adapter's JSON cache.

    uv run --with pyarrow python -I scripts/analysis/lum1234-trace/parquet_to_json.py <in.parquet> <out.json>

For a parquet copy obtained outside the datasets-server path (e.g. `hf download`
or a private mirror of a dataset you have access to). Writes a JSON array of
row objects — the same shape `--download` caches. Never write into the repo.
"""
import json
import sys

import pyarrow.parquet as pq


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    rows = pq.read_table(sys.argv[1]).to_pylist()
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False)
    print(f"{len(rows)} rows -> {sys.argv[2]}")


if __name__ == "__main__":
    main()
