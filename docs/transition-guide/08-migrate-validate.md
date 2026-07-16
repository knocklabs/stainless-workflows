---
title: "Validate parity"
description: "Confirm that your stlc-generated SDKs match what the Stainless app produced before you cut over."
slug: migrate-validate
source: https://app.stainless.com/knock/transition/docs/migrate-validate
---

# Validate parity

_Confirm that your stlc-generated SDKs match what the Stainless app produced before you cut over._

Before you flip the switch and turn the Stainless app read-only, verify that the SDKs `stlc` generates locally match what the Stainless app would have produced. This step catches any drift introduced by the migration before it reaches your users.

After `stlc init`, each SDK repo is already cloned at the commit produced by the Stainless app. When you run `stlc build`, stlc rewrites the generated files in each cloned SDK repo, applies your custom code, and commits the result to the repo's working branch (the same flow CI uses). The parity delta therefore lives in `HEAD` of each SDK repo, not in the working tree, which means `git status` alone is not enough to surface it. Use `git show HEAD` or `git diff HEAD~1 HEAD` instead.

## Run a build

From inside your config repo, generate every target with an explicit commit message so the first build is easy to spot in `git log`:

```sh
stlc build --commit "feat: initial stlc build"
```

This rewrites the generated files in each cloned SDK repo, integrates custom code on top, and commits the result. Subsequent `stlc build` invocations without `--commit` use stlc's default `Build SDK` commit message.

## Diff each SDK repo

To inspect the just-built commit across every target at once:

```sh
stlc exec -- git show --stat HEAD
stlc exec -- git log -p -1
```

`git show --stat HEAD` gives a per-target summary with the commit's `Stainless-Generated-From` trailer and a file-level changelog. `git log -p -1` adds the full patch.

To drill into a single target:

```sh
cd sdks/your-typescript
git show HEAD
git diff HEAD~1 HEAD
```

`git diff HEAD~1 HEAD` is the explicit "Stainless-app commit vs stlc build" diff when the workspace is fresh from `stlc init`.

## Compare against the published SDK

The HEAD~1 diff catches the immediate delta from a single `stlc build`. If you have run multiple builds, or if you want to validate against the SDK your users actually install, diff your local branch against the prod branch instead:

```sh
cd sdks/your-typescript
git fetch origin
git diff -u origin/main HEAD
```

## Read the diff

Expected, low-signal drift:

- Header comments and version stamps.
- Formatter or generator-version differences (whitespace, import ordering).
- File-level metadata that the new generator writes consistently across a target.

Unexpected diff that needs investigation before cutover:

- Changes to types, signatures, request/response shapes, or exported symbols.
- Differences in behavior-bearing code (retries, pagination, auth).
- Custom code that no longer applies cleanly.

If the diff is acceptable and tests pass in each SDK repo, you are ready to push the first build to staging and continue with the rest of the [migration plan](./03-migration-plan.md#end-to-end-sequence). If something is off, contact transition@stainless.com before continuing.
