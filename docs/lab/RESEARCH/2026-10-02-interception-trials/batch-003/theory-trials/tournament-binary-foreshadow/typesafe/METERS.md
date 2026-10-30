# tournament-binary-foreshadow TypeSafe meters

Maps-only, prefix-only measurement. No behaviour ship, hooks, unlock, outcome scoring, or localhost:8080.

- Framing: `esv0-binary-foreshadow#d0f736b5ecc043ce`
- Cells: 8/8
- Fire: 1
- Defer: 7
- Errors: 0
- Parse misses: 0
- `response_class == response_label`: True

| Checkpoint | Cells | Fire | Defer |
|---:|---:|---:|---:|
| 75 | 4 | 0 | 4 |
| 90 | 4 | 1 | 3 |

Frame yes/no answers are retained separately in `results.jsonl` and `meters.json`; they are not substituted for fire/defer.
