---
title: "Automate with stlc"
description: "Overview of the three-stage automation pipeline for SDKs generated with stlc — codegen, promote, and release."
slug: automate
source: https://app.stainless.com/knock/transition/docs/automate
---

# Automate with stlc

_Overview of the three-stage automation pipeline for SDKs generated with stlc — codegen, promote, and release._

Once you have `stlc` running locally, the next step is automating SDK generation end to end on GitHub. The pipeline has three stages, each backed by its own workflow:

1. **Codegen.** When an OpenAPI spec change merges in the config repo, regenerate SDKs and push them directly to every per-language staging repo's `main`. Optionally run a PR-time preview workflow that builds SDKs on every PR and posts diff links so reviewers can see SDK changes before merging the spec change.
2. **Promote.** Send staging `main` to production — a fast-forward push (recommended) or a merge-commit PR, depending on the [promote model you choose](./12-promote.md#choosing-how-to-promote). Staging is private and `stlc`-driven; production is the public-facing repo your users install from.
3. **Release.** Once staging is promoted to production (a fast-forward push, or merging the merge-commit PR), [release-please](https://github.com/googleapis/release-please) bumps versions, generates changelogs, tags releases, and publishes packages to npm, PyPI, and other registries.

![Two-repo automation flow: a PR to the API repo triggers `stlc build --push` to per-language private staging repos via the generate workflow; the promote workflow advances the public production repos (a fast-forward push or a merge-commit PR), which the release workflow tags and publishes to npm and PyPI.](./two-repo.png)

## The three workflows

Each stage is one GitHub Actions workflow. They share secrets and conventions; each page below has the full template and the rationale.

| Stage | Workflow file | Lives in | What it does |
|---|---|---|---|
| [Generate](./11-codegen.md) | `.github/workflows/stlc-generate.yml` (+ `.github/actions/setup-stlc`) | Config repo | Previews SDKs on every PR; regenerates and pushes to each SDK staging repo's `main` on merge |
| [Promote](./12-promote.md#choosing-how-to-promote) | `.github/workflows/stlc-promote.yml` | Each staging SDK repo | Advances production `main` from staging when it advances — a fast-forward push (recommended) or a merge-commit PR |
| [Back-sync](./12-promote.md#fast-forward-sync-recommended) | `.github/workflows/stlc-sync-from-production.yml` | Each staging SDK repo | Pulls production's release/version commits back onto staging `main` so the next build reseals cleanly (two-repo only) |
| [Release](./13-release.md) | `.github/workflows/release-please.yml` (+ per-language `publish-*.yml`) | Each production SDK repo | Tags, releases, and publishes to package registries |

## Where to start

If you are migrating from the Stainless app, the [Migration plan](./03-migration-plan.md#end-to-end-sequence) walks you through wiring all three stages in order.

If you are wiring automation on a fresh project, start with [Codegen](./11-codegen.md), then [Promote](./12-promote.md), then [Release SDKs](./13-release.md).
