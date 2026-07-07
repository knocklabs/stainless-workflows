# stainless-workflows

Reusable GitHub Actions workflows for Knock's Stainless SDK config repos
(`stainless-knock-mapi`, `stainless-knock-api`, …). Centralizes the stlc
codegen pipeline so each config repo carries only a thin caller stub instead of
a duplicated ~250-line workflow.

## What's here

| Path | Purpose |
| --- | --- |
| `.github/workflows/stlc-generate.yml` | Reusable (`workflow_call`) — generates SDKs for all targets and pushes to the SDK staging repos. Preview branches + sticky PR comment on `pull_request`; direct push to staging `main` on `push`. |
| `.github/workflows/stlc-sync-tracking.yml` | Reusable (`workflow_call`) — polls staging repos for out-of-band custom-code changes and opens a seal-back PR on the calling config repo. |
| `examples/stlc-generate.yml` | Caller stub to copy into a config repo as `.github/workflows/stlc-generate.yml`. |
| `examples/stlc-sync-tracking.yml` | Caller stub to copy into a config repo as `.github/workflows/stlc-sync-tracking.yml`. |

`setup-stlc` deliberately does **not** live here — each config repo keeps its
own `.github/actions/setup-stlc`, so it can install only the language
toolchains that repo targets. The reusable workflows reference it as
`./.github/actions/setup-stlc`, and because relative action paths in a called
workflow resolve against the **caller**, each config repo's run uses its own
copy automatically.

## How to consume it

In a config repo:

1. Copy the two files from `examples/` into `.github/workflows/`.
2. Keep your own `.github/actions/setup-stlc/action.yml`.
3. Make sure these repo secrets exist: `STLC_READ_TOKEN`, `SDK_WRITE_TOKEN`
   (`GITHUB_TOKEN` is automatic). The stubs forward them with `secrets: inherit`.

That's it — no inputs are required. The config filename is read from the
workspace's `workspace.json` (`stainless_config`), and `workspace` / `targets`
default to `stainless` / `all`. Override them via `with:` only if a repo
differs.

## One-time setup on this repo

If this repo is **private**, allow the config repos to call its workflows:
**Settings → Actions → General → Access → "Accessible from repositories in the
`knocklabs` organization"** (or list each config repo explicitly). Public repos
need nothing.

## What stays in each config repo (and why)

Trigger events (`pull_request`, `push`, `schedule`, `repository_dispatch`) only
fire from workflows defined in the repo itself, so they cannot be externalized.
The caller stubs carry:

- the `on:` triggers and `paths:` filters,
- the `schedule` cron cadence (tune per repo),
- `permissions:` on the calling job (grants the GITHUB_TOKEN scopes the
  reusable workflow needs — it can only narrow them, never widen),
- `secrets: inherit`.

## Versioning

Callers pin a ref: `...@main` while iterating, then cut a tag (e.g. `v1`) and
pin `...@v1` so a change here rolls out deliberately rather than instantly to
every config repo. These workflows push directly to staging `main`, so prefer a
pinned tag once things settle.

Note: the reusable workflows can't be exercised standalone in this repo (there's
no `stainless/` workspace or `setup-stlc` here) — validate changes through a
config repo (or a throwaway test caller).
