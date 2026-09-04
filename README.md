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
| `.github/actions/publish-openapi-spec` (composite action) | service repos' spec-publish job (control, switchboard) | `examples/service-repo/publish-openapi-spec.yml` |

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
3. Make sure these repo secrets exist: `STLC_READ_TOKEN`, `SDK_WRITE_TOKEN`,
   and `SEAL_PR_TOKEN` (`GITHUB_TOKEN` is automatic), plus `DOCS_REPO_TOKEN` to
   publish its documented spec. The stubs forward them with `secrets: inherit`.

### Config-repo secrets

| Secret | Scope | Used by |
| --- | --- | --- |
| `STLC_READ_TOKEN` | Contents: read on `stainless/stlc*` repos | `setup-stlc` (fetch the stlc CLI) |
| `SDK_WRITE_TOKEN` | Contents: write on the SDK staging/production repos | codegen + tracking sync push to staging |
| `SEAL_PR_TOKEN` | Contents: write **+ Pull requests: write** on this config repo | opening and auto-merging the `stlc/seal-tracking` PR |
| `DOCS_REPO_TOKEN` | Contents: write **+ Pull requests: write** on `knocklabs/docs` | opening and auto-merging the documented-spec PR (only repos that run `publish-documented-spec`) |

`SEAL_PR_TOKEN` must be a **PAT (or GitHub App token), not `GITHUB_TOKEN`**, and
its owner must be an org member with write on the config repo. This is what lets
the seal-back PR merge without a human: a head branch pushed by `GITHUB_TOKEN`
leaves the required `generate` check parked in `action_required` (GitHub's
"approve and run" gate), so auto-merge never fires and the PR sits blocked until
someone clicks approve. A real-identity PAT lets the check run on its own, so
auto-merge lands the PR on green and holds it on red. A minimal fine-grained PAT
scoped to just this repo (Contents: write, Pull requests: write) is enough; the
`knock-eng-bot` identity is the natural owner. If `SEAL_PR_TOKEN` is unset the
workflows fall back to `GITHUB_TOKEN`, so nothing breaks — the seal-back PR just
still needs a manual approval to run its check.

### Config-repo inputs

Only `publish-documented-spec` has required inputs (`source-repo`,
`docs-spec-path`). Everything else is optional, and the config filename is
always read from the workspace's `workspace.json` (`stainless_config`).

| Input | Workflow | Default | Purpose |
| --- | --- | --- | --- |
| `workspace` | all | `stainless` | Path to the stlc workspace. |
| `targets` | `stlc-generate`, `stlc-sync-tracking` | `all` | Targets to build / sync. |
| `fail-on-unconfigured-endpoints` | `stlc-generate` | `false` | Endpoint coverage gate, see below. |
| `coverage-review-team` | `stlc-generate` | `''` | Team slug to request a review from when the gate fails (needs `SEAL_PR_TOKEN`). |
| `docs-config-path` | `publish-documented-spec` | `''` | Also publish the Stainless config to this path in the docs repo, in the same PR. |

### Endpoint coverage gate

Stainless only generates code for endpoints listed under `resources` in the
config. A new endpoint in the spec is otherwise skipped with a note-level
`Endpoint/NotConfigured` diagnostic, and `stlc build` still exits 0. With the
upstream spec PRs auto-merging, that means new endpoints silently never reach
the SDKs.

With `fail-on-unconfigured-endpoints: true`, the `generate` job fails when
the build reports any `Endpoint/NotConfigured` or any error-level diagnostic.
`generate / generate` is the required check on the config repo's `main`, so
auto-merge holds until someone commits a config decision to the PR branch:
add the endpoint to `resources` (exposing it, with a deliberately chosen
method name) or to `unspecified_endpoints` (keeping it out; the diagnostic
becomes `Endpoint/IsIgnored`, which passes). On pull requests the job also
posts a sticky comment with the list and the config diff `stlc autoconfig`
proposes, and requests a review from `coverage-review-team`.

The proposed diff is computed against a spec copy with the
`unspecified_endpoints` operations removed, because `stlc autoconfig` (0.3.x)
ignores that list and would otherwise re-add every deliberately excluded
endpoint. The workflow commits nothing; the config is restored after the
diff is taken.

Before enabling the gate in a repo, make sure its config already covers every
spec endpoint (run `stlc build` and check for `Endpoint/NotConfigured`),
otherwise every PR fails immediately. With the service-repo autoconfig flow
below in place the gate is a backstop: it should never fire, and if it does,
something slipped past autoconfig and review.

## Service repos: spec PRs carry the Stainless config

control (mAPI) and switchboard (API) publish each release's OpenAPI spec to
their config repo from the `publish-openapi-spec` job in `deploy-prod.yml`.
After downloading the spec, that job is a single call to the shared composite
action `.github/actions/publish-openapi-spec` (full job:
`examples/service-repo/publish-openapi-spec.yml`), which:

1. Installs the stlc CLI (only the CLI: `stlc autoconfig` never loads the
   language generators), clones the config repo's `main`, and copies the
   release's spec over `stainless/openapi.json`.
2. Prunes the endpoints listed in the config's `unspecified_endpoints` from a
   spec copy (autoconfig 0.3.x ignores that list and would re-add them every
   run) and runs `stlc autoconfig`. A failure fails the step: publishing a spec
   without its config is how new endpoints silently never reach the SDKs.
3. Commits spec and config together to `<source>-spec-update`, force-pushes,
   and opens or refreshes the PR titled `feat: update <label> spec to <tag>`.
   The title becomes the SDK commit subject that release-please reads.
4. Arms auto-merge **only when the config did not change**. Otherwise the PR
   body carries autoconfig's "new methods" summary and a review checklist,
   auto-merge is disabled (also if an earlier spec-only refresh armed it), and
   the config repo's `CODEOWNERS` entry for the config file requests the
   owning team.

Why the review: the method and resource names autoconfig guesses become public
API in every SDK and can't be renamed later without a breaking change; a
`models:` entry for a schema the SDKs already ship renames generated types
(breaking for typed consumers); and when a guessed name collides with an
existing method, autoconfig overwrites that method's endpoint — the action
reports this as `non-additive` and the PR body shows a warning. A reviewer
retitles the PR to `feat!:` when a change is breaking so release-please cuts a
major version.

Each release recreates the PR branch from `main` (force-push), so review fixes
pushed to the branch must land before the next release. The action exposes
`pr-url`, `has-changes`, `config-changed`, `non-additive`, `summary` and
`auto-merge` outputs for callers that want to notify.

Prerequisites: the `STLC_READ_TOKEN` and `STLC_REPO_TOKEN` secrets in control
and switchboard, `jq` on the runner (the action installs `yq` if missing), and
a `.github/CODEOWNERS` in each config repo owning `stainless/openapi.stainless.yml`.
To have GitHub enforce the review rather than just request it, enable "Require
review from Code Owners" on the config repo's `main` ruleset with the required
approval count left at 0: spec-only PRs keep auto-merging, config-touching PRs
wait for an owner's approval.

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
   an app is added directly). Every workflow that pushes staging `main`
   additionally holds itself during the release window via the shared
   `trunk-sync-guard` action (used by `stlc-generate.yml` and
   `stlc-sync-tracking.yml`) — bypass actors are exempt from ruleset rules,
   so this in-workflow hold is the only gate that applies to them.
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
