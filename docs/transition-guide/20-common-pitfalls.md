---
title: "Common pitfalls"
description: "Common pitfalls when running stlc, and how to avoid them."
slug: common-pitfalls
source: https://app.stainless.com/knock/transition/docs/common-pitfalls
---

# Common pitfalls

_Common pitfalls when running stlc, and how to avoid them._

A short list of the things that most often trip people up. Most trace back to one idea: the custom-code tracking files in your **config repo** must stay in sync with what's actually on your SDK repos.

## Commit your tracking files

The tracking files under `stainless/custom-code/<target>/` live in the **config repo**, not the SDK repo. If you don't commit them, the next `stlc build` on a fresh checkout (for example in CI) can't see your sealed custom code and regenerates without it. Commit them alongside the spec/config change that produced them.

## Keep the tracking files current

A *stale* tracking file — the config repo lagging behind the SDK repos — is what lets a later build reapply an out-of-date `integrated` SHA and miss custom code. Two safeguards work together: the example workflows open a seal-back PR and auto-merge it, so merge it (or keep auto-merge on) promptly; and `stlc build` now **refuses** a build when it detects custom code on the branch that the current tracking files wouldn't preserve, rather than silently overwriting it. If a build stops for this reason, bring the tracking files current (merge the `stlc/seal-tracking` PR) and rebuild.

## Edit custom code in staging, not by hand on production

Author custom code in your SDK output and let `stlc build` seal it, or — for a contribution merged on the public production repo — let the back-sync bring it to staging where the next build seals it. A hand edit committed directly to production that is never sealed will be overwritten the next time you regenerate and promote. See [Accepting community contributions on production](./12-promote.md#accepting-community-contributions-on-production).

## Don't squash or rebase a cross-repo PR

The promote (staging→production) and back-sync (production→staging) are the only place commits cross between repos. Move them with a fast-forward push (recommended) or, if a repo requires a pull request for changes to `main`, a **merge-commit PR**. **Squash and rebase rewrite the commit SHAs**, which forks the two trunks apart and forces the slower content-based sync; squash also stops release-please from computing the version. PRs *within* a repo — custom-code, community, and the release-please version PR — can use any merge method. See [Choosing how to promote](./12-promote.md#choosing-how-to-promote).

## Don't force-push the trunks

The promote/back-sync model relies on linear, append-only history on `staging#main` and `production#main`. Protect both branches against force-pushes and history rewrites: block branch deletion and block non-fast-forward pushes. Don't require linear history, though — where a repo takes the cross-repo update as a merge-commit PR, GitHub's "require linear history" setting would reject it. A force-push can orphan the sealed custom-code commit and break the next build.

## If the trunks fork, promote and back-sync refuse

Both workflows verify the move is a true fast-forward (`git merge-base --is-ancestor`) before pushing, and **refuse loudly — "not an ancestor" — rather than force** when `staging#main` and `production#main` have diverged. Under the fast-forward model that shouldn't happen, but a force-push, a squashed or rebased cross-repo PR, or a stray manual commit on the wrong trunk can cause it.

To recover, bring the two trunks back onto one line, then resume:

1. See what each trunk has that the other doesn't: `git log --oneline production/main...origin/main`.
2. Bring the divergent commits onto whichever trunk should lead (usually staging) — cherry-pick or merge them so one trunk is again a fast-forward of the other. Don't force-push to paper over it; that just moves the fork.
3. Re-run the promote (or back-sync). With the trunks back in lock-step the ancestor check passes and the push goes through.

If real custom code diverged along the way, see [Recover a broken workspace](./recovery.md).

## Match your local toolchain to CI

If your local formatter or linter version differs from CI's, the difference shows up as a diff that gets sealed as spurious "custom code" and causes conflicts later. Pin your local toolchain to match CI — see [Set up a local environment](./14-local-environment.md).

## Don't pin `--sdk-version` in steady-state builds

`stlc` reads each SDK's version from the repo so it can self-heal after a release (once the back-sync carries the version bump to staging). Passing `--sdk-version` overrides that and pins the version, which blocks the self-heal. Use it only for one-off builds.

## See also

- [Architecture](./02-architecture.md) — how the repos fit together
- [Promote SDKs](./12-promote.md) — promote and back-sync
- [Custom code with stlc](./17-custom-code.md)
