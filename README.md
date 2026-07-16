# stainless-workflows

Reusable GitHub Actions workflows for Knock's Stainless SDK pipeline, shared
across both API families (`stainless-knock-mapi`, `stainless-knock-api`).
Centralizes the logic so each caller repo carries only a thin stub that owns
its triggers and hardcodes its repo names — fixing a bug here fixes it
everywhere, without touching the callers.

Two kinds of repos consume this:

- **Config repos** (`stainless-knock-mapi`, `stainless-knock-api`): the stlc
  codegen pipeline and the custom-code tracking sync.
- **SDK repos** (`knock-mgmt-node-staging` / `knock-mgmt-node`, …): the
  staging ↔ production promote/back-sync loop, one stub set per target.

## What's here

| Reusable workflow | Called from | Stub to copy |
| --- | --- | --- |
| `.github/workflows/stlc-generate.yml` | config repos | `examples/config-repo/stlc-generate.yml` |
| `.github/workflows/publish-documented-spec.yml` | config repos (job in the `stlc-generate` stub) | `examples/config-repo/stlc-generate.yml` |
| `.github/workflows/stlc-sync-tracking.yml` | config repos | `examples/config-repo/stlc-sync-tracking.yml` |
| `.github/workflows/stlc-promote.yml` | staging SDK repos | `examples/sdk-repo/stlc-promote.yml` |
| `.github/workflows/stlc-sync-from-production.yml` | staging SDK repos | `examples/sdk-repo/stlc-sync-from-production.yml` |
| `.github/workflows/trunk-sync-lock.yml` | staging SDK repos | `examples/sdk-repo/trunk-sync-lock.yml` |
| `.github/workflows/seal-dispatch.yml` | staging SDK repos (optional) | `examples/sdk-repo/seal-dispatch.yml` |
| `.github/workflows/trigger-back-sync-on-release.yml` | production SDK repos | `examples/sdk-repo/trigger-back-sync-on-release.yml` |

## This repo must be PUBLIC

The production SDK repos are public, which rules out a private central repo:

- `trigger-back-sync-on-release.yml` runs *on* the public production repos,
  and a reusable workflow in a private repo can only be called from other
  private repos in the org.
- The staging-side stubs land on production via the promote (it fast-forwards
  the whole tree), and their `schedule:` crons fire there too. GitHub resolves
  a job's `uses:` reference when the run is created — *before* evaluating the
  job's `if:` guard — so an unresolvable private reference means a failing run
  on every cron tick in the public repos, not a silent skip. With this repo
  public, those runs resolve and skip green on the guard.

Everything here is logic-only (no secrets), and the SDK-repo workflow content
is already publicly visible in the production repos, so public costs nothing
for the SDK set. It does mean the config-repo pipeline logic is public too —
if that's ever unacceptable, split the config-repo workflows into a separate
private repo; the SDK-repo set is the only part that must be public.

## Config repos

In a config repo:

1. Copy the two files from `examples/config-repo/` into `.github/workflows/`.
2. Keep your own `.github/actions/setup-stlc/action.yml`.
3. Make sure these repo secrets exist: `STLC_READ_TOKEN`, `SDK_WRITE_TOKEN`
   (`GITHUB_TOKEN` is automatic). The stubs forward them with `secrets: inherit`.

No inputs are required. The config filename is read from the workspace's
`workspace.json` (`stainless_config`), and `workspace` / `targets` default to
`stainless` / `all`. Override them via `with:` only if a repo differs.

`setup-stlc` deliberately does **not** live here — each config repo keeps its
own `.github/actions/setup-stlc`, so it can install only the language
toolchains that repo targets. The reusable workflows reference it as
`./.github/actions/setup-stlc`, and because relative action paths in a called
workflow resolve against the **caller**, each config repo's run uses its own
copy automatically.

## SDK repos: the promote / back-sync loop

