---
title: "Migration plan"
description: "See the end-to-end migration flow."
slug: migration-plan
source: https://app.stainless.com/knock/transition/docs/migration-plan
---

# Migration plan

_See the end-to-end migration flow._

## How long this takes

| Project shape | Rough time |
| --- | --- |
| Single SDK, no custom code | 30-60 minutes |
| 2-3 SDKs, custom code | 1-2 hours |
| Many SDKs, heavy custom code | A few hours, plus a dry-run cycle |

Most of the time is spent on one-time GitHub setup: creating staging repos, wiring secrets, and adding workflows. Once those are in place, the daily loop is a single `stlc build`.

## Prerequisites

Before you start, gather the following:

| Prerequisite | Why |
| --- | --- |
| Access to `stlc` and `stlc-$target` repos | Required to install and use `stlc`. See [Activate `stlc` access](./04-migrate-activate.md). |
| GitHub org admin (or equivalent) on the SDK repos | Required to uninstall the Stainless GitHub App and to add repository secrets |
| Permission to create new repos in your GitHub org | Required to create the per-target staging repos during initialization |
| A fine-grained GitHub PAT (`SDK_WRITE_TOKEN`) with **Contents: read/write**, **Pull requests: read/write**, and **Workflows: read/write** scoped to your config repo, staging repos, and production repos | Powers the generate workflow's push to staging. Scoped this broadly, one PAT can also back the secrets the other workflows use — `PRODUCTION_REPO_TOKEN` (the promote push) and `RELEASE_PLEASE_TOKEN` (release-please on production). |
| A classic GitHub PAT (`STLC_READ_TOKEN`) with the `repo` scope | Used in CI to clone the `stlc-*` packages. Must be a classic PAT; SSO-authorize it for your own org if you use SSO. You can only mint this PAT after [activating `stlc` access](./04-migrate-activate.md) and accepting your GitHub invites, so do that first. |
| Node.js 24 or later | Required to install and run `stlc` |
| `unzip` on your `PATH` | Required by `stlc init` to extract the bundle |
| Language toolchains for the targets you build, if you run `stlc build` locally | Each target's native compiler, formatter, and test runner is invoked during a build. See [Set up a local environment](./14-local-environment.md) for Homebrew, mise, Nix, and Docker setup options. |

## Pre-flight checklist

Run through this checklist before downloading any bundles so the snapshot starts from a clean state:

- **Merge every open release PR** that the Stainless GitHub App has opened against `main` (or your configured release branch) in each production repo. Merging the release PR promotes whatever was queued on `next` into `main`, so once every release PR is merged, `next` and `main` are aligned and nothing is left stranded by the cutover.
- **Resolve any in-progress custom code conflicts** so the bundle includes a clean state.
- **Stop editing custom code in your Stainless project.** From the moment you download the bundle, all new custom code belongs in the `stlc` workflow. Anything you change after download will not be in the snapshot and will be silently dropped on the next `stlc build`.
- **Note your `production_repo` and `staging_repo` settings** for each target. `stlc init --from-cloud` reads these from the bundle's `stainless.yml` and uses them to clone your SDK repos. Targets that currently rely on a `stainless-sdks/<repo>` staging remote will need their `staging_repo` pointed at the new repo you create during initialization. If you want to point `stlc` at a different remote, edit `stainless.yml` after `stlc init` and update the origin repo rather than changing it in the app.

## Recommended flow

You own a private **staging repo** per target and a public **production repo** that your users install from. `stlc build --push` lands generated SDK code on staging. A promote workflow advances production `main` when staging advances — a fast-forward push (recommended) or a merge-commit PR — and release-please tags and releases from production to package managers. This mirrors how the Stainless app works today.

Today, the per-target staging contents live in the `stainless-sdks` GitHub org that Stainless maintains on your behalf. The initialization step below mirrors each `stainless-sdks/<repo>` into a new private staging repo that you own, so the move is transparent to users and you keep the existing git history. The `stainless-sdks` org will be archived once migrations are complete.

![Recommended flow: a PR to the API repo triggers stlc build --push to per-language private staging repos; a promote workflow advances the public production repos (a fast-forward push or a merge-commit PR), which release-please tags and publishes to npm and PyPI.](./two-repo.png)

## End-to-end sequence

1. **[Activate `stlc` access](./04-migrate-activate.md).** As org admin, accept the `stlc` license to activate it for your org. Then request your own GitHub repo invite and accept it — you need access before you can mint `STLC_READ_TOKEN`. Anyone else on the team who needs `stlc` will request their own invite the same way. Then complete the [pre-flight checklist](#pre-flight-checklist) above and mark migration started in the Stainless dashboard.
2. **[Install `stlc`](./05-migrate-install.md).** Install the CLI plus one `stlc-$target` package per language you generate.
3. **[Initialize your workspace](./06-migrate-initialize.md).** Create a private staging repo per target in your GitHub org (suggested naming: `<org>-<lang>-staging`) and mirror each current `stainless-sdks/<repo>` into it so you keep git history. Then run `stlc init --from-cloud ./bundle.zip` in your config repo; when prompted, set each target's `staging_repo` to the staging repo you just created.
4. **[Run your first build](./07-migrate-build.md).** Check out a branch, run `stlc build --commit "feat: initial stlc build"`, run `stlc test`, and push the build to staging with `stlc build --push`.
5. **[Validate parity](./08-migrate-validate.md).** Diff the freshly built SDK against the SaaS-published SDK and confirm there is no behavior-bearing drift before continuing.
6. **[Automate builds](./10-automate.md).** Wire up the three GitHub Actions workflows:
   - [Generate workflow](./11-codegen.md) (and [optional preview](./11-codegen.md)) in the config repo, so spec changes regenerate SDKs and push them to each staging repo's `main`.
   - [Promote and back-sync workflows](./12-promote.md#choosing-how-to-promote) (fast-forward-only is recommended for two repos) plus the cross-repo token in each staging repo.
   - `RELEASE_PLEASE_TOKEN` in each production repo, with the [release-please workflow](./13-release.md) committed alongside it.

   Once all three are in place, open a PR in the config repo that touches the spec (for example, update a field description) and walk it end-to-end through preview, merge, sync PR, release PR, and publish.
7. **[Finish cutover](./09-migrate-cutover.md).** Uninstall the Stainless GitHub App and mark the migration complete in the dashboard.

> **Note:**
>
> If you hit a state you cannot recover from, contact transition@stainless.com before deleting repos or projects.
