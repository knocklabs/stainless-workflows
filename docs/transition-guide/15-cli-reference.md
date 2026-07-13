---
title: "stlc CLI reference"
description: "Complete reference for all stlc commands, flags, and environment variables."
slug: cli-reference
source: https://app.stainless.com/knock/transition/docs/cli-reference
---

# stlc CLI reference

_Complete reference for all stlc commands, flags, and environment variables._

## Usage

```
stlc [command] [options]
```

### Global options

These flags apply to every command:

| Flag | Description |
| --- | --- |
| `-h, --help` | Display help for a command. |
| `-f, --format <format>` | Output format: `text` or `json`. Defaults to `text`. Use `json` for machine-readable output in CI, including full build results from `stlc build`. |
| `-q, --quiet` | Suppress non-essential stderr output. |
| `-v, --verbose` | Emit verbose diagnostic output on stderr. |

## Commands

### `stlc init`

Initialize a new Stainless workspace from a Stainless cloud bundle exported from the Stainless app.

```sh
stlc init --from-cloud <bundle>.zip
```

`stlc init` refuses to run if a `stainless/` directory already exists in the current working directory.

**Options:**

| Flag | Description |
| --- | --- |
| `--from-cloud <zip>` | Path to a `.zip` bundle exported from the Stainless app. Requires the `unzip` binary to be on your `PATH`. |
| `--output <dir>` | Where generated SDKs will be written. Defaults to `./sdks` (stored relative to the `stainless/` directory in `workspace.json`). |
| `--ssh` | Clone SDK repos over SSH (`git@host:owner/repo.git`) instead of HTTPS. |
| `--dry-run` | Describe what would be created without writing files or cloning. |

**What gets created:**

`stlc init` extracts the bundle and copies the entire `stainless/` tree into place, preserving the spec, config, and any `custom-code/` or `README` included in the bundle. SDK repos declared in the bundled config are cloned from `staging_repo` (mirrored from `production_repo` if only the latter is set), with an interactive prompt to override the `origin` remote per target. Targets configured with neither field are dropped from `stainless.yml` and listed in the `Created` summary.

