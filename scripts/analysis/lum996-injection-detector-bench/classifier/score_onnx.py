"""LUM-1007 — score texts with a local ONNX sequence classifier (CPU, offline).

    <venv>/bin/python score_onnx.py --model-dir <snapshot>/onnx \
        --in samples.jsonl --out scores.jsonl [--max-tokens 512] [--positive-label INJECTION]

Input: one {"key": str, "text": str} per line. Output: one
{"key", "prob", "chunks", "tokens", "ms"} per line, same order.

* ``prob`` is the positive-class softmax probability, maximised over chunks:
  a text longer than the model window is split into consecutive windows of
  ``max_tokens - 2`` content tokens (plus [CLS]/[SEP]) and is flagged if ANY
  chunk is (max), the way a production wrapper would have to do it.
* ``ms`` is wall-clock time for tokenisation + every chunk's forward pass,
  batch size 1, measured per sample.

Never touches the network: the model and tokenizer are read from
``--model-dir`` only. Dependencies: onnxruntime, tokenizers, numpy.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from typing import Iterable, List, Sequence


def chunk_ids(ids: Sequence[int], window: int) -> List[List[int]]:
    """Split content token ids into consecutive windows of at most ``window``.

    An empty input still yields one (empty) chunk so every text gets a score.
    """
    if window < 1:
        raise ValueError("window must be >= 1")
    if len(ids) == 0:
        return [[]]
    return [list(ids[i : i + window]) for i in range(0, len(ids), window)]


def with_specials(chunk: Sequence[int], cls_id: int, sep_id: int) -> List[int]:
    return [cls_id, *chunk, sep_id]


def softmax_positive(logits: Sequence[float], positive_index: int) -> float:
    m = max(logits)
    exps = [math.exp(x - m) for x in logits]
    return exps[positive_index] / sum(exps)


def max_prob(chunk_probs: Iterable[float]) -> float:
    """Any chunk flagged -> flagged: the sample's score is the max chunk score."""
    probs = list(chunk_probs)
    if not probs:
        raise ValueError("no chunk probabilities")
    return max(probs)


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-tokens", type=int, default=512)
    ap.add_argument("--positive-label", default="INJECTION")
    args = ap.parse_args(argv)

    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer

    with open(f"{args.model_dir}/config.json", encoding="utf-8") as f:
        id2label = {int(k): v for k, v in json.load(f)["id2label"].items()}
    positive = [i for i, v in id2label.items() if v == args.positive_label]
    if len(positive) != 1:
        raise SystemExit(f"label {args.positive_label!r} not in {id2label}")
    positive_index = positive[0]

    tok = Tokenizer.from_file(f"{args.model_dir}/tokenizer.json")
    cls_id, sep_id = tok.token_to_id("[CLS]"), tok.token_to_id("[SEP]")
    if cls_id is None or sep_id is None:
        raise SystemExit("tokenizer has no [CLS]/[SEP]")
    sess = ort.InferenceSession(
        f"{args.model_dir}/model.onnx", providers=["CPUExecutionProvider"]
    )
    window = args.max_tokens - 2

    with open(args.inp, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]

    # Warm-up so the first sample's latency is not the session's lazy init.
    warm = np.array([with_specials([], cls_id, sep_id)], dtype=np.int64)
    sess.run(None, {"input_ids": warm, "attention_mask": np.ones_like(warm)})

    with open(args.out, "w", encoding="utf-8") as out:
        for n, row in enumerate(rows):
            t0 = time.perf_counter()
            ids = tok.encode(row["text"], add_special_tokens=False).ids
            probs = []
            chunks = chunk_ids(ids, window)
            for c in chunks:
                x = np.array([with_specials(c, cls_id, sep_id)], dtype=np.int64)
                logits = sess.run(
                    None, {"input_ids": x, "attention_mask": np.ones_like(x)}
                )[0][0]
                probs.append(softmax_positive([float(v) for v in logits], positive_index))
            ms = (time.perf_counter() - t0) * 1000.0
            out.write(
                json.dumps(
                    {
                        "key": row["key"],
                        "prob": max_prob(probs),
                        "chunks": len(chunks),
                        "tokens": len(ids),
                        "ms": round(ms, 3),
                    }
                )
                + "\n"
            )
            if (n + 1) % 500 == 0:
                sys.stderr.write(f"scored {n + 1}/{len(rows)}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
