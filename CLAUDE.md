# CLAUDE.md

## GitHub Actions must stay manual-only

Every workflow under `.github/workflows` triggers only on `workflow_dispatch`. Do not add `push`, `pull_request`, `pull_request_target`, `schedule`, `workflow_run`, `merge_group`, `release` or similar automatic triggers (Cody, 28 Nov 2026: automatic runs were using the whole monthly Actions quota in a single day). Keep any jobs runnable manually.
