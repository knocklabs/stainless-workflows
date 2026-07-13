---
title: "Promote SDKs from staging to production"
description: "How stlc promotes generated SDKs from staging to production — fast-forward (recommended) or, where a repo requires pull requests for incoming changes, merge-commit PRs — and how custom code flows between the repos."
slug: promote
source: https://app.stainless.com/knock/transition/docs/promote
---

# Promote SDKs from staging to production

_How stlc promotes generated SDKs from staging to production — fast-forward (recommended) or, where a repo requires pull requests for incoming changes, merge-commit PRs — and how custom code flows between the repos._

Each target in your `stainless.yml` points to two SDK repositories: a `staging_repo` and a `production_repo`. This page explains what each one is for, how changes cross between them, and how custom code and releases flow.

## What each repo is for

**Staging repo**: the canonical source of truth for `stlc`. `stlc init` clones each SDK repo from `staging_repo` and sets that as the SDK clone's `origin` remote. `stlc build` then pushes sealed custom-code refs to `origin`; the SDK branch itself is only pushed when you pass `--push`. All generated code, custom code patches, and branches that `stlc` produces live in the staging repo.

**Production repo**: the public-facing repository your users clone and install from. `stlc` only references the production repo at codegen time, for example to set a Go module path or a CLI import path. `stlc` does not read from or write to the production repo directly.

> **Note:**
>
> Staging and production hold the same SDK *content* on `main`; production trails staging by whatever hasn't been released yet. The one exception is **release metadata** — after release-please cuts a release, production `main` is briefly *ahead* of staging by the version/changelog commits, until the back-sync brings them home. Separation is about timing and visibility, not different content.

A private staging repo paired with a private production repo is also valid; the staging-and-production split is orthogonal to visibility. Use a public production repo when you want users to clone, fork, or open PRs against it; use a private production repo when you only want internal consumers.

## Choosing how to promote

There are two flows between the repos — **promote** (staging `main` → production `main`) and **back-sync** (production `main` → staging `main`). These are the *only* place the choice below matters.

> **Pull requests *within* a repo are always fine, any merge method.** Custom-code PRs, community PRs, and release-please's PR all merge normally on their own repo — squash, rebase, or merge commit, your choice. The result is just that repo's next commit on `main`. The choice on this page is **only about the cross-repo boundary** (promote and back-sync), where commits move between two repos and SHAs have to stay aligned.

For each boundary, the *receiving* repo updates its `main` one of two ways:

