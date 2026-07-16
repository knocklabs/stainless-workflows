---
title: "Architecture: how the repos fit together"
description: "How stlc's config, staging, and production repos relate, and how generated code, custom code, and releases flow between them."
slug: architecture
source: https://app.stainless.com/knock/transition/docs/architecture
---

# Architecture: how the repos fit together

_How stlc's config, staging, and production repos relate, and how generated code, custom code, and releases flow between them._

`stlc` coordinates up to three kinds of git repository. Knowing what each one holds, and which direction changes flow, makes the rest of the workflow — custom code, promotion, releases — easy to reason about.

## The repos

- **Config repo** — holds your `stainless/` workspace: the OpenAPI spec, `stainless.yml`, and the custom-code **tracking files** under `stainless/custom-code/<target>/`. It is the source of truth for *what custom code has been sealed* — each tracking file records a `base` SHA (the last purely-generated baseline) and an `integrated` SHA (custom code applied on top). You run `stlc build` here.
- **SDK staging repo** (one per target) — `stlc`'s working repo for a language. `stlc build --push` lands generated code, the integrated custom-code commits, and the sealed refs here. Private, in the recommended setup.
- **SDK production repo** (one per target) — the public repo your users install from. `stlc` never writes to it directly; a promote step moves released content here, and release-please versions and publishes from it.

A single-repo setup collapses staging and production into one repo and skips the promote step entirely. See [Choosing how to promote](./12-promote.md#choosing-how-to-promote).

## How changes flow

Code references point **downstream only** — `config → staging → production`. Each repo reaches the one below it; the public production repo holds no token that can read or push code to your internal repos, and no reference to the config repo at all. Its one upstream link is a narrowly-scoped dispatch token (part of the recommended setup) that lets a release *trigger* the back-sync on staging — never perform it. Changes travel around a loop:

```
   spec/config change
          │
          ▼
   ┌──────────────┐   generate (stlc build --push)   ┌──────────────┐
   │  config repo │ ───────────────────────────────▶ │ staging repo │
   │ (spec, config│ ◀─────────────────────────────── │  (private)   │
   │  tracking)   │      seal-back (tracking files)   └──────┬───────┘
   └──────────────┘                                          │ promote
                                                             ▼
                                          ┌───────────────────────────┐
                                          │      production repo       │
                                          │  (public; release-please)  │
                                          └───────────────────────────┘
                                              │ back-sync (release commits,
                                              ▼  contributions) → staging
```

1. **Generate.** A spec/config change merges in the config repo; `stlc build --push` regenerates each SDK, integrates sealed custom code onto the fresh output, pushes to the **staging** repo, and updates the tracking files in the config repo.
2. **Promote.** Staging `main` advances to **production** — a direct fast-forward push (recommended) or a merge-commit release PR. See [Promote SDKs](./12-promote.md).
3. **Release.** [release-please](https://github.com/googleapis/release-please) on the production repo bumps the version, updates the changelog, tags the release, and publishes.
4. **Back-sync.** Production's release commits (and any contributions merged on production) flow back to **staging**, so the next build reseals against the released state.
5. **Seal-back.** When out-of-band custom code lands on staging, the **config** repo's tracking files are updated to match — on a schedule, or eagerly on push.

## Custom code and the tracking files

Custom code is hand-written change layered on top of generated output. `stlc` preserves it across regenerations by *sealing* it: the tracking file's `base`/`integrated` SHAs capture the delta, and every build integrates that delta onto freshly generated code. Because the tracking files live in the **config repo**, they must be committed alongside your spec and config. An uncommitted or stale tracking file is the most common source of trouble — see [Common pitfalls](./20-common-pitfalls.md).

## Why downstream-only

The production repo is public and user-facing, so it holds no token that can read or push code to your private staging or config repos, and no reference to the config repo at all. Its only upstream link is the narrowly-scoped `STAGING_DISPATCH_TOKEN` (a fine-grained PAT with `Contents: write` on the staging repo only), used solely to *trigger* — never perform — the back-sync: on a published release, `trigger-back-sync-on-release.yml` on production sends one `repository_dispatch` to staging so the back-sync runs within seconds. The back-sync itself runs on staging and is pull-based — it fetches production and fast-forwards staging. A contribution merged on production is therefore *pulled* down to staging (which already has access to production), and sealed into the config repo's tracking files from the config side — never pushed up. This keeps code-bearing credentials out of the public repo. See [Accepting community contributions on production](./12-promote.md#accepting-community-contributions-on-production).

## See also

- [Promote SDKs](./12-promote.md) — the promote and back-sync models in detail
- [Custom code with stlc](./17-custom-code.md) — author and seal custom code
- [Codegen](./11-codegen.md) — automate generation when the spec changes
- [Releasing SDKs](./13-release.md) — versioning and publishing
- [Common pitfalls](./20-common-pitfalls.md) — what most often trips people up
