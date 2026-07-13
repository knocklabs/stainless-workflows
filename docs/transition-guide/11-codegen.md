---
title: "Automate SDK generation"
description: "GitHub Actions workflow that previews SDKs on every PR and pushes regenerated SDKs to the staging repos when the PR merges."
slug: codegen
source: https://app.stainless.com/knock/transition/docs/codegen
---

# Automate SDK generation

_GitHub Actions workflow that previews SDKs on every PR and pushes regenerated SDKs to the staging repos when the PR merges._

This guide describes the headline `stlc` CI workflow. It's a single GitHub Actions workflow with two jobs — a `guard` loop-breaker and a `generate` job whose behavior switches on the trigger:

- On **`pull_request`** (open/sync/reopen), `generate` builds a preview: it generates SDKs, pushes preview branches to each staging SDK repo, and posts a sticky comment on the PR with the per-target build status and diff links.
- On **`push` to `main`**, `generate` regenerates SDKs from `main` and pushes them directly to each staging SDK repo's `main`. (release-please opens the version/changelog PR on the production repo separately — see [Releasing SDKs](./13-release.md).)

## Example files

Three files live in the `stlc` example config repo. Copy them into your own config repo at the same paths.

| File | What it does |
|---|---|
| [`.github/workflows/stlc-generate.yml`](https://github.com/stainless/stlc/blob/main/examples/config-repo/.github/workflows/stlc-generate.yml) | The main workflow. A `guard` job (loop-breaker) plus a `generate` job that runs on `pull_request` (preview) and `push` to `main` (release). |
| [`.github/workflows/stlc-sync-tracking.yml`](https://github.com/stainless/stlc/blob/main/examples/config-repo/.github/workflows/stlc-sync-tracking.yml) | Scheduled poll that catches custom-code changes landing on staging out of band and opens a seal-back PR. See [Keeping tracking files in sync](#keeping-tracking-files-in-sync). |
| [`.github/actions/setup-stlc/action.yml`](https://github.com/stainless/stlc/blob/main/examples/config-repo/.github/actions/setup-stlc/action.yml) | Composite action: installs the language toolchains for every target, configures git auth for private `stainless/stlc*` repos, runs `pnpm install` to bring in the `stlc` CLI family. |

The example files are the source of truth. The rest of this page covers the prerequisites, the knobs you'll usually adjust, and the non-obvious bits of the design.

## Prerequisites

The workflow needs two GitHub tokens, both stored as repository secrets in the config repo:

| Secret | Scope | Used for |
|---|---|---|
| `STLC_READ_TOKEN` | Classic PAT with the `repo` scope | Fetching the private `stlc-*` packages during `pnpm install`. See [Install stlc](./05-migrate-install.md) for how to obtain this. |
| `SDK_WRITE_TOKEN` | Contents:Write on each SDK staging repo, Pull requests:Write on each SDK staging repo, Workflows:Write | Pushing preview branches on `pull_request` events and pushing directly to each staging repo's `main` on `push`-to-`main` events. |

`STLC_READ_TOKEN` must be a classic PAT. `SDK_WRITE_TOKEN` should be a fine-grained PAT scoped to only the repos it needs. If your org uses SSO, authorize each token for the org.

## What to customize

The files above are generic. The table lists everything you should expect to adjust.

| Item | Where |
|---|---|
| `STLC_READ_TOKEN`, `SDK_WRITE_TOKEN` secrets | Repo secrets in the config repo. |
| `STAINLESS_WORKSPACE` env | Top of `stlc-generate.yml`. The workspace directory, relative to the config repo root (defaults to `stainless`). Spec and config file paths aren't env vars — they live in `stainless/workspace.json` (`openapi_spec`, `stainless_config`). |
| `DEFAULT_TARGETS` env | Top of `stlc-generate.yml`. `all` builds every configured target; or a comma-separated list. |
| Language toolchains | `setup-stlc/action.yml`. Drop the setup steps for languages you don't generate so the runner starts faster. |
| `stlc-*` plugins installed | `package.json` in the workspace dir. `pnpm install` reads this; there is no separate install list in the workflow. |

## Why these choices

A few details in the example files are non-obvious. The inline YAML comments in the files cover the full reasoning; what follows is the short version.

- **One `generate` job, two triggers.** `pull_request` (opened/synchronized/reopened) does the preview-branch push and sticky comment; `push` to `main` does the direct-to-`main` push on each staging repo. The job switches behavior off `github.event_name` and `github.event.pull_request.head.ref`, so secrets, env, and steps stay in one place.

- **`setup-stlc` exists because the install dance is private and multi-runtime.** It pins the language toolchains, sets a `git config insteadOf` rule that rewrites every `https://github.com/stainless/...` URL to include the read token in the userinfo (and the equivalent SSH-style URLs, since pnpm resolves `github:stainless/...` specifiers to SSH by default), and then runs `pnpm install --frozen-lockfile` in the workspace. The TypeScript SDK's `scripts/build` invokes `pnpm` directly, so pin `pnpm/action-setup` to the version in the TypeScript SDK's `packageManager` field.

- **`continue-on-error` on the render step.** If the build failed before producing a manifest, `stlc show` exits non-zero. We don't want that secondary failure to mask the real build failure in the job status — `continue-on-error: true` lets the render step fail silently and the comment step gates on `steps.manifest.outcome == 'success'`.

- **Commit subject on push to `main` comes from the PR title.** A pre-build step calls `gh api repos/{}/commits/{sha}/pulls` to find the PR that introduced the commit and uses its title as the SDK commit subject. This stays robust across squash/merge/rebase strategies (whereas `head_commit.message` alone gives `"Merge pull request #N from …"` on merge-commit repos).

- **`--trunk-branch main` lets a PR rebuild overwrite its own preview.** It marks `main` as the branch that gets promoted; every other branch is treated as a preview, so re-running a PR's build fast-forwards over its previous preview instead of failing to push. Only the trunk is protected from being overwritten this way. Set `--trunk-branch` if yours isn't `main`.

## Keeping tracking files in sync

`stlc` tracks sealed custom code with JSON files under `stainless/custom-code/` in the config repo. When `stlc build` regenerates a target that has custom code, it re-seals and rewrites those tracking files. This means that after a `push`-to-`main` build, the config repo's tracking files need to be updated to match the SDK repos.

Since `main` is usually a protected branch, the workflow can't commit them directly. Instead, the workflow opens a PR (branch `stlc/seal-tracking`) against the config repo with the updated tracking files. Merge it to bring the config repo in sync with staging. It pushes with the built-in `GITHUB_TOKEN` (hence `permissions: contents: write`), so no extra secret is needed.

The same seal-back PR is also opened by a scheduled `stlc-sync-tracking.yml` workflow. It catches custom-code changes that land on staging directly even when this config repo itself hasn't changed. It's config-driven (the config repo pulls staging) and runs on a schedule rather than a live trigger so that references only ever point downstream and the production repo is never referenced; see [Promote SDKs](./12-promote.md) for the full model, including the eager dispatch option for live propagation.

How the seal-back PR gets merged is your call:

- **Auto-merge**: enable GitHub auto-merge (or a branch rule) on the `stlc/seal-tracking` PR for hands-off operation. The tracking files land on `main` without anyone in the loop.
- **Require review**: leave it as a normal PR if you want a human to spot check tracking file changes before they reach `main`.

> If you'd rather CI not open these PRs, drop the seal step and the `guard` job and commit the tracking files by hand after each build (`git add stainless/custom-code/ && git commit && git push` from the config repo). `stlc status` flags uncommitted tracking files, so that remains your signal that they've drifted.

## Troubleshooting

### `stlc build failed for <target> at integrate:apply-patches`

`stlc` could not integrate sealed custom code onto the freshly generated SDK. Tracking-file edits in the SDK repo no longer apply cleanly to the new output.

To resolve:

1. Identify the tracking files for the target in `stainless.yml` (`targets.<target>.options.tracking` or repo-level tracking config).
2. Inspect the most recent integrated ref in the SDK repo:
   ```sh
   gh repo clone <org>/<sdk-repo> /tmp/<repo>
   cd /tmp/<repo>
   git fetch origin '+refs/stainless/*:refs/stainless/*'
   ls refs/stainless/custom-code/<target>/
   ```
3. Hand-merge the conflict in the tracking file, or re-seal by regenerating from a clean `main`.

After resolving, commit and push the tracking files from the config repo. The next workflow run picks up the resolved state.

### `Push did not land for <target>`

`stlc` built a commit locally but the push never created (or updated) the remote branch. Common causes:

- `SDK_WRITE_TOKEN` lacks `Contents:Write` on the SDK repo.
- The SDK repo has branch protection that rejects bot pushes.
- A pre-receive hook on the SDK repo rejected the commit.

### Push reached the remote but at a different SHA

An earlier push landed and the latest one did not, or someone else pushed to the same branch concurrently. Re-run the workflow.

## Staging and production repos

The `generate` job pushes regenerated SDKs to your staging SDK repo (`staging_repo`); the tracking-file seal-back PR it opens lands on the config repo, not here. If you also use a separate production repo, a companion workflow promotes staging `main` to production — a fast-forward push (recommended) or a merge-commit PR. See [Promote SDKs](./12-promote.md#choosing-how-to-promote) for the full model and reference workflows.

## See also

- [Promote SDKs](./12-promote.md)
- [Releasing SDKs](./13-release.md)
- [Custom code with stlc](./17-custom-code.md)
- [CLI reference](./15-cli-reference.md)
- [Diagnostics reference](https://stainless.com/docs/reference/diagnostics)