These implement the fast-forward model from the [Stainless transition
guide](https://app.stainless.com/knock/transition/docs/promote): promote
(staging → production) and back-sync (production → staging) are plain
fast-forward pushes, so the two `main`s always hold the same commits and
divergence is impossible by construction.

In each staging SDK repo:

1. Copy the five files from `examples/sdk-repo/` into `.github/workflows/`
   and replace the hardcoded repo names in each — the examples use the mAPI
   node target (staging `knocklabs/knock-mgmt-node-staging`, production
   `knocklabs/knock-mgmt-node`, config `knocklabs/stainless-knock-mapi`).
   Getting a name wrong doesn't break anything loudly: the `if:` guard just
   never matches and the jobs silently skip — double-check them.
2. Commit them in the SDK working directory and run `stlc build` so they're
   sealed as custom code and survive regeneration.
3. All five live only on staging: the promote carries them to the production
   repo, and each stub's `if: github.repository == …` guard picks the one repo
   its job actually runs in. The skipped copies (and the crons firing on the
   wrong side) show up as green skipped runs — that's by design.

### Secrets

| Secret | Stored in | Scope | Used by |
| --- | --- | --- | --- |
| `PRODUCTION_REPO_TOKEN` | staging repo | Contents: write on the production repo | `stlc-promote.yml` |
| `CONFIG_DISPATCH_TOKEN` | staging repo | `repository_dispatch` to the config repo | `seal-dispatch.yml` (optional) |
| `STAGING_DISPATCH_TOKEN` | production repo | `repository_dispatch` to the staging repo (fine-grained PAT, Contents: write on that one repo) | `trigger-back-sync-on-release.yml` |
| `SDK_WRITE_TOKEN` | staging repo (same token the config repo uses) | Contents: write on the staging repo; owner must bypass staging `main`'s PR rule | `stlc-sync-from-production.yml` |

The stubs use `secrets: inherit`, so these can live as repo secrets or as org
secrets scoped to the right repos. `SDK_WRITE_TOKEN` in particular should be an
org secret scoped to the config repo + staging repos, so a rotation lands
everywhere at once. Trunk-sync-lock needs no secret; the back-sync reads public
production anonymously and pushes staging `main` as `SDK_WRITE_TOKEN`'s owner —
the same identity codegen pushes with, so the two rise and fall together.

### One-time setup per target

1. **Branch rulesets on both `main`s**: block deletion and non-fast-forward
   (force) pushes. Don't require linear history — that's compatible here, but
   don't require a pull request either, or the fast-forward pushes can't land
   without bypass.
2. **Seed then require `trunk-synced`**: run `trunk-sync-lock.yml` once
   manually (the trunks are in sync at setup, so the first status is green),
   then make `trunk-synced` a required status check on staging `main`.
3. **Bypass actors on staging `main`**: rules that block direct pushes
   (required status checks, required pull requests) must exempt the one
   identity that pushes staging `main` directly — the owner of
   `SDK_WRITE_TOKEN`, used by both codegen and the back-sync. Add that
   identity to the ruleset's bypass list (a user needs a team or role entry;
   an app is added directly). Codegen additionally holds itself during the
   release window via the guard step in `stlc-generate.yml`.
4. **Optional promote approval**: add required reviewers to the staging
   repo's `production` environment to gate each promote dispatch.

## Versioning

Callers pin a ref: `...@main` while iterating, then cut a tag (e.g. `v1`) and
pin `...@v1` so a change here rolls out deliberately rather than instantly to
every caller. This matters double for the SDK-repo stubs: they're sealed
custom code, so re-pinning them means a reseal in every staging repo — but a
change to a `@main`-pinned reusable workflow reaches every repo with no reseal
at all. These workflows push directly to `main` branches, so prefer a pinned
tag once things settle.

Note: the reusable workflows can't be exercised standalone in this repo (there's
no `stainless/` workspace, `setup-stlc`, or paired staging/production remotes
here) — validate changes through a caller repo (or a throwaway test caller).
