---
title: "Custom code"
description: "Persist hand-written changes to your generated SDKs across codegen runs using stlc build."
slug: custom-code
source: https://app.stainless.com/knock/transition/docs/custom-code
---

# Custom code

_Persist hand-written changes to your generated SDKs across codegen runs using stlc build._

`stlc` supports custom code: hand-written changes to your generated SDKs that differ from what `stlc` generates from your OpenAPI spec and Stainless config, and that persist across successive codegen runs. This is the same concept as [custom code in the Stainless SaaS platform](https://stainless.com/docs/sdks/configure/custom-code), but managed locally using `stlc` and git.

`stlc build` drives the whole workflow. It generates the SDK, then seals any hand-written code that differs from the generated baseline into a tracking file, and integrates that code onto the fresh output on every future build.

The day-to-day loop is:

1. Edit `openapi.yml` or `stainless.yml` in the config repo, or edit custom code in the SDK repo.
2. Run `stlc build`.
3. If anything is off, run `stlc status`. It reports the current state and the next command to run.

You should rarely need to invoke `stlc integrate` directly: `stlc build` runs it at the end of every build, and `stlc build --continue` / `stlc build --abort` handle recovery after a conflict across every selected target.

## Before you begin

You need:

- A working `stlc` workspace with at least one target configured (see [Migration plan](./03-migration-plan.md)).
- A remote git repository for your SDK (for example, `https://github.com/my-org/my-api-python`), configured as `staging_repo` for that target in your [`stainless.yml`](https://stainless.com/docs/reference/config).

## Step 1: Build

Run `stlc build` to produce fresh SDK code. On the first run with no prior custom code, this initializes the SDK repo, commits the generated code, and reports that there is nothing to integrate.

```sh
stlc build
```

## Step 2: Make custom changes

Edit the generated SDK: add a helper, fix a docstring, extend a method. Leave the changes uncommitted in the SDK repo:

```sh
cd /path/to/my-api-python
# edit files...
```

## Step 3: Build again to seal custom code

Run `stlc build --commit "<message>"` to commit your changes in the SDK repo and seal them as custom code in a tracking file under `stainless/custom-code/{target}/`:

```sh
stlc build --commit "feat: add custom helper method"
```

`--commit` is the recommended way to commit SDK edits: it lets `stlc build` stage and commit your work as part of the same run that seals the tracking file, so the two stay in sync. If you would rather commit yourself before running `stlc build`, that also works. Either way, `stlc build` exits with an error if it finds uncommitted edits and you have not passed `--commit`, rather than silently folding your work into the generated baseline (where a future codegen would overwrite it).

Pass `--push` if you also want `stlc` to push the SDK branch to its remote in the same step. Otherwise the integrated commit stays local until you push it; `stlc status` will remind you. Re-running `stlc build --push` with no other changes will push pending commits.

After the build, `stlc` has written (or updated) a tracking file in your config repo at `stainless/custom-code/{target}/<timestamp>-custom-code.json`.

> **Note:**
>
> The tracking file must be committed and pushed in the config repo so collaborators and CI can see the same custom code. The commits referenced from the tracking file are pushed to the SDK remote by `stlc build`; the tracking file itself is not, and you must commit it yourself. Without that commit, the next build (on a fresh checkout, on CI, or on a teammate's machine) will not know the custom code exists.

Commit and push the tracking file from the config repo:

```sh
git add stainless/custom-code/
git commit -m "chore: seal custom helper method"
git push
```

## Step 4: Regenerate later

Later, when your OpenAPI spec or config changes, run `stlc build` again:

```sh
stlc build
```

`stlc` fetches the sealed custom code from the SDK remote, integrates it onto the newly generated output, commits the result, and updates the tracking file. Commit and push the updated tracking file from the config repo to finish the cycle.

## If something goes wrong

If `stlc build` fails or is interrupted, run `stlc status`. It reports the current state for each target and names the exact command to run next. The two recoverable states are:

- **Ongoing conflict.** The generated code changed in a way that conflicts with your custom code, and `stlc build` paused. Open the conflicting files, resolve the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`), `git add` the resolved files, and run `stlc build --continue`. If another conflict is encountered in a later step, `stlc` pauses again with a new message. To discard the in-progress integration and reset to the freshly generated code, run `stlc build --abort`.
- **Ongoing generation.** A prior `stlc build` crashed or was cancelled mid-generation. Re-running `stlc build` supersedes the partial output on success. To restore the last good generated state explicitly, run `stlc build --abort`.

`stlc build --continue` and `stlc build --abort` both operate across every selected target in one call. For an apply-phase conflict, you can also run `stlc integrate --continue <tree-ish>` to resolve a single target by pointing at a particular tree (for example, `HEAD` or a remote branch) instead of using whatever is currently staged.

## Tips

- Commit the `stainless/custom-code/` tracking files to your config repo alongside your OpenAPI spec and Stainless config, never to the SDK repo.
- Prefer config changes over custom code where possible; see the [Stainless config reference](https://stainless.com/docs/reference/config).
- Avoid moving existing generated code within or between files: this maximizes the chance of clean three-way merges.
- Use `stlc build --dry-run` to preview what would happen without making changes.
- Run `stlc status` to check the current state: whether generation is up to date, whether an integration is in progress, which conflict stage you are in, whether there is custom code that has not yet been sealed, or whether either repo has commits that need to be pushed.

## Next steps

- [Branching and collaboration](./18-custom-code-collaboration.md) — feature branches, teammates, and direct pushes to the SDK remote
- [CLI reference](./15-cli-reference.md) — complete flag reference for `stlc build` and `stlc integrate`
