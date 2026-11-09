# 7-04 Runner manifest boundary

Status: done.

## Checks

Before changes, `python3 -m unittest tools/shadow-review-trial/test_phase7.py` passed 2 tests because the rehearsal's adapter rewrote the frozen capture. A direct `build_request` using a newly generated Phase 6 manifest failed as recorded by 7-03:

```text
RunnerError: case 98811e2a2caf3153ad5779b3b0f191f11fdb1df0 capture differs from its frozen range
```

After changes, `python3 -m unittest tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py` passed all 11 tests. `git diff --check` passed. The three-case rehearsal used the manifest directly, completed all nine fake endpoint case/effort reviews, checked each request's base/head against `base_sha`/`head_sha`, validated the manifest hash, and verified its bytes and hash were unchanged after running.

## Changes

`build_request` validates `resolved_head` when the frozen capture provides it, while retaining the fixture contract where `head` is already the selected tip. The outbound REST capture sends canonical case `head_sha` as `head`. Added coverage for both forms and a mismatched resolved tip. Removed the Phase 7 test adapter that modified and re-hashed a copy of the frozen manifest.

No deviations, contradictions, unfinished work, or known problems. No live provider call, credentials, deployment, Fly, or Wrangler action was used.
