---
title: "Workspaces"
description: "How stlc workspaces are structured, discovered, and configured."
slug: workspace
source: https://app.stainless.com/knock/transition/docs/workspace
---

# Workspaces

_How stlc workspaces are structured, discovered, and configured._

A workspace is the `stainless/` directory where `stlc` manages your OpenAPI spec, Stainless config, build outputs, and generated SDKs. It is self-contained: everything `stlc` needs to generate and manage your SDKs lives inside this directory.

## Creating a workspace

Initialize a workspace from a `.zip` bundle exported from the Stainless app:

```sh
stlc init --from-cloud ./bundle.zip
```

This creates a `stainless/` directory alongside your API source code. Targets come from the `targets` section of the bundled `stainless.yml`.

See the [CLI reference](./15-cli-reference.md) for the full flag list.

## Directory structure

A fully populated workspace looks like this:

```
acme-api/
├── src/
└── stainless/
    ├── workspace.json
    ├── stainless.yml
    ├── openapi.yml
    ├── .gitignore
    ├── README
    ├── custom-code/
    ├── builds/
    └── sdks/
        ├── typescript/
        ├── python/
        └── go/
```

| Path | Created by | Description |
|------|------------|-------------|
| `stainless/workspace.json` | `stlc init` | Workspace configuration. Records paths to your spec, config, and SDK output directory. |
| `stainless/stainless.yml` | `stlc init` | Your [Stainless config](https://stainless.com/docs/reference/config), shipped inside the bundle. Defines how endpoints map to resources, models, pagination, auth, and target-specific settings. |
| `stainless/openapi.yml` | `stlc init` | The OpenAPI spec shipped inside the bundle. |
| `stainless/.gitignore` | `stlc init` | Ignores `builds/` and the configured output directory so build artifacts and generated SDK repos are not committed to your config repo. Preserved verbatim if the bundle supplied its own. |
| `stainless/README` | `stlc init` | Optional README shipped inside the bundle. |
| `stainless/custom-code/` | `stlc init` | Optional custom code tracking shipped inside the bundle. |
| `stainless/builds/` | `stlc build` | Build manifests. Each file is named `bd_<id>.json` and records per-target status, diagnostics, lint/test script results, and the hashes of the spec and config used for that build. `stlc show` renders one as a report; `stlc diagnostics` shows just the diagnostics. |
| `stainless/sdks/` (or your `--output` directory) | `stlc build`, or `stlc init` when cloning SDK repos | Generated SDKs. Each subdirectory is its own git repository, one per target language. |

## The workspace.json file

The `workspace.json` file records paths that `stlc` commands use to locate your spec, config, and output directory. All paths are stored relative to the directory containing `workspace.json`.

```json
{
  "openapi_spec": "openapi.yml",
  "stainless_config": "stainless.yml",
  "output_path": "./sdks"
}
```

### Fields

| Key | Type | Description |
|-----|------|-------------|
| `openapi_spec` | `string` | Relative path from `workspace.json` to your OpenAPI specification file. Supports `.json`, `.yaml`, and `.yml`. |
| `stainless_config` | `string` | Relative path from `workspace.json` to your Stainless configuration file. Typically `stainless.yml`. |
| `output_path` | `string` | Relative path from `workspace.json` to the directory where generated SDKs are written. Each target language gets its own subdirectory. Defaults to `./sdks` unless you pass `--output` to `stlc init`. |

`openapi_spec` does not have to live inside the `stainless/` directory. Because it is resolved as a relative path from `workspace.json`, paths like `../openapi/spec.yml` are valid. See [Working with OpenAPI specs from other locations](./working-with-openapi-specs.md) for the common patterns: a spec checked in elsewhere in your repo, a spec generated at runtime by your API server, or a spec hosted at a remote URL.

## Workspace discovery

When you run a `stlc` command without explicit file paths, it searches up the directory tree from your current working directory for a directory named `stainless` containing a `workspace.json` file. Once found, it reads the spec, config, and output paths from that file.

```sh
# Auto-discovers stainless/workspace.json by walking up from cwd
stlc build
```

You can override individual settings from `workspace.json` using CLI flags. The flag value takes precedence over the workspace value:

```sh
# Uses spec from the flag, config and output from workspace.json
stlc build --spec ../beta-openapi.json
```

> **Note:**
>
> Use `--workspace <path>` to point a command at a specific workspace directory or `workspace.json` file. For one-off generation that should not touch any workspace, use `stlc generate`.

## Tracking files

When you use [custom code](./17-custom-code.md), `stlc build` automatically seals your customizations into tracking files under `stainless/custom-code/{target}/`. These small JSON files record the commit SHAs of your custom code so that the next `stlc build` can integrate your changes onto newly generated output.

Tracking files should be committed to your config repo alongside your OpenAPI spec and Stainless config. See [Branching and collaboration](./18-custom-code-collaboration.md) for how tracking files travel across branches and teammates.

## Differences from the SaaS workspace

If you have used the Stainless SaaS platform and its `stl` CLI, the `stlc` workspace differs in several ways:

| | SaaS CLI (`stl`) | SDK Generator CLI (`stlc`) |
|---|---|---|
| Directory name | `.stainless/` (hidden) | `stainless/` (visible) |
| `project` field | Present, links to your Stainless account | Not used |
| Output paths | Per-target (`targets.typescript.output_path`) | Single top-level `output_path` with one subdirectory per target |
| `production_repo` | In `workspace.json` per target | In `stainless.yml` per target |
| Build artifacts | Stored globally | Stored in workspace `builds/` directory |

For the SaaS workspace schema, see the [workspace reference](https://stainless.com/docs/reference/workspace).