See [Workspaces](./16-workspace.md#directory-structure) for the full on-disk layout.

---

### `stlc build`

Build SDKs for a Stainless workspace and save a build manifest. This is the recommended way to generate SDKs day-to-day: it reads `workspace.json`, produces the configured targets, integrates any sealed custom code onto the fresh output (by running the [`stlc integrate`](#stlc-integrate) step at the end of the build), and records the run so you can inspect it later with [`stlc show`](#stlc-show) or [`stlc diagnostics`](#stlc-diagnostics).

```sh
stlc build [options]
```

**Options:**

| Flag | Description |
| --- | --- |
| `--workspace <path>` | Path to a workspace directory or `workspace.json`. Defaults to the nearest `stainless/workspace.json` walking up from the current directory. |
| `--spec <path>` | Override the OpenAPI spec path recorded in `workspace.json`. |
| `--config <path>` | Override the `stainless.yml` path recorded in `workspace.json`. |
| `--output <dir>` | Override the SDK output directory recorded in `workspace.json`. |
| `-t, --targets <targets>` | Comma-separated list of targets to build, or `all`. Defaults to `all`. |
| `--sdk-version <version>` | Override the SDK version for every target. Must be a valid semver string. |
| `-c, --concurrency <n>` | Number of targets to generate in parallel. Defaults to `min(cpuCount, 2)`. |
| `--no-format-sdk` | Skip each target's `./scripts/format` after generation. Format runs by default. |
| `--no-lint` | Skip each target's `./scripts/lint` after generation. Lint runs by default. |
| `--test` | Run each target's `./scripts/test` after generation. Defaults to `false`. |
| `--dry-run` | Describe what would happen without writing files or running scripts. |
| `-w, --watch` | Re-run on spec or config changes. Cannot be combined with `--push`. |
| `--branch <name>` | Branch name for the SDK repo. Defaults to the current git branch; required outside a git repo. |
| `--trunk-branch <name>` | The branch that is promoted to production. Defaults to `main`. Any other branch is treated as an ephemeral preview branch, so rebuilding it overwrites its own previous remote tip rather than failing; the trunk itself is never overwritten this way. |
| `--commit <message>` | Label the integrated commit on the SDK branch with this message instead of the default `Build SDK`. If the SDK repo also has uncommitted changes when the build starts, they are committed with this same message before being sealed as custom code. |
| `--push` | Push each target branch to `origin` after a successful build and integrate. Cannot be combined with `--watch`. Never force-pushes. |
| `--strict [steps]` | Abort the pipeline on failure of the listed soft-fail step(s). `build`, `lint`, and `test` default to continuing on failure (the target is still reported as `error`); pass `--strict <step>` to halt subsequent steps when that step fails, or bare `--strict` to apply to all three. |
| `--abort` | Abort any in-progress generate or integration across the selected targets. Mutually exclusive with `--continue`. |
| `--continue` | Resume any in-progress integration across the selected targets after resolving conflicts. Mutually exclusive with `--abort`. |

**Recovering from a failed or interrupted build:**

If `stlc build` stops partway (for example, on a custom-code conflict or a crash during generation), recover from the same command rather than dropping down to `stlc integrate`:

- `stlc build --continue` resumes an in-progress integration after you have resolved conflicts. It works across every selected target, so multi-target workspaces recover in one invocation.
- `stlc build --abort` discards partial generate output and aborts in-progress integrations, restoring the last good state.

When a target fails, `stlc build` prints a per-target next-action line (for example, "Run `stlc build --continue`") so you do not need to run `stlc status` first.

**What gets written:**

Every `stlc build` run writes a manifest to `stainless/builds/bd_<id>.json`. The manifest records per-target status, file counts, lint/test script results, diagnostics, and hashes of the spec and config used for that build. Subsequent `stlc status` calls compare those hashes to the current files to detect drift.

Inspect a build with [`stlc show`](#stlc-show) (full report) or [`stlc diagnostics`](#stlc-diagnostics) (diagnostics only).

**Exit codes:**

| Code | Meaning |
| --- | --- |
| `0` | All targets generated successfully. |
| `1` | One or more targets produced a fatal diagnostic, or a lint/test script failed. |

---

### `stlc test`

Run `./scripts/test` in each SDK repo. Each generated SDK ships with a `./scripts/test` that handles language-specific tooling (for example, `pytest` for Python, `vitest` for TypeScript, `go test` for Go).

```sh
stlc test [options] [-- <script-args...>]
```

Arguments after `--` are forwarded to the underlying script. If a target's SDK repo does not exist, it is reported as `directory not found`; if the script itself is missing, the underlying spawn fails and the target is reported as failed.

**Options:**

| Flag | Description |
| --- | --- |
| `-t, --targets <targets>` | Targets to run in (comma-separated, or `all`). Defaults to `all`. |

**Examples:**

```sh
stlc test
stlc test --targets python,ruby
stlc test -- --watch
```

You can also run tests as part of a build by passing `--test` to [`stlc build`](#stlc-build). See [Working across SDKs](./19-working-across-sdks.md) for worked examples.

---

### `stlc lint`

Run `./scripts/lint` in each SDK repo. Each generated SDK ships with a `./scripts/lint` that handles language-specific linting (for example, `ruff` for Python, `eslint` for TypeScript, `golangci-lint` for Go).

```sh
stlc lint [options] [-- <script-args...>]
```

Arguments after `--` are forwarded to the underlying script. If a target's SDK repo does not exist, it is reported as `directory not found`; if the script itself is missing, the underlying spawn fails and the target is reported as failed.

**Options:**

| Flag | Description |
| --- | --- |
| `-t, --targets <targets>` | Targets to run in (comma-separated, or `all`). Defaults to `all`. |

**Examples:**

```sh
stlc lint
stlc lint --targets python,ruby
stlc lint -- --fix
```

[`stlc build`](#stlc-build) runs the linter automatically after generation; pass `--no-lint` to skip. See [Working across SDKs](./19-working-across-sdks.md) for worked examples.

---

### `stlc format`

Run `./scripts/format` in each SDK repo. Each generated SDK ships with a `./scripts/format` that handles language-specific formatting (for example, `ruff format` for Python, `prettier` for TypeScript, `gofmt` for Go).

```sh
stlc format [options] [-- <script-args...>]
```

Arguments after `--` are forwarded to the underlying script. If a target's SDK repo does not exist, it is reported as `directory not found`; if the script itself is missing, the underlying spawn fails and the target is reported as failed.

**Options:**

| Flag | Description |
| --- | --- |
| `-t, --targets <targets>` | Targets to run in (comma-separated, or `all`). Defaults to `all`. |

**Examples:**

```sh
stlc format
stlc format --targets python,ruby
stlc format -- --check
```

[`stlc build`](#stlc-build) and [`stlc generate`](#stlc-generate) run the formatter automatically after generation; pass `--no-format-sdk` to skip. See [Working across SDKs](./19-working-across-sdks.md) for worked examples.

---

### `stlc exec`

Execute an arbitrary shell command in each SDK repo. Useful for git operations and other commands that need to run across every repo in a workspace.

```sh
stlc exec [options] -- <command...>
```

Everything after `--` is treated as the command to run. The command executes once per target, with the working directory set to that target's SDK repo. Running `stlc exec` without `--` exits with `error: no command specified. Usage: stlc exec [options] -- <command>`.

**Options:**

| Flag | Description |
| --- | --- |
| `-t, --targets <targets>` | Targets to run in (comma-separated, or `all`). Defaults to `all`. |

See [Working across SDKs](./19-working-across-sdks.md) for common patterns like checking diffs after generation, staging and committing across repos, and pushing changes.

---

### `stlc integrate`

> **Note:**
>
> For normal use, run [`stlc build`](#stlc-build), which runs `stlc integrate` automatically at the end of every build. To recover from a conflict, prefer [`stlc build --continue`](#stlc-build) and [`stlc build --abort`](#stlc-build): they iterate across every selected target in one call. Reach for `stlc integrate` directly only to integrate custom code without regenerating (for CI or debugging), to `--dry-run` an integration without running codegen, or to resolve a single target with the `--continue <tree-ish>` form. `stlc build` also forwards `--commit`, so you do not normally need to call `stlc integrate --commit` yourself.

Integrate sealed custom code onto generated SDK code. `stlc integrate` initializes the SDK repo if needed, commits the freshly generated code, pulls any sealed custom-code patches from the remote, and integrates them onto the current branch.

Before integrating, `stlc integrate` seals any unsealed custom code in the SDK repo into a tracking file; after integrating onto the new base, it updates the tracking file again.

See [Custom code](./17-custom-code.md) for the workflow and [Branching and collaboration](./18-custom-code-collaboration.md) for how custom code travels across branches and teammates.

```sh
stlc integrate [options]
```

**Options:**

| Flag | Description |
| --- | --- |
| `--workspace <path>` | Path to a workspace directory or `workspace.json`. Defaults to the nearest workspace. |
| `--spec <path>` | Override the OpenAPI spec path. |
| `--config <path>` | Override the `stainless.yml` path. |
| `--output <dir>` | Override the SDK output directory. |
| `-t, --targets <target>` | SDK target language (for example, `python` or `typescript`). Required when the workspace configures more than one target. |
| `--branch <name>` | Branch name for the SDK repo. Defaults to the branch currently checked out in that repo. |
| `--theirs` | When tracking files conflict across branches, auto-resolve by taking the other branch. |
| `--commit <message>` | If the SDK repo has uncommitted changes, commit them with this message before sealing them as custom code. |
| `--dry-run` | Print what would be done without executing. |
| `--continue [tree-ish]` | Resume after resolving conflicts. For merge conflicts, continues the underlying git operation. For apply conflicts, optionally accepts a tree-ish to use as the conflict resolution. |
| `--abort` | Abort an in-progress integration. Cleans up integration refs, aborts any in-progress rebase or merge, and resets the branch to `gen-head`. |

**Preconditions:**

- No integration may already be in progress (unless using `--continue` or `--abort`).
- If tracking files exist, the SDK remote must be reachable and contain the referenced commits.
- If you have unsealed custom code AND a dirty working tree, you must pass `--commit <message>` so the uncommitted changes can be committed before being sealed.

**Exit codes:**

| Code | Meaning |
| --- | --- |
| `0` | Integration completed successfully, or `--abort` succeeded. |
| `1` | Conflict encountered (resolve and use `--continue` or `--abort`), or a precondition failed. |

**Internal refs (debugging only):**

You do not need to know these for normal use; `stlc status` names any state you can recover from and the command to run. During integration, `stlc` creates local refs in the SDK repo:

| Ref | Purpose |
| --- | --- |
| `refs/stainless/gen-head` | The commit of the freshly generated code. Persists across integrations; updated each time. Used by `--abort` to reset the branch. |
| `refs/stainless/integrate/merged-base` | The merged base commit. Its presence indicates an integration is in progress. Deleted on success or abort. |
| `refs/stainless/integrate/pending/*` | Integrated commits waiting to be merged. Deleted one at a time as each merge completes, or on abort. |
| `refs/stainless/integrate/apply-phase` | Marks that the integration has entered the apply stage. Its presence tells `--continue` to finish an apply conflict rather than a merge conflict. Deleted on success or abort. |

---

### `stlc status`

Show the current state of generation and custom-code integration for a target. `stlc status` reports whether the generated output is up to date with the current spec and config (by comparing hashes against the latest build manifest), and whether custom code is clean, unsealed, or mid-integration. It is always safe to run.

`stlc status` is the "what now?" command: for every non-idle state it names the exact command to run next. If you are ever unsure what to do, run `stlc status` and follow its instructions.

```sh
stlc status [options]
```

**Options:**

| Flag | Description |
| --- | --- |
| `--workspace <path>` | Path to a workspace directory or `workspace.json`. |
| `--spec <path>` | Override the OpenAPI spec path. |
| `--config <path>` | Override the `stainless.yml` path. |
| `--output <dir>` | Override the SDK output directory. |
| `-t, --targets <targets>` | Targets to show (comma-separated, or `all`). Defaults to `all`. Each selected target is reported in turn. |
| `--remote` | Also verify each target's sealed `base`/`integrated` SHAs are present on `origin` (makes a network call). Off by default so plain `stlc status` stays fast and local. |

**Generation status:**

| State | Message | Next step |
| --- | --- | --- |
| No build run yet | `No generated output found.` | Run [`stlc build`](#stlc-build). |
| Spec changed | `OpenAPI spec has changed since last generation.` | Run `stlc build` to refresh. |
| Config changed | `stainless.yml has changed since last generation.` | Run `stlc build` to refresh. |
| Both changed | `OpenAPI spec and stainless.yml have changed since last generation.` | Run `stlc build` to refresh. |
| Up to date | _(no line printed)_ | None needed. |

**Integration state:**

| State | Message | Next step |
| --- | --- | --- |
| No SDK repo | `No SDK repo found.` | Run `stlc integrate` to initialize. |
| No integration yet | `No integration has been run yet.` | Run `stlc integrate` to start. |
| Clean | `No custom code. Generated code is current.` | None needed. |
| Up to date | `Custom code is sealed and up to date.` | None needed. |
| Unsealed changes | `Unsealed changes detected.` | Run `stlc build` again (or `stlc build --commit "<msg>"` if you have uncommitted SDK edits) to seal and integrate. |
| Output newer than integration | `Generated code has changed since last integration.` | Run `stlc build` to integrate custom code. |
| Integration conflict | `Integration in progress: conflict` | Resolve the conflict, then run `stlc build --continue`. |
| Integration in progress | `Integration in progress: N patch(es) remaining` | Run `stlc build --continue`. |
| Generation interrupted | `A prior generate did not complete.` | Run `stlc build --abort --target <t>` to restore the last good state. |
| Last build failed | `Last build failed during <step>.` (or `Last build failed during codegen.` / `Last build failed during scripts/<name>.`) | Inspect with `stlc diagnostics --target <t>` (codegen) or the step's stderr tail (script failures), then re-run `stlc build`. Suppressed once the spec or config changes. |

**Warnings:**

`stlc status` also prints non-blocking warnings that you should address but which do not stop `stlc build` from running:

- The tracking file in `stainless/custom-code/` is uncommitted in the config repo.
- The tracking file is committed but not pushed, so collaborators and CI cannot see the sealed custom code.
- The SDK branch has commits ahead of `origin`; run `stlc exec --target <t> -- git push` to publish them.
- Multiple tracking files exist for one target (the next successful build consolidates them).
- Orphaned integrate artifacts remain from a previous crash; run `stlc build --abort` to clean up.
- With `--remote`: sealed custom-code commits are missing on `origin`, so a fresh checkout or CI cannot fetch them; re-run `stlc build --push` to re-publish them.

---

### `stlc repair`

Recover a target from a broken custom-code state. Where `stlc status` tells you *what* is wrong, `stlc repair` fixes what it safely can and hands the rest back with the exact command to run. Its guiding rule: **never discard custom code without an explicit confirmation and a backup.**

```sh
stlc repair [options]
```

**Options:**

| Flag | Description |
| --- | --- |
| `-t, --targets <targets>` | Targets to repair (comma-separated, or `all`). Defaults to `all`. |
| `--dry-run` | Report what would be repaired without changing anything. |
| `--force` | Opt in to recoveries that reconstruct lost tracking or re-anchor diverged custom code from git (see below). Off by default. |

**What it handles:**

| State | Action |
| --- | --- |
| Leftover integration artifacts (a crash, or a manual `git merge --abort`) | Cleared automatically — they are dead state. |
| Integration in progress | Handed back: resolve and run `stlc build --continue`, or `stlc build --abort` to discard it. |
| A generate that did not finish | Handed back: `stlc build --abort`. |
| A tracking file is missing while origin still holds sealed custom code (deleted, or never committed back) | Reconstructed from git with `--force` (base from the seal trailer, integrated at the branch tip). Without `--force`, `repair` reports it and points you at the command. |
| Custom code has diverged from origin but **shares history** (sibling) | Handed back: merge origin into the SDK repo, then re-build. |
| Custom code has diverged from origin with **no shared history** (orphan) — the unrecoverable state | With `--force`: saves your custom code as a `git format-patch` backup **first**, then re-anchors the tracking file to origin. Without `--force`, `repair` reports it and points you at the command. |
| Nothing wrong | Reports "nothing to repair." |

Exits non-zero when a target is left in a state `repair` could not resolve on its own, so scripts and CI can tell a clean run from one that needs a human.

Reconstructing a tracking file is non-destructive — it writes the config-repo JSON pointing at commits already on origin; nothing is overwritten. The orphan re-anchor is the one lossy recovery, which is why it is behind `--force` and always saves a patch of your custom code before touching anything (printed path under `stainless/repair-backups/`); reapply it if you still need those changes.

See [Recover a broken workspace](./recovery.md) for the full playbook.

---

### `stlc diagnostics`

Show diagnostics from a build. Defaults to the latest build if no ref is provided.

```sh
stlc diagnostics [options] [ref]
```

**Arguments:**

| Argument | Description |
| --- | --- |
| `ref` | Build ID (for example, `bd_75SH2lQr-zealous-pulp`) or path to a JSON build manifest. If omitted, shows diagnostics for the latest build in the workspace. |

**Options:**

| Flag | Description |
| --- | --- |
| `-t, --targets <targets>` | Only show diagnostics for the given target(s) (comma-separated, or `all`). Defaults to `all`. |

**Output format:**

Use the global `-f json` / `--format json` flag for machine-readable output: `stlc -f json diagnostics`.

**Example output:**

```
$ stlc diagnostics
Build:  bd_75SH2lQr-zealous-pulp
Date:   2026-05-12 08:49:30 (1 hour ago)
Status: success

warning[Schema/PatternNotValid]: Ignored invalid pattern `^(?!^[-+.]*$)[+-]?0*\d*\.?\d{0,2}0*$`, which may cause test failures.
  source: csharp
  --> (resource) characters > (method) create > (params) default > (param) salary_gbp > (schema) > (variant) 1

warning[Name/Collision]: Possible undesirable name generated for language
  source: csharp
  --> (resource) webhooks > (method) create > (params) default > (param) url > (schema)

note[Schema/EnumHasOneMember]: Confirm intentional use of `enum` with single member.
  source: csharp, java, kotlin
  --> (resource) webhooks > (model) match_completed_webhook_event > (schema) > (property) event_type
```

Each diagnostic includes a severity level (`fatal`, `error`, `warning`, or `note`), a diagnostic code, a message, the affected target(s) on a `source:` line, and a source location pointing to the relevant resource, model, or endpoint in your config.

When stdout is a TTY, output is piped through `$PAGER` (or `less -R` if unset).

---

### `stlc show`

Render a build manifest as a full report: per-target status, diagnostics, and metadata. Where `stlc diagnostics` shows just the diagnostic lines, `stlc show` summarizes the whole build, which makes it the right tool for PR comments and CI step summaries.

```sh
stlc show [options] [build-id-or-path]
```

**Arguments:**

| Argument | Description |
| --- | --- |
| `build-id-or-path` | Build ID (for example, `bd_75SH2lQr-zealous-pulp`) or path to a JSON build manifest. If omitted, shows the latest build in the workspace. |

**Options:**

| Flag | Description |
| --- | --- |
| `--renderer <name>` | Output renderer: `text` (default, terminal-friendly with chalk colors) or `markdown` (GitHub-flavored, suitable for sticky PR comments and `$GITHUB_STEP_SUMMARY`). |
| `--workspace <path>` | Workspace dir to search for manifests when no build id is given. |
| `--base <build-id-or-path>` | Manifest to diff against. Defaults to the second-newest in the workspace, which makes per-step status (`generate ✓ → lint ✗`) and "new vs total" diagnostic counts compare against the prior build. |
| `--marker <html>` | Hidden HTML comment marker prepended to markdown output so a CI script can find and update the sticky PR comment in place. Markdown renderer only. |
| `--workflow-run-url <url>` | URL embedded in the markdown footer as "re-run this workflow". Markdown renderer only. |

**Example (text renderer):**

```
$ stlc show
✱ stlc build

✓ go branch=preview/feat-x commit=aaa1111 86 files (pushed)
    generate ✓ → bootstrap ✓ → build ✓ → lint ✓

    install: go get github.com/acme/acme-go@aaa1111aaa1111aaa1111

! typescript branch=preview/feat-x commit=ccc3333 64 files (push failed)
    Your SDK build failed in the `lint` step.
    generate ✓ → bootstrap ✓ → build ✓ → lint ✗ (prev: lint ✓)

    lint failed:
      /src/index.ts:5:1  error  Unexpected `any`

Diagnostics: 1 fatal, 1 warning, 1 note
  fatal[Spec/Invalid] `#/components/schemas/Widget` does not resolve (java)
  warning[Endpoint/MissingResponse] Endpoint POST /v1/things has no 2xx response (go, python)
    --> paths./v1/things.post
  note[Type/Inline] Inline schema /paths/things (go, python, typescript)

Metadata:
  Build       : bd_75SH2lQr-zealous-pulp
  Timestamp   : 2026-05-17T19:30:00.000Z
  stlc        : abc1234
```

The `markdown` renderer emits HTML-flavored GitHub markdown (`<details>`, `<table>`, links, etc.) suitable for posting as a PR comment or piping into `$GITHUB_STEP_SUMMARY`. See `examples/config-repo/.github/workflows/stlc-generate.yml` for an end-to-end CI wiring.

---

### `stlc preview`

Start a local web server that renders a live SDK and API reference for the current workspace. `stlc preview` generates and merges an SDK JSON spec for every configured target, serves a prebuilt docs UI, and watches your OpenAPI spec and `stainless.yml` so the browser updates automatically as you edit them.

```sh
stlc preview [options]
```

When the server starts, `stlc` prints the URL (by default `http://localhost:9000`). Open it in a browser to see the preview. Press `Ctrl+C` to stop.

**Options:**

| Flag | Description |
| --- | --- |
| `--workspace <path>` | Path to a workspace directory or `workspace.json`. Defaults to the nearest `stainless/workspace.json` walking up from the current directory. |
| `--spec <path>` | Override the OpenAPI spec path recorded in `workspace.json`. |
| `--config <path>` | Override the `stainless.yml` path recorded in `workspace.json`. |
| `--output <dir>` | Override the SDK output directory recorded in `workspace.json`. |
| `-t, --targets <targets>` | SDK languages to preview (comma-separated, or `all`). Defaults to `all`. Terraform is always skipped because the preview UI does not render it. |
| `-p, --port <n>` | Port to listen on. Defaults to `9000`. |

**Behavior:**

- Requires a workspace; `stlc preview` reads `workspace.json` using the same discovery rules as [`stlc build`](#stlc-build).
- Watches the spec and config files. When either changes, `stlc` regenerates the merged SDK JSON spec and pushes an update to any open browser tab over Server-Sent Events, so the content refreshes without a manual reload. Rapid successive changes are coalesced into a single regeneration.
- Exits with `error: no preview-capable targets configured.` if the workspace has no non-Terraform targets.

**Examples:**

```sh
stlc preview
stlc preview --targets python,typescript
stlc preview --port 4000
```

---

### `stlc targets`

List the SDK targets `stlc` can generate and show, for each one, whether the target-specific generator package is installed locally, available from `github.com/stainless`, or unreachable from this machine.

`stlc targets` does not read `workspace.json` and is safe to run from any directory. It is the recommended first command when setting up a new machine or debugging why a target is missing from a build.

```sh
stlc targets [options]
```

**Options:**

| Flag | Description |
| --- | --- |
| `--format <format>` | Output format: `table` or `json`. Defaults to `table`. The global `-f json` flag has the same effect. |

**Statuses:**

| Status | Meaning | What to do |
| --- | --- | --- |
| `installed` | The `stlc-<target>` package resolves from the current directory or a global `node_modules` (npm or pnpm). | Nothing. `stlc build` will pick it up. |
| `available` | The package is not installed locally, but `git ls-remote https://github.com/stainless/stlc-<target>` succeeds, so you have access to install it. | Install the package with `npx skills add stainless-api/stlc --skill <target>` (or your package manager of choice) to enable generation. |
| `no-access` | The package is not installed locally and the repository on `github.com/stainless` is unreachable from this machine. | Authenticate with GitHub (`gh auth login && gh auth setup-git`) or add an SSH key with access to `github.com/stainless/*`. |

Rows are sorted by status (`installed` first, then `available`, then `no-access`) and alphabetically within each status. Targets marked hidden in the CLI (`node`, `openapi`, `terraform`) are omitted.

**Example output:**

```
$ stlc targets
TARGET      STATUS     PACKAGE
go          installed  stlc-go
cli         available  stlc-cli
csharp      available  stlc-csharp
java        available  stlc-java
kotlin      available  stlc-java
php         available  stlc-php
python      available  stlc-python
ruby        available  stlc-ruby
sql         available  stlc-sql
typescript  available  stlc-typescript
```

When every target shows `no-access`, `stlc targets` prints a hint pointing at `gh auth login && gh auth setup-git` or SSH key setup so you can recover without grepping the CLI source.

**JSON output:**

Use the global `-f json` flag (or the local `--format json` option) to emit a machine-readable array. Each entry has `target`, `displayName`, `packageName`, and `status` fields:

```json
[
  { "target": "go", "displayName": "Go", "packageName": "stlc-go", "status": "installed" },
  { "target": "cli", "displayName": "CLI", "packageName": "stlc-cli", "status": "available" }
]
```

**Exit codes:**

`stlc targets` always exits `0`. A `no-access` row is informational, not an error: use the exit code of `stlc build` to gate CI.

---

### `stlc version`

Print the stlc version and the short git SHA of the build.

```sh
stlc version
```

---

## Advanced

### `stlc generate`

> **Note:**
>
> For most workflows, use [`stlc build`](#stlc-build). Use `generate` only for ad-hoc, workspace-free SDK generation where you do not want a manifest written or a build history recorded, for example, inside tight scripts or experiments.

Generate SDKs from an explicit spec, config, and output directory. `stlc generate` does not read `workspace.json`, does not write a build manifest, and does not participate in the `stlc integrate` workflow.

```sh
stlc generate --spec <path> --config <path> --output <dir> [options]
```

**Options:**

| Flag | Description |
| --- | --- |
| `--spec <path>` | Path to your OpenAPI spec. Required. |
| `--config <path>` | Path to your `stainless.yml`. Required. |
| `--output <dir>` | Output directory for generated SDKs. Required. |
| `-t, --targets <targets>` | Comma-separated list of targets, or `all`. Defaults to `all`. |
| `--sdk-version <version>` | Override the SDK version for every target. Must be a valid semver string. |
| `-c, --concurrency <n>` | Number of targets to generate in parallel. Defaults to `min(cpuCount, 2)`. |
| `--no-format-sdk` | Skip each target's `./scripts/format` after generation. Format runs by default. |
| `--lint` | Run each target's `./scripts/lint` after generation. Defaults to `false`. |
| `--test` | Run each target's `./scripts/test` after generation. Defaults to `false`. |
| `--strict [steps]` | Abort the pipeline on failure of the listed soft-fail step(s). `build`, `lint`, and `test` default to continuing on failure; pass `--strict <step>` to halt subsequent steps when that step fails, or bare `--strict` to apply to all three. |
| `--dry-run` | Describe what would happen without writing files or running scripts. |
| `-w, --watch` | Re-run on spec or config changes. |

---

### `stlc autoconfig`

> **Note:**
>
> `stlc autoconfig` is intended for incrementally evolving an existing config. For day-to-day generation, run [`stlc build`](#stlc-build); reach for `autoconfig` when your OpenAPI spec has grown new endpoints or resources and you want to pick them up in `stainless.yml` without hand-editing.

Incrementally update a Stainless configuration file based on your OpenAPI spec. `stlc autoconfig` analyzes the spec for endpoints that are not yet mapped in `stainless.yml`, applies heuristic patches in place, and preserves the existing comments and formatting in the file. If no `stainless.yml` exists at the resolved path, `stlc autoconfig` creates one from scratch with `node` and `python` as default targets.

```sh
stlc autoconfig [options]
```

When new endpoints are detected, `stlc` prints a summary of the methods it added so you can review the diff before committing.

**Options:**

| Flag | Description |
| --- | --- |
| `--workspace <path>` | Path to a workspace directory or `workspace.json`. Defaults to the nearest workspace. |
| `--spec <path>` | Path to your OpenAPI spec. Required when running outside a workspace. |
| `--config <path>` | Path to the `stainless.yml` to update. Defaults to the workspace config, or `stainless.yml` next to the spec. |
| `-F, --force` | Run even if the config file has unstaged changes in the surrounding git repo. |

By default, `stlc autoconfig` refuses to overwrite a config file with uncommitted changes so the heuristic patch and your in-progress edits do not collide. Commit or stash your changes first, or pass `-F` to overwrite.

---

## Environment variables

| Variable | Description |
| --- | --- |
| `PAGER` | Used by `stlc diagnostics` when stdout is a TTY. Defaults to `less -R`. |
| `CI` | When set (to any value), `stlc build` runs in headless mode: progress is rendered as plain log lines instead of the interactive listr2 UI, regardless of whether stdout is a TTY. |
| `NO_COLOR` | When set (to any value), suppresses ANSI color in stlc output. |
| `STAINLESS_MANAGED` | Set to `1` or `true` when the SDK output directory is managed by Stainless infrastructure. Most users should leave this unset. |

---

## Skills

`stlc` ships with skills that help you configure your Stainless project interactively. Install a skill with:

```sh
npx skills add https://github.com/stainless/stlc --skill <skill-name>
```

Available skills:

| Skill | Description |
| --- | --- |
| `configuring-authentication` | Set up API keys, bearer tokens, OAuth, or custom auth schemes. |
| `configuring-client-settings` | Configure client constructor options, headers, timeouts, and retries. |
| `configuring-environments` | Set up base URLs, production/sandbox environments, and URL variables. |
| `configuring-methods` | Map API endpoints to SDK methods. |
| `configuring-models` | Organize schema references into named SDK types. |
| `configuring-pagination` | Configure pagination schemes for list endpoints. |
| `configuring-query-settings` | Customize query parameter serialization formats. |
| `configuring-readme` | Customize code examples in the generated SDK README. |
| `configuring-resources` | Organize API endpoints into logical resource groups. |
| `configuring-settings` | Configure general SDK settings like license and file headers. |
| `configuring-targets` | Set up language-specific SDK generation options. |
| `configuring-webhooks` | Set up webhook event parsing and signature verification. |
| `querying-with-jq` | Query patterns for exploring OpenAPI specs and diagnostics. |
| `stainless` | General Stainless SDK config creation and editing. |
| `transforming-openapi` | Write transforms to fix OpenAPI spec issues during generation. |
