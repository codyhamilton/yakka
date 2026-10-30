# PR-ADVERSARIAL-CA977-KILL

Maps-only TypeSafe trial. No behavior ship, product wiring, `--call-jev`, or
`:8080` use.

- Driver: TypeSafe `jev-1.13.0`
- Framing: EX-SHAPE-SIGNAL five-Q only
- Stratum: maps-5h
- Seats: 21 across `ca977b9ca0dd`, `7b00225cb824`, `5163c22a6a3e`
- Choice scrape: 21/21 passed; `response_class == response_label`
- Registry pins:
  - case registry: `ef922870b7687c50f9e73e5fb3dcf15e892680481f0dc4de1683581fa61db3f0`
  - perturbation matrix: `27027e1804167af5e547c54d8cfdc616340a3b982fb0e29251aa3336034dd865`

## Kill evaluation

Outcome: **pass / framing robust for this criterion**. CA977 remained
`early_thrash` at baseline and under every arm, so it did not flip under an
arm. The same-micro baseline unclear-negative pool was
`7b00225cb824` and `5163c22a6a3e`.

| Arm | CA977 flip | Unclear-negative flip rate |
| --- | --- | --- |
| order-swap | no | 1/2 (0.5) |
| drop-brief_anchor | no | 0/2 (0.0) |
| prose-rewrite-stats | no | 0/2 (0.0) |
| false-progress-inject | no | 0/2 (0.0) |
| excerpt-length-extremes:near-empty | no | 2/2 (1.0) |
| excerpt-length-extremes:max | no | 0/2 (0.0) |

The first 21 requests returned HTTP 400 because the initial historical runner
used the wrong free-form question wire (`text`); after switching to the
known-good TypeSafe `noul` wire, all 21 retries returned HTTP 200. The final
`results.jsonl` is deduplicated to the 21 successful cells; raw error files
remain for auditability.

## Cell IDs

`a5bdf4318677db93`, `fc2cfb93582ce4da`, `d5f3da257a22bc0e`,
`3bb7e97b6fea7f93`, `2da4649f388884ca`, `0b72d8c4ea495401`,
`b889bf1cc8ce6fc0`, `dcc5ada70b0bc299`, `59a175ae6c3ea56b`,
`cdc8beb29cd09c3c`, `0a0aa4f3b0e729f2`, `1557a060695865e8`,
`5a93a01dddacc6f2`, `4005598d30028411`, `c2422203999ff445`,
`dc1fb5cf84803f86`, `150c2cfe3d5d3049`, `70cbc6d131b5d67d`,
`50459714cd7154da`, `f5423038b2266257`, `c4bdad0918bcc260`.
