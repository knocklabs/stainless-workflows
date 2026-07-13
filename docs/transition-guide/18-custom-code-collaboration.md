---
title: "Custom code branching and collaboration"
description: "How custom code travels across config repo branches, teammates, and concurrent builds."
slug: custom-code-collaboration
source: https://app.stainless.com/knock/transition/docs/custom-code-collaboration
---

# Custom code branching and collaboration

_How custom code travels across config repo branches, teammates, and concurrent builds._

## The two-repo model

Custom code state is split across two git repositories:

- The **config repo** holds your `stainless/` workspace: spec, config, and the tracking files under `stainless/custom-code/`. Each tracking file is a small JSON file that records the `base` and `integrated` commit SHAs bounding one patch of custom code. Tracking files are the source of truth for what custom code exists.
- The **SDK repo** holds the actual generated and customized code. `stlc build` pushes the corresponding commits there under `refs/stainless/custom-code/` and fetches them back on every build.

Because tracking files live in the config repo and the commits they reference live in the SDK repo, both must travel together. Pushing one without the other leaves collaborators (or CI) with a partial picture.

## Branching

### Branch name

By default, `stlc build` uses the current git branch of the directory where you run `stlc` (typically the config repo). The SDK repo branch mirrors the config repo branch. You can override this with `--branch`:

```sh
stlc build --branch my-other-branch
```

### Collaborate through the config repo

The SDK repo branch that `stlc build` produces is a local working artifact: it is rebuilt from scratch on every build. Do not treat it as a durable collaboration surface. Instead, collaborate through the config repo:

- Commit and push tracking files (written by `stlc build`) alongside your spec and config changes.
- Use config repo branches and pull requests to review spec changes.
- When a teammate pulls your config repo branch and runs `stlc build`, they get the same SDK result you did.

### Working on feature branches

When you change your OpenAPI spec on a feature branch, the workflow is the same as on `main`: build, edit, build again. Tracking files follow normal git rules: they exist on whatever config repo branch you committed them to.

A typical feature branch workflow:

1. Create a feature branch in the config repo.
2. Modify your OpenAPI spec and Stainless config.
3. Run `stlc build`. Existing custom code (sealed on `main` or an ancestor commit) is applied automatically.
4. If your feature requires new custom code, add it in the SDK repo, commit, and run `stlc build` again (or `stlc build --commit "<msg>"` if you have uncommitted edits).
5. Commit the updated tracking file in the config repo and push your branch. The tracking file for your new custom code travels with the branch.

When the feature branch merges to `main`, the tracking file merges too. The next `stlc build` on `main` sees all tracking files and processes them together.

### When to seal on a feature branch vs. main

If your custom code change is tied to a spec change (for example, a helper that depends on a new endpoint), seal it on the feature branch so the tracking file merges with the spec change.

If the custom code change is independent of any spec change, seal it directly on `main` so it is immediately available to everyone.

## Concurrent work and remote pushes

### Concurrent work on the same target

If two people run `stlc build` concurrently on different branches, each may write a tracking file that consolidates the same prior state. If multiple tracking files end up coexisting in `stainless/custom-code/{target}/`, `stlc build` handles this correctly: it processes all of them. The next successful build consolidates them back into one. If their patches conflict, the standard conflict resolution flow applies (see [If something goes wrong](./17-custom-code.md#if-something-goes-wrong)).

#### Example: concurrent work on separate branches

Alice is adding a new endpoint on `feature/users`. Bob is fixing a docstring on `main`.

1. **Bob** fixes the docstring in the SDK repo on `main`, runs `stlc build`, and commits and pushes the updated tracking file in the config repo.
2. **Alice** creates her feature branch from `main` (which includes Bob's tracking file). She modifies the spec and runs `stlc build`. Bob's fix is applied to her SDK automatically.
3. **Alice** adds a custom helper for the new endpoint, runs `stlc build --commit "feat: add helper"` so her edits are sealed, and pushes the config repo branch.
4. **Alice** merges her feature branch to `main`. The config repo now has two tracking files in `stainless/custom-code/python/`: Bob's and Alice's.
5. The next `stlc build` on `main` processes both tracking files, combining the patches, and consolidates them into one.

If Alice had not rebased on Bob's latest `main` before merging, she might not have Bob's tracking file on her branch. In that case, both tracking files appear on `main` after the merge, and `stlc build` still handles them correctly.

### Remote branch work is preserved

After applying sealed patches, `stlc build` checks whether the SDK remote branch has commits beyond the last sealed state. If it does, `stlc` cherry-picks that additional work on top of the integrated result. This preserves changes that were pushed directly to the SDK remote — for example, manual fixes applied through a pull request — without requiring any additional step.

This requires a tracking file that was sealed for the current branch. If `origin/<branch>` does not exist on the remote, `stlc` falls back to `origin/main` for the cherry-pick source, but it still needs a tracking file whose `branch` field matches the build branch. If no matching tracking file exists, `stlc` errors rather than silently skipping the remote work.

If the remote branch work conflicts with the newly generated code or the sealed patches, `stlc build` pauses for conflict resolution just like any other build conflict. Run `stlc status` to see the next command.

### Remote URL consistency

`stlc build` sets the SDK repo's `origin` to the `staging_repo` in your `stainless.yml` only when no origin is configured yet, leaving any pre-existing origin alone. Collaborators who let `stlc init` configure their clone end up with the same remote as long as their `stainless.yml` agrees.
