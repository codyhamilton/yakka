import json
from pathlib import Path
import unittest

from cost_window import _cost


def haiku_rates():
    pricing_path = Path(__file__).resolve().parents[1] / "pricing.json"
    with pricing_path.open(encoding="utf-8") as pricing_file:
        return json.load(pricing_file)["claude-haiku-5-5"]


class HaikuPricingTests(unittest.TestCase):
    def test_published_input_tiers(self):
        rates = haiku_rates()
        for input_tokens, expected in ((99_999, 0.0100004), (100_000, 0.0100005), (100_001, 0.050003)):
            with self.subTest(input_tokens=input_tokens):
                split = _cost(
                    {"fresh_in": input_tokens, "cache_write": 0, "cache_read": 0, "output": 1},
                    rates,
                )
                self.assertAlmostEqual(sum(split.values()), expected, places=12)


    def test_aggregated_cost_keeps_each_usage_tier(self):
        rates = haiku_rates()
        usage = {
            "fresh_in": 199_999,
            "cache_write": 0,
            "cache_read": 0,
            "output": 2,
            "usage_rows": [
                {"fresh_in": 99_999, "cache_write": 0, "cache_read": 0, "output": 1},
                {"fresh_in": 100_000, "cache_write": 0, "cache_read": 0, "output": 1},
            ],
        }
        split = _cost(usage, rates)
        self.assertAlmostEqual(sum(split.values()), 0.0100004 + 0.0100005, places=12)


if __name__ == "__main__":
    unittest.main()
