---
title: "Initialize your workspace"
description: "Download a bundle, run stlc init, and review the cloned SDK repos."
slug: migrate-initialize
source: https://app.stainless.com/knock/transition/docs/migrate-initialize
---

# Initialize your workspace

_Download a bundle, run stlc init, and review the cloned SDK repos._

> **Warning:**
>
> Each bundle is a snapshot of your OpenAPI spec, Stainless config, and custom code at the moment you download it. Do not add or edit custom code in your Stainless project after downloading until the migration is complete — the snapshot won't include those changes, and the next `stlc build` won't know to integrate them. Use the [`stlc build`](./17-custom-code.md) workflow for all new custom code from this point on.

Once `stlc` is installed, you initialize a workspace from your bundle. `stlc init` extracts the bundle into your current directory and clones your configured SDK repos so you can start generating immediately with existing git history.

## Download your bundles

Each bundle contains a single top-level `stainless/` directory with, at minimum, your OpenAPI spec (`openapi.yml`, `openapi.yaml`, or `openapi.json`) and your `stainless.yml`. Projects that use custom code also include those files.

Save each `.zip` anywhere on your machine — the path is the only thing `stlc init` needs.

```widget:download-bundles```

## Initialize the workspace

Run `stlc init` from the root of the repo where you manage your API (typically a dedicated API repo or the monorepo that contains it). This is your **config repo**: the git repo where the `stlc` [workspace](./16-workspace.md) lives, alongside the source of truth for your OpenAPI spec.

```sh
cd path/to/your-api-repo
stlc init --from-cloud ./acme-bundle.zip
```

Or use the per-project commands below, prefilled for your bundles:

```widget:init-commands```

`stlc init` extracts the bundle and copies the entire `stainless/` tree verbatim into your current directory, including your spec, your `stainless.yml`, and any optional `custom-code/`, `README`, or `.gitignore` shipped in the bundle. Target languages come from the `targets` section of your bundled `stainless.yml`. There is no `--targets` flag in this mode.

A typical workspace after `stlc init --from-cloud` looks like:

```
my-api/
  stainless/
    workspace.json
    stainless.yml
    openapi.yml
    .gitignore
    custom-code/
```

The `stainless/` directory is your **workspace**: a self-contained tree that holds your OpenAPI spec, Stainless config, custom code, and (after your first build) generated SDKs and build manifests. `workspace.json` at its root records the paths `stlc` uses to find your spec, config, and SDK output directory.

Every subsequent `stlc` command, such as `stlc build`, `stlc test`, or `stlc exec`, walks up from your current working directory to find this `workspace.json` and uses it to locate everything else. As long as you run commands from inside the config repo (or a subdirectory of it), `stlc` discovers the workspace automatically; no flags required. To point a command at a different workspace, pass `--workspace <path>`.

See [Workspaces](./16-workspace.md) for the full structure, discovery rules, and `workspace.json` reference.

## Review cloned SDK repos

For every target in your `stainless.yml` with a `staging_repo` or `production_repo`, `stlc init` clones the SDK repo into your output directory (default `./sdks`). The clone source is the bundle's `staging_repo` (typically `stainless-sdks/<your-sdk>`) so the full ref history, including custom-code tracking refs, lands in your local checkout one final time.

After cloning, `stlc init` prompts you for the staging repo to use from this point on. In an interactive terminal it prints a `gh repo create <owner>/<repo>-staging --private` command for each cloned target, then prompts once per target with the production repo as the default:

```
Staging repo for typescript: (acme/acme-typescript)
```

Set this to the staging repo you created at the start of [Initialize your workspace](./03-migration-plan.md#end-to-end-sequence). Press Enter to accept the default if you want to reuse the production repo as your staging repo (the "work in public" path). Either way, `stlc` rewrites the local `origin` remote to point at the chosen repo and writes the chosen value back to `stainless.yml` as the target's `staging_repo`; `production_repo` is left untouched. The `stainless-sdks/...` clone source is never persisted as `staging_repo`.

Targets that have neither `staging_repo` nor `production_repo` configured are dropped from `stainless.yml` with a warning, since `stlc` has no SDK repo to operate on for them.

See [Workspaces](./16-workspace.md) for the full clone behavior and repo matrix.