- **Fast-forward push — recommended.** The promote/back-sync workflow pushes directly, so staging `main` and production `main` stay identical and linear (same commit SHAs). Divergence between the trunks is *impossible* by construction, not something to repair later. Requires that your automation can push directly to that repo's `main`. See [Fast-forward sync](#fast-forward-sync-recommended).
- **Merge-commit pull request.** If a repo **requires a pull request** for incoming changes to `main` (e.g. branch protection you can't or won't exempt automation from), the cross-repo update lands as a PR — and that PR **must be merged with a merge commit.** A merge commit keeps the incoming commits reachable, so the trunks stay in lock-step (one always an ancestor of the other) and the seal stays anchored. See [If a repo requires pull requests](#if-a-repo-requires-pull-requests-merge-commit).

This is a **per-boundary** choice: production can require a merge-commit PR for the promote while staging still takes a direct fast-forward back-sync, or vice versa, or both can require PRs. Pick fast-forward wherever your automation is allowed to push to `main`; fall back to a merge-commit PR only where it isn't.

> **One rule for the cross-repo boundary: never squash or rebase a promote/back-sync PR.** Both rewrite the commits into new SHAs, which forks the two trunks apart and forces a slower, more fragile content-based sync. On a cross-repo boundary use a fast-forward push, or a merge commit — nothing else.

> **One-repo setup:** if `staging_repo` and `production_repo` are the same repo there is no promote step at all — `stlc build --push` lands on the public repo and release-please runs there directly. Skip the rest of this page; see [Releasing SDKs](./13-release.md).

## How custom code flows

Staging is the SDK clone's `origin`, so it is where `stlc build --push` publishes the SDK branch and where sealed custom-code refs land on every build. Feature branches on staging are ephemeral working surfaces for `stlc` and for reviewing spec changes; they are not promoted. Only `main` is promoted.

For most custom code work, nothing about the staging and production split changes the workflow:

1. Run `stlc build`. `stlc` generates the SDK into the configured output directory, integrates any previously sealed custom code onto the fresh output, pushes the custom-code commits to the staging repo, and writes tracking files to the config repo under `stainless/custom-code/<target>/`.
2. Edit the generated SDK in your output directory. Commit your changes in that working directory.
3. Run `stlc build` again. `stlc` seals your edits into a new tracking file, integrates them onto freshly generated code, and pushes the sealed custom-code refs to the staging repo. Pass `--push` to also push the SDK branch.

See [Custom code with stlc](./17-custom-code.md) and [Branching and collaboration](./18-custom-code-collaboration.md) for the full workflow.

Two cases are specific to the staging and production split:

- **Direct commits on the staging SDK repo.** You can commit hand-written changes directly to staging (subject to its branch protection), outside of `stlc build`. Run `stlc build` afterward to seal those commits into a tracking file so they survive the next codegen.
- **Third-party contributions on the production repo.** These flow back to staging via the back-sync and `stlc build` seals them as custom code so they are preserved on the next regeneration. See [Accepting community contributions on production](#accepting-community-contributions-on-production).

> **Note:**
>
> The tracking files in `stainless/custom-code/<target>/` live in your **config repo**, not in the SDK repo. They must be committed alongside your spec and config changes so that the next `stlc build` on a fresh checkout can see them.

## Fast-forward sync (recommended)

In the fast-forward model, promote and back-sync are plain fast-forward pushes, so staging `main` and production `main` always hold the **same commits** in the same order. Because the promote and back-sync steps only fast-forward — never rewriting history — the sealed `integrated` commit stays an ancestor of both, and the next `stlc build` has nothing to repair — the entire "staging and production have diverged" problem class is unreachable.

This requires that the two trunks never advance independently: after one side moves, it is synced to the other before the other moves. An eager back-sync after each release plus a lock that pauses staging merges during the release window enforce that. `stlc` itself needs no special configuration — it only ever sees the staging repo, and a fast-forward staging trunk is exactly the linear history `stlc build --push` already expects.

### The workflows

Five workflow files implement the loop. They live in your SDK repos and each self-routes with an `if: github.repository == ...` guard, so you can seal the same files into both repos and only the right job runs in each. Copy them from the [`sdk-repo` example](https://github.com/stainless/stlc/tree/main/examples/sdk-repo/.github/workflows) and replace the placeholder repo names:

| Workflow | Lives in | What it does |
|---|---|---|
| `stlc-promote.yml` | staging | Fast-forwards production `main` up to staging `main`. Manual dispatch (optionally approval-gated). |
| `stlc-sync-from-production.yml` | staging | Fast-forwards staging `main` up to production `main`, bringing release commits back. Runs on the release dispatch and a poll. |
| `trigger-back-sync-on-release.yml` | production | On `release: published`, dispatches the back-sync so it runs within seconds. |
| `trunk-sync-lock.yml` | staging | Posts a `trunk-synced` status to open `main` PRs — red while production is ahead — to pause custom-code merges during the release window. |
| `seal-dispatch.yml` | staging | Optional: on push to `main`, tells the config repo to reseal tracking files eagerly instead of waiting for its poll. |

Both the promote and back-sync workflows compare staging and production by **content** (`git merge-tree --write-tree`) to decide whether there is anything to do, then verify the move is a true fast-forward (`git merge-base --is-ancestor`) before pushing. If the trunks have somehow forked, the push is refused loudly rather than forced — you sync them back together first.

### Branch protection

The fast-forward chain only holds if neither trunk can be **force-pushed** (history rewritten). On both `main` branches, add a branch ruleset that:

- blocks branch **deletion**, and
- blocks **non-fast-forward** pushes (no force-push or history rewrite).

The promote/back-sync workflows must be able to **fast-forward push to `main`** — and a fast-forward is not a force-push, so it's compatible with the rules above. If your org **requires a pull request** for changes to `main`, either add the promote/back-sync identity to the ruleset's **bypass list** so the fast-forward push still goes through (other contributions stay review-gated), or use a [merge-commit PR](#if-a-repo-requires-pull-requests-merge-commit) for that boundary instead.

To prevent a custom-code PR from merging mid-release-window and forking the trunks, make `trunk-synced` (posted by `trunk-sync-lock.yml`) a **required status check** on staging `main`. Note its interaction with the back-sync:

- A **required status check blocks direct pushes, not just PR merges** (verified on both GitHub rulesets and classic branch protection). So if `trunk-synced` is required on staging `main`, the back-sync's direct push is blocked unless the back-sync identity is a **bypass actor** on the ruleset. Add it to the bypass list — clearing the red is precisely its job.
- Prefer a **dedicated bypass identity** (a GitHub App or a scoped token) over `github-actions[bot]`, so the bypass is narrow rather than applying to every workflow.
- **Never route the back-sync through a pull request gated by `trunk-synced`** — that PR would be red exactly because the back-sync hasn't run yet, so it could never merge (a deadlock). The back-sync pushes directly for this reason.
- If you'd rather not manage a bypass, keep `trunk-synced` as an *advisory* status (posted but not required) and rely on the loud refusal in the promote/back-sync ancestor checks if a fork ever happens.

When you first set this up, seed the `trunk-synced` status once (trigger `trunk-sync-lock.yml` manually) **before** marking it a required check — GitHub treats a check as required only after it has been reported at least once, and at setup time the trunks are in sync so the first status is green.

### Required secrets

| Secret | Stored in | Scope | Used by |
|---|---|---|---|
| `PRODUCTION_REPO_TOKEN` | staging | Contents: write on the production repo | `stlc-promote.yml` (the fast-forward push) |
| `STAGING_DISPATCH_TOKEN` | production | Can send a `repository_dispatch` to the staging repo | `trigger-back-sync-on-release.yml` |
| `CONFIG_DISPATCH_TOKEN` | staging | Can send a `repository_dispatch` to the config repo | `seal-dispatch.yml` (optional) |

`STAGING_DISPATCH_TOKEN` is the only credential that lives on the public production repo. Scope it to **only the staging repo** with the minimum a `repository_dispatch` needs: a fine-grained PAT with `Contents: write` on that one repo. (`Contents: write` is the permission GitHub requires to send a `repository_dispatch` — there is no narrower "dispatch-only" PAT scope — so a leak is bounded to writing the staging repo, not the production or config repos. A GitHub App installation token scoped to staging can tighten this further: short-lived and revocable.) The back-sync reads public production with the built-in token and needs no secret of its own; if your production repo is private, give the back-sync a read token instead.

### Releases, community contributions, and the release window

**Releases.** There is no promote PR — the promote is a fast-forward push, which preserves your individual conventional commits exactly, and release-please reads them to compute the version bump. Merge release-please's *version* PR however your repo allows — release-please tracks the released version in `.release-please-manifest.json`, independent of merge method (see [Releasing SDKs](./13-release.md)). Once the bump is back-synced, the next `stlc build` reads the released version from staging and stays in sync automatically.

**Community contributions.** A contribution merged on the public production repo (a docstring fix, say) is a clean commit on production `main`. The back-sync fast-forwards it onto staging `main` like any release commit, and the next `stlc build` seals it as custom code so it survives regeneration.

**The release window.** The one moment the two trunks differ is between a release landing on production and the back-sync bringing it home. Staging must not advance during that window, and it has **two** writers, each held a different way:

- A human **custom-code PR** is held by the `trunk-synced` required check (red while production is ahead).
- **Codegen** pushes *directly* to staging `main` from the generate workflow, so the PR gate doesn't apply to it. It's held by a **codegen-side guard**: before building, the generate workflow fetches production and refuses to build/push if production is ahead of the trunk (a release isn't back-synced yet). The guard re-runs cleanly once the back-sync catches up. See [Codegen](./11-codegen.md).

The back-sync triggers eagerly on `release: published`, so this window is seconds, not hours; a scheduled poll is the backstop. (A non-release production change, such as a contribution merged between releases, waits for that poll — if you take community PRs frequently, tighten the poll interval or add an eager `on: push: [main]` dispatch on production.)

## If a repo requires pull requests: merge-commit

Some organizations require that **every change to `main` goes through a pull request** — no direct pushes, even for automation, and no bypass. When that's true for a repo, the cross-repo update *into* that repo can't be a fast-forward push; it has to be a pull request. **Merge that pull request with a merge commit.**

This is a **per-boundary** fallback. If only production requires PRs, the promote becomes a merge-commit PR while the back-sync into staging stays a fast-forward; if only staging requires them, it's the reverse; if both do, both edges are merge-commit PRs. Use a fast-forward push everywhere you can and this everywhere you can't.

**Why a merge commit (and not squash or rebase).** A merge commit keeps every incoming commit reachable in the receiving repo's history, so the receiving trunk stays a clean descendant of the source — staging always an ancestor of production or vice versa, never siblings. The sealed `integrated` commit stays an ancestor of both, so the back-sync still fast-forwards and `stlc build` has nothing to repair. Squash and rebase rewrite the incoming commits into new SHAs, which forks the trunks apart; squash additionally collapses your conventional commits into one non-conforming commit so release-please stops bumping the version. (This was verified end-to-end: a full promote → release → back-sync cycle done entirely with merge-commit PRs keeps the trunks non-divergent across cycles.)

### Branch protection for a PR-required boundary

On a repo whose `main` takes its cross-repo updates by PR:

- **require a pull request** before merging (the constraint that put you here),
- **allow merge commits** — do **not** require linear history (a merge-commit PR needs them), and
- still block **deletion** and **non-fast-forward** (force) pushes.

The custom-code `trunk-synced` gate works the same as in the fast-forward model, with one addition: **exclude the bot's own promote/back-sync PRs from the gate** (e.g. the `stainless/release` and `stlc/from-prod` branches), or they deadlock against the very status they exist to clear.

### The workflows

The merge-commit variants live in the [`sdk-repo-pr` example](https://github.com/stainless/stlc/tree/main/examples/sdk-repo-pr/.github/workflows): `stlc-promote.yml` pushes staging `main` to a `stainless/release` branch on production and opens a PR; `stlc-sync-from-production.yml` pushes production `main` to a `stlc/from-prod` branch on staging and opens a PR. Both are merged with a **merge commit** (auto-merge if your repo allows it). The `trigger-back-sync-on-release.yml`, `trunk-sync-lock.yml`, and `seal-dispatch.yml` workflows are identical to the fast-forward example. The same `PRODUCTION_REPO_TOKEN` covers the cross-repo push and PR; the rest of the [secrets](#required-secrets) are unchanged.

### Two pull requests, in sequence

When the promote is a PR, a release involves **two** PRs on production `main`, in order:

1. **The promote PR** (from `stainless/release`): brings production's *code* up to date with staging. Merge it (merge commit) to publish the code.
2. **The release-please PR**: bumps the version and changelog. Merge it to cut the release.

The promote PR only appears when staging has code production lacks; the release-please PR only appears once there are releasable commits on production.

### Accepting community contributions on production

If your production repo accepts pull requests from outside contributors, the back-sync pulls the merged commit back onto staging `main` and the next `stlc build` seals it as custom code. If you don't run the back-sync workflow, do it by hand: cherry-pick the merged commit into staging `main` and run `stlc build`. If you skip it, the next `stlc build` on staging will generate SDK code that does not include the contribution, and the next promote will overwrite it on production.

**Why production pulls rather than pushes.** Keeping the production repo free of any token that can read or push code to your staging and config repos — and free of any reference to the config repo at all — is deliberate. Production is public and user-facing. Its one upstream link is `STAGING_DISPATCH_TOKEN` (part of the recommended setup), held by `trigger-back-sync-on-release.yml` and used only to *trigger* the pull-based back-sync on staging — never to read or write code in your internal repos. That workflow runs with `contents: read` and can only POST a `repository_dispatch`, so a leak is bounded to writing the staging repo. The contribution itself is *pulled in* by staging (which already has access to production) and sealed into the config repo's tracking files from the config side. Code references point only downstream (`config → staging → production`).

## Initialization

The recommended migration path is to create your own staging repo per target before you run `stlc init` and point `stlc init` at it when prompted. See [Migration plan](./03-migration-plan.md#end-to-end-sequence) for the full sequence, including the snippet for mirroring an existing repo into a new private staging repo.

When you run `stlc init --from-cloud`, `stlc` clones each target from `staging_repo` and prompts you for the `origin` remote to use on each clone — this is where `stlc build` will push. The default is the `staging_repo` already configured in your bundle. If you enter a different value, `stlc` writes it back to `stainless.yml` as the target's `staging_repo`; the configured `production_repo` is left untouched. As a fallback, if your bundle's `stainless.yml` only has `production_repo` set for a target, `stlc` mirrors it into `staging_repo` so the clone has somewhere to come from; create your own staging repo before `stlc init` to avoid relying on this fallback.

## See also

- [Custom code with stlc](./17-custom-code.md)
- [Branching and collaboration](./18-custom-code-collaboration.md)
- [Releasing SDKs](./13-release.md)
- [Codegen](./11-codegen.md)
- [Workspaces](./16-workspace.md)
