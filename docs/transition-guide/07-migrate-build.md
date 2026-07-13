---
title: "Run your first build"
description: "Run stlc build, stlc test, and push the generated code to your SDK repos."
slug: migrate-build
source: https://app.stainless.com/knock/transition/docs/migrate-build
---

# Run your first build

_Run stlc build, stlc test, and push the generated code to your SDK repos._

After `stlc init`, your workspace has the spec, config, and cloned SDK repos. Now you generate SDK code, run the test suites, and push.

## Build SDKs

Run `stlc build` to produce SDK code from your spec and config. Pass `--commit` on this first build so the resulting SDK commits land with meaningful messages rather than `stlc`'s default:

```sh
stlc build --commit "feat: initial stlc build"
```

Sample output:

```
✱ Setup ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Project: acme
  SDKs: python, go, typescript
  Loading spec...
  Starting codegen workers...

✱ SDK Generation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

python: Prepare SDK repo (1.6s) ✓
go: Prepare SDK repo (1.2s) ✓
python: Generating (239 files, 2.8s) ✓
go: Generating (131 files, 7.0s) ✓
python: Running bootstrap (1.8s) ✓
python: Running format (1.1s) ✓
python: Running lint (3.3s) ✓
python: Apply custom-code patches — 1 tracking file (0.2s) ✓
python: done (12.7s)
go: Running lint (0.8s) ✓
go: Apply custom-code patches — 1 tracking file (0.2s) ✓
go: done (11.5s)
typescript: Generating (180 files, 5.4s) ✓
typescript: Running format (3.5s) ✓
typescript: Running build (6.2s) ✓
typescript: Running lint (9.8s) ✓
typescript: Apply custom-code patches — 1 tracking file (0.6s) ✓
typescript: done (29.7s)

✱ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  2 notes

✓ python: built
✓ go: built
✓ typescript: built

Build manifest saved to ./stainless/builds/bd_75SJ5g69-piney-map.json
Diagnostic results and target outcomes are recorded there.
Done in 41.4s

  Next steps:

    View this build:
      stlc show              # full report
      stlc diagnostics       # diagnostics only

    Check build status:
      stlc status

    Pass --format=json to either command for machine-readable output.
```

Generated SDK code lands inside each cloned repo under the workspace's output path. Every build also writes a manifest to `stainless/builds/` that you can inspect later with `stlc show` (full report) or `stlc diagnostics` (diagnostics only). Build IDs are slug-style identifiers like `bd_75SJ5g69-piney-map`.

## Test

After generating, run `stlc test` to run the SDK test suites:

```sh
stlc test
```

Sample output:

```
Running `./scripts/test` in 3 targets: go, python, typescript

✱ Go ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

==> Running tests
ok  	github.com/acme/acme-go	1.147s
ok  	github.com/acme/acme-go/internal/apiform	0.561s
ok  	github.com/acme/acme-go/internal/apijson	0.403s
ok  	github.com/acme/acme-go/packages/param	1.006s

✱ Python ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

==> Running tests with Pydantic v2
====================== 468 passed, 1482 skipped in 3.30s =======================

✱ TypeScript ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

==> Running tests
Test Suites: 22 skipped, 7 passed, 7 of 29 total
Tests:       227 skipped, 216 passed, 443 total
Snapshots:   3 passed, 3 total
Time:        2.893 s
```

## Push changes

Publishing involves two separate git operations, one per repo:

1. Push the generated code from every SDK repo to `origin`. Re-run the build with `--push` to push the commits from above:

   ```sh
   stlc build --push
   ```

   The second build is a no-op for the working tree (generation is deterministic, so there is nothing new to commit), and `--push` just publishes the existing commit. If you skipped the `--commit` flag in the previous step and want to amend the commit message now, do it with `git commit --amend` in each SDK repo before pushing — `stlc build --commit` does not rewrite an existing commit.

2. If your workspace has any tracking files under `stainless/custom-code/`, commit and push them from the config repo. Without this step, CI and teammates cannot see the tracking files, and the next `stlc build` on another machine will not know which custom-code commits to integrate.

   ```sh
   git add stainless/custom-code/ && git commit -m "chore: seal custom code" && git push
   ```

From this point on, the daily loop is: edit `openapi.yml` or `stainless.yml` (or your custom code), run `stlc build`, and run `stlc status` if anything looks off.
