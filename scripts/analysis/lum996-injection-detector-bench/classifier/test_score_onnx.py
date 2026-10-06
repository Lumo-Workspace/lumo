"""LUM-1007 — unit tests for the pure helpers in score_onnx.py (stdlib only).

    python -m unittest discover -s scripts/analysis/lum996-injection-detector-bench/classifier
"""

import math
import unittest

from score_onnx import chunk_ids, max_prob, softmax_positive, with_specials


class ChunkIds(unittest.TestCase):
    def test_short_text_is_one_chunk(self):
        self.assertEqual(chunk_ids([1, 2, 3], 510), [[1, 2, 3]])

    def test_exact_window_is_one_chunk(self):
        ids = list(range(510))
        self.assertEqual(chunk_ids(ids, 510), [ids])

    def test_one_over_window_is_two_chunks(self):
        ids = list(range(511))
        chunks = chunk_ids(ids, 510)
        self.assertEqual([len(c) for c in chunks], [510, 1])
        self.assertEqual(sum(chunks, []), ids)

    def test_empty_text_still_scored(self):
        self.assertEqual(chunk_ids([], 510), [[]])

    def test_bad_window(self):
        with self.assertRaises(ValueError):
            chunk_ids([1], 0)


class Helpers(unittest.TestCase):
    def test_with_specials(self):
        self.assertEqual(with_specials([7, 8], 1, 2), [1, 7, 8, 2])

    def test_softmax_positive(self):
        self.assertAlmostEqual(softmax_positive([0.0, 0.0], 1), 0.5)
        p = softmax_positive([0.0, math.log(3.0)], 1)
        self.assertAlmostEqual(p, 0.75)
        # Numerically stable for large logits.
        self.assertAlmostEqual(softmax_positive([1000.0, 0.0], 0), 1.0)

    def test_any_chunk_flagged_means_flagged(self):
        self.assertEqual(max_prob([0.01, 0.97, 0.2]), 0.97)
        with self.assertRaises(ValueError):
            max_prob([])


if __name__ == "__main__":
    unittest.main()
