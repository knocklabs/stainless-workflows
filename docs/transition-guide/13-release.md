---
title: "Release SDKs to package managers"
description: "Set up automated versioning, changelogs, and package publishing for SDKs generated with stlc."
slug: release
source: https://app.stainless.com/knock/transition/docs/release
---

# Release SDKs to package managers

_Set up automated versioning, changelogs, and package publishing for SDKs generated with stlc._

When you generate SDKs with `stlc`, you manage the release pipeline yourself using [release-please](https://github.com/googleapis/release-please), an open-source tool from Google that automates versioning and changelogs based on [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

Stainless generates the release-please configuration and GitHub Actions workflows for you.

## How the release pipeline works

1. **Push to main** — you (or your CI) push SDK changes with [conventional commit](https://www.conventionalcommits.org/en/v1.0.0/) messages
2. **Release PR** — release-please creates or updates a pull request that bumps version numbers and updates the changelog
3. **Merge** — you review and merge the release PR when ready
4. **Tag and release** — release-please detects the merged PR, creates a git tag and [GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
5. **Publish** — the publish workflow runs automatically to push the package to its registry (npm, PyPI, etc.)

> **Squash merges are fully supported.** Squash is release-please's recommended merge strategy, and the `Release-As:` version override requires it. release-please tracks the released version in `.release-please-manifest.json` on `main`, independent of how PRs are merged — so squash, rebase, and merge commits all work.
>
> Occasionally a *release* PR merges but no tag/release appears, and the next run opens a duplicate release PR (its only change a self-referential changelog entry). This is a known release-please labeling race — the `autorelease: pending` label not clearing, usually behind a token-permission or API hiccup — **not** a reason to change your merge strategy. Recover by re-running the release workflow (or, with the GitHub App, adding the `release-please:force-run` label to the merged PR), and confirm the release token has `contents: write` and `pull-requests: write`.

## Prerequisites

Before your first release, you need:

1. A production repository for each SDK language (configured via `production_repo` in your Stainless config)
2. A `RELEASE_PLEASE_TOKEN` secret in each production repo (see [Authentication](#authentication))
3. Package registry credentials for each language you publish (see [language-specific setup](#language-specific-setup))

## Configuration

Add a `publish.release` section to each target in your Stainless config:

```yaml
targets:
  python:
    package_name: my_company
    production_repo: my-org/my-company-python
    publish:
      pypi: true
      release:
        branch: main
        prerelease: true
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `branch` | `string` | `main` | Branch that release-please targets for release PRs and changelog generation. |
| `prerelease` | `boolean` | `true` | Whether to mark GitHub Releases as pre-releases. When `true`, versions use a prerelease suffix (e.g. `0.1.0-alpha.1`). |

When `publish.release` is set, `stlc build` produces three files:

| File | Purpose |
|------|---------|
| `.github/workflows/release-please.yml` | Runs release-please on push to create/update release PRs and GitHub Releases |
| `release-please-config.json` | Release-please configuration (versioning strategy, changelog sections) |
| `.release-please-manifest.json` | Tracks the current version |

The publish workflow (e.g. `.github/workflows/publish-pypi.yml`) is generated separately based on your `publish` config and is triggered when a GitHub Release is created.

## Authentication

The generated workflow uses a GitHub [fine-grained personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token) (PAT) stored as `RELEASE_PLEASE_TOKEN`.

### Why a PAT

The built-in `GITHUB_TOKEN` has a platform limitation: events it creates [do not trigger other GitHub Actions workflows](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow). A PAT avoids this, ensuring that:

- The GitHub Release created by release-please triggers the publish workflow
- CI workflows run on release PRs

### Creating the token

1. Go to [GitHub Settings > Developer settings > Fine-grained tokens](https://github.com/settings/personal-access-tokens)
2. Create a token scoped to your production repository
3. Grant these repository permissions:
   - **Contents**: Read and write (commits, tags, releases)
   - **Pull requests**: Read and write (release PRs)
4. Store the token as a repository secret named `RELEASE_PLEASE_TOKEN`

> **Note:**
>
> Any collaborator with **write** access to the repository can add secrets — admin access is not required.

## Generated workflows

### `release-please.yml`

```yaml
name: Release Please
on:
  push:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    if: github.repository == 'my-org/my-company-python'
    runs-on: ubuntu-latest

    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          token: ${{ secrets.RELEASE_PLEASE_TOKEN }}
```

### Publish workflow

The publish workflow is generated per language (e.g. `publish-pypi.yml`, `publish-npm.yml`). It triggers when a GitHub Release is created, and can also be run manually for re-publishing:

```yaml
name: Publish PyPI
on:
  workflow_dispatch:
  release:
    types: [published]

jobs:
  publish:
    name: publish
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      # ... language-specific setup and publish steps
```

> **Note:**
>
> For PyPI trusted publishing (OIDC), the workflow name configured in PyPI must match the filename — `publish-pypi.yml`. See the [Python publishing guide](https://stainless.com/docs/sdks/python#publishing-to-pypi) for setup details.

## Versioning

Release-please uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) to determine version bumps:

| Commit prefix | Version bump | Example |
|---------------|-------------|---------|
| `fix:` | Patch | `0.1.0` → `0.1.1` |
| `feat:` | Minor | `0.1.0` → `0.2.0` |
| `feat!:` or `BREAKING CHANGE:` footer | Major | `1.0.0` → `2.0.0` |

Before `1.0.0`, breaking changes bump the minor version instead of major.

Non-conventional commits (like `codegen metadata`) are ignored and will not appear in the changelog or trigger a version bump.

### Prerelease versions

When `prerelease: true` is set:
- `0.1.0-alpha.1` → `0.1.0-alpha.2` (patch)
- `0.1.0-alpha.2` → `0.2.0-alpha.1` (minor)

### Moving to stable

To transition from prerelease to stable:

1. Update your Stainless config:
   ```yaml
   publish:
     release:
       prerelease: false
   ```
2. Regenerate and push — this updates `release-please-config.json`
3. Optionally use a `Release-As: 1.0.0` commit footer to set the exact first stable version

### Overriding the version

Add a `Release-As:` footer to any commit to set the next version explicitly:

```
feat: add new endpoint

Release-As: 2.0.0
```

> **Note:**
>
> `Release-As` controls the version number only. The prerelease flag on the GitHub Release is controlled by `prerelease` in your Stainless config, not the version string. To make a stable release, you must set `prerelease: false` in the config.

## Language-specific setup

Each language has its own registry and authentication requirements. The registry setup (API tokens, OIDC) is the same whether you use Stainless SaaS or `stlc`:

- [TypeScript (npm)](https://stainless.com/docs/sdks/typescript#publishing-to-npm)
- [Python (PyPI)](https://stainless.com/docs/sdks/python#publishing-to-pypi)
- [Go](https://stainless.com/docs/sdks/go#publishing)
- [Java (Maven Central)](https://stainless.com/docs/sdks/java#publishing-to-maven-central)
- [Kotlin (Maven Central)](https://stainless.com/docs/sdks/kotlin#publishing-to-maven-central)
- [Ruby (RubyGems)](https://stainless.com/docs/sdks/ruby#publishing-to-rubygems)
- [PHP (Packagist)](https://stainless.com/docs/sdks/php#publishing-to-packagist)
- [C# (NuGet)](https://stainless.com/docs/sdks/csharp#publishing-to-nuget)

## Differences from Stainless SaaS

| | Stainless SaaS | stlc |
|---|---|---|
| Release tool | Stainless fork of release-please | Stock [googleapis/release-please](https://github.com/googleapis/release-please) |
| Branch model | `next` → `main` via release PR | Direct to `main` |
| Release trigger | Stainless GitHub App webhooks | GitHub Actions (`on: push`) |
| Authentication | Stainless GitHub App (OIDC) or `STAINLESS_API_KEY` | `RELEASE_PLEASE_TOKEN` (GitHub PAT) |
| Version override | Edit PR title in dashboard | `Release-As:` commit footer |

## Troubleshooting

### Release-please does not create a PR

Release-please only creates a PR when it finds conventional commits since the last tagged release. Commits with non-conventional messages (e.g. `codegen metadata`) are ignored.

Fix: push a commit with a conventional prefix (`feat:`, `fix:`, `chore:`, etc.).

### Publish workflow does not trigger after merging a release PR

The publish workflow triggers on `release: types: [published]`. This requires a PAT — `GITHUB_TOKEN`-created releases do not trigger other workflows.

Fix: ensure `RELEASE_PLEASE_TOKEN` is set and contains a valid PAT. See [Authentication](#authentication).

## See also

- [Publish your SDKs](https://stainless.com/docs/sdks/publish) — overview of the Stainless SaaS release flow
- [stlc CLI reference](./15-cli-reference.md) — complete command reference
