---
title: "Install stlc"
description: "Get access to the stlc tool and install it on your machine."
slug: migrate-install
source: https://app.stainless.com/knock/transition/docs/migrate-install
---

# Install stlc

_Get access to the stlc tool and install it on your machine._

## Prerequisites

- GitHub access to the private `stlc` repos. Open [github.com/stainless/stlc](https://github.com/stainless/stlc) in your browser. If it returns 404, your invite hasn't been accepted yet and the `npm install` commands below will fail to clone the repos. See [Activate stlc access](./04-migrate-activate.md).
- Node.js 24 or later installed.
- The `unzip` binary available on your `PATH` (standard on macOS and most Linux distributions).
- Git configured to authenticate to GitHub. The `stlc` and `stlc-$target` repos are private, so npm needs git credentials to clone them. See [Authenticate git to GitHub](#authenticate-git-to-github) below.

## Authenticate git to GitHub

The `npm install` commands in the next section clone private GitHub repos under `stainless/`. Set up one of the following before running them.

### Option 1: `gh` CLI (recommended)

If you have the [GitHub CLI](https://cli.github.com/) installed, it can mint a token and wire it into git for you:

```sh
gh auth login
gh auth setup-git    # reuses gh's token for https://github.com/*
```

This configures git to use HTTPS auth against `github.com`, which is what the `git+https://` URLs in the next section rely on.

### Option 2: SSH keys

If your GitHub account already has an SSH key configured (`ssh -T git@github.com` returns a success message), you can install via SSH instead. Use the `github:stainless/<repo>` shorthand or an explicit `git+ssh://git@github.com/stainless/<repo>.git` URL in place of the `git+https://` URLs shown below.

### Why explicit `git+https://` URLs?

npm's `github:owner/repo` shorthand resolves to `git+ssh://`, so it fails for users who only have HTTPS auth set up (the common case after `gh auth setup-git`). The install commands below use explicit `git+https://github.com/...` URLs so they work for HTTPS auth out of the box. If you're on SSH, swap in the `github:` shorthand or a `git+ssh://` URL.

## Install

Install `stlc` and an `stlc-$target` package for each language you generate. The core `stlc` CLI resolves these sibling packages at runtime; without them, no targets are usable.

```widget:sdk-access

All available packages:

Core stlc: `git+https://github.com/stainless/stlc.git`

| Target | Package |
| --- | --- |
| C# | `git+https://github.com/stainless/stlc-csharp.git` |
| CLI | `git+https://github.com/stainless/stlc-cli.git` |
| Go | `git+https://github.com/stainless/stlc-go.git` |
| Java | `git+https://github.com/stainless/stlc-java.git` |
| Kotlin | `git+https://github.com/stainless/stlc-java.git` (Kotlin ships inside `stlc-java`) |
| PHP | `git+https://github.com/stainless/stlc-php.git` |
| Python | `git+https://github.com/stainless/stlc-python.git` |
| Ruby | `git+https://github.com/stainless/stlc-ruby.git` |
| SQL | `git+https://github.com/stainless/stlc-sql.git` |
| TypeScript | `git+https://github.com/stainless/stlc-typescript.git` |
| MCP | `git+https://github.com/stainless/stlc-mcp.git` |

We suggest installing these packages globally for easier use:

npm install -g git+https://github.com/stainless/stlc.git \
  git+https://github.com/stainless/stlc-csharp.git \
  git+https://github.com/stainless/stlc-cli.git \
  git+https://github.com/stainless/stlc-go.git \
  git+https://github.com/stainless/stlc-java.git \
  git+https://github.com/stainless/stlc-php.git \
  git+https://github.com/stainless/stlc-python.git \
  git+https://github.com/stainless/stlc-ruby.git \
  git+https://github.com/stainless/stlc-sql.git \
  git+https://github.com/stainless/stlc-typescript.git \
  git+https://github.com/stainless/stlc-mcp.git

Trim the list to the targets your org actually generates. Kotlin ships inside `stlc-java`, so no separate entry is needed.

If you are actively using an SDK that you do not have access to, please reach out to [transition@stainless.com](mailto:transition@stainless.com) with details and we will gladly grant you access.
```

## Verify the installation

```sh
stlc version
```

You can also get interactive help for any command at the command line:

```sh
stlc --help
```

Usage documentation for `stlc` lives in this guide and in the repository's `README.md`.
