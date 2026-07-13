---
title: "Set up a local environment"
description: "Install the language toolchains stlc build needs to generate, format, and test SDKs locally."
slug: local-environment
source: https://app.stainless.com/knock/transition/docs/local-environment
---

# Set up a local environment

_Install the language toolchains stlc build needs to generate, format, and test SDKs locally._

`stlc build` runs each target's native toolchain to generate, format, and test SDKs. Node.js and `unzip` are enough to install the CLI and run `stlc init`; the toolchains below are only needed on machines that actually run `stlc build`. Pick whichever setup matches the rest of your engineering stack.

> **Note:**
>
> If you only ever run `stlc build` in CI (the recommended flow), your developer machines do not need any of this. See [Run your first build](./07-migrate-build.md) and [Generate SDKs workflow](./11-codegen.md) for the CI-driven setup.

## What `stlc build` needs

Each target invokes its native compiler, formatter, and test runner during a build. You only need the toolchains for the targets you generate.

| Target | Toolchain | Notes |
| --- | --- | --- |
| TypeScript | Node.js 24, plus `pnpm` for SDK scripts | `pnpm` is available via `corepack enable` once Node is installed |
| Python | Python 3.13 or later, plus `uv` or `rye` | `rye` is the default; `uv` is supported as an alternative: `targets.python.options.use_uv: true` in `stainless.yml` |
| Go | Go 1.24 or later | |
| Ruby | Ruby 3.2 or later, `rubocop` |  |
| Java | JDK 21 | Used to build, format, and test the Java SDK |
| Kotlin | JDK 21, `ktfmt` | Kotlin ships inside `stlc-java`; uses the same JDK |
| PHP | PHP 8.3, Composer | |
| C# / .NET | .NET 8.0 SDK, Mono | Mono is required by some xUnit scenarios |
| SQL | Node.js 24 | The SQL target is generated from TypeScript |
| CLI | Go 1.23 or later | The CLI target wraps the Go SDK |
| Terraform | Go 1.23 or later, `terraform` | `terraform` only needed if you run the SDK tests |

> **Note:**
>
> Every option below also needs `git`, `make`, `unzip`, and a working C toolchain (`cc`, `pkg-config`). macOS gets these from the Xcode Command Line Tools (`xcode-select --install`); Debian/Ubuntu from `build-essential`.

> **Note: match your CI toolchain.** Formatters are toolchain-sensitive — a different build of the same tool can emit different bytes that `stlc build` then seals as custom code, surfacing as a spurious conflict on the next CI build. Use the same toolchains (distribution and version) your CI uses.

## Setup options

The four options below all install the same fleet of language toolchains; pick whichever matches the rest of your stack.

| Option | Platform | Reproducibility | Host footprint | Best for |
| --- | --- | --- | --- | --- |
| [Homebrew](#option-1-homebrew-macos) | macOS | Floats with upstream | Installs into `/opt/homebrew` | Mac devs whose org already uses Homebrew |
| [mise + Brewfile + npm](#option-2-mise--brewfile--npm) | macOS | Pinned by `mise.toml` and lockfile | Per-project tools, plus a small Brewfile | Mac devs who want per-project version pinning |
| [Nix flake](#option-3-nix-flake) | macOS, Linux | Bit-for-bit via `flake.lock` | Installs into `/nix/store`; shells are isolated | Cross-platform teams that want max reproducibility |
| [Docker](#option-4-docker) | macOS, Linux, Windows | Image digest pins the world | Nothing on the host except the image | Teams that want zero host pollution or to mirror CI exactly |

Each option below covers only the system toolchains. Once those are in place, follow [Install stlc](./05-migrate-install.md) to add the CLI and per-target plugins. Option 4 (Docker) is the exception: the Dockerfile bakes the `stlc` install into the image because the container has no follow-up shell session in which to run a separate step.

### Option 1: Homebrew (macOS)

Drop this `Brewfile` at the root of your config repo:

```ruby
# Node.js / TypeScript / SQL
brew "node@24"
brew "yarn"

# Python (rye is the default; uv is only used with `use_uv: true`)
brew "rye"
brew "uv"

# Go / CLI / Terraform
brew "go"
brew "terraform"

# Ruby
brew "ruby"
brew "rbenv"
brew "bison"

# PHP
brew "php@8.3"
brew "composer"

# Java / Kotlin
cask "temurin@21"
brew "ktfmt"

# C# / .NET
brew "dotnet@8"
brew "mono"
```

Install everything:

```sh
brew bundle
corepack enable
```

> **Note: a few tools need `PATH`/env entries.** After `brew bundle`, add these to your shell profile (`~/.zshrc` or `~/.bashrc`) so `stlc build` finds them:
>
> ```sh
> export JAVA_HOME="$(/usr/libexec/java_home -v 21)"    # JDK 21
> export PATH="$(brew --prefix)/opt/php@8.3/bin:$PATH"  # php@8.3 is keg-only
> export PNPM_HOME="$HOME/Library/pnpm"; export PATH="$PNPM_HOME:$PATH"
> ```
>
> If `dotnet` isn't found after `brew bundle`, link it: `brew link --force dotnet@8`.

Then follow [Install stlc](./05-migrate-install.md) to add the CLI and the `stlc-$target` plugins for the targets you generate.

Install Homebrew from [brew.sh](https://brew.sh). The Brewfile syntax is documented in [Homebrew Bundle](https://github.com/Homebrew/homebrew-bundle).

### Option 2: mise + Brewfile + npm

This pattern uses [`mise`](https://mise.jdx.dev/getting-started.html) to pin language runtimes, a small `Brewfile` to fill the gap where mise's PHP plugin breaks, and `package.json` to install the `stlc-*` plugins from GitHub. `mise` auto-runs `brew bundle` and `npm install` whenever the source files change, so a single `mise install` (or just `cd` into the directory) provisions everything.

`mise.toml`:

```toml
min_version = "2026.4.18"

[settings]
experimental = true
lockfile = true

[tools]
node    = "24"
python  = "3.13"
go      = "1.24"
ruby    = "3.2"
java    = "temurin-21"
dotnet  = "8"
# PHP, rye, and uv are installed via Homebrew (see Brewfile below).

[env]
_.path = ["./node_modules/.bin"]

[deps.brew]
auto = true
sources = ["Brewfile"]
outputs = ["Brewfile"]
run = "brew bundle check --no-upgrade >/dev/null 2>&1 || brew bundle"

[deps.node]
auto = true
sources = ["package.json", "package-lock.json"]
outputs = ["node_modules/.package-lock.json"]
run = "npm install --no-audit --no-fund"
```

`Brewfile`:

```ruby
brew "php@8.3"
brew "composer"

# rye is the default Python package manager; uv is used with use_uv: true.
brew "rye"
brew "uv"
```

> **Note:**
>
> PHP is handled by Homebrew rather than `mise` because mise's `vfox-php` plugin looks up the removed `openssl@1.1` formula and silently builds a PHP without HTTPS, which then breaks Composer's connection to Packagist.

`package.json`. The `[deps.node]` block above tells `mise` to run `npm install` whenever this file changes, so listing `stlc` and target plugins here is how they get installed under mise. Add one entry per target you generate; see [Install stlc](./05-migrate-install.md) for the full package list and an explanation of `git+https://` vs `github:`/SSH:

```json
{
  "name": "stainless-sdks",
  "private": true,
  "description": "stlc CLI and per-target plugins.",
  "dependencies": {
    "stlc": "git+https://github.com/stainless/stlc.git",
    "stlc-typescript": "git+https://github.com/stainless/stlc-typescript.git"
  }
}
```

After the files are in place:

```sh
mise install
stlc version
```

Install `mise` from [mise.jdx.dev/getting-started](https://mise.jdx.dev/getting-started.html); Homebrew from [brew.sh](https://brew.sh).

### Option 3: Nix flake

Nix is the most reproducible option: every contributor gets bit-for-bit identical toolchain versions, pinned by `flake.lock`. Drop a `flake.nix` at the root of your config repo:

```nix
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs?ref=nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      forEachSystem = f: nixpkgs.lib.genAttrs [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ] (system: f (import nixpkgs {
        inherit system;
        config.allowUnfreePredicate = pkg:
          builtins.elem (nixpkgs.lib.getName pkg) [ "terraform" ];
      }));
    in
    {
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Cross-cutting build deps
            stdenv.cc
            gnumake
            pkg-config

            # TypeScript / SQL
            nodejs_24
            (pnpm.override { nodejs = nodejs_24; })
            yarn
            bun

            # Python
            python313
            uv
            rye

            # Go / CLI / Terraform
            go
            gotools
            golangci-lint
            terraform

            # Ruby
            ruby
            rubocop
            rubyPackages.yard

            # Java / Kotlin
            jdk21
            ktfmt

            # PHP
            php83
            php83Packages.composer

            # C# / .NET
            dotnetCorePackages.sdk_8_0
            mono
          ];

          shellHook = ''
            export DOTNET_ROOT=${pkgs.dotnetCorePackages.sdk_8_0}/share/dotnet
          '';
        };
      });
    };
}
```

Enter the shell:

```sh
nix develop
```

Then follow [Install stlc](./05-migrate-install.md) inside the shell to add the CLI and target plugins.

If you use [direnv](https://direnv.net/), add a `.envrc` containing `use flake` so the shell loads automatically when you `cd` into the repo.

Install Nix from [nixos.org/download](https://nixos.org/download/) or the [Determinate Systems installer](https://determinate.systems/nix-installer/), which is the easiest path on macOS.

### Option 4: Docker

A container is useful for matching whatever your CI runs and for keeping all of these toolchains off your laptop. The example below starts from `node:24-trixie-slim` and adds language toolchains via `apt-get`, the official .NET install script, and `npm`.

The `stainless/stlc-*` repos are private, so the build needs a GitHub PAT. We pass it in via a BuildKit secret mount so the token never lands in an image layer.

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24-trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      unzip \
      pkg-config \
      python3 python3-pip python3-venv \
      golang \
      ruby ruby-dev \
      openjdk-21-jdk-headless \
      php-cli php-mbstring php-xml composer \
      mono-devel \
    && rm -rf /var/lib/apt/lists/*

# .NET 8 SDK (not in Debian apt repos; use Microsoft's install script)
ENV DOTNET_ROOT=/usr/local/dotnet
ENV PATH=$PATH:/usr/local/dotnet
RUN curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh \
    && chmod +x /tmp/dotnet-install.sh \
    && /tmp/dotnet-install.sh --channel 8.0 --install-dir /usr/local/dotnet \
    && rm /tmp/dotnet-install.sh

# Optional faster Python package manager
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# stlc CLI and per-target plugins. Mount the PAT as a BuildKit secret and use
# it to rewrite GitHub URLs for the duration of this RUN. Both the secret and
# the in-RUN ~/.gitconfig are gone before the layer is committed.
RUN --mount=type=secret,id=gh-token,required=true \
    TOKEN=$(cat /run/secrets/gh-token) \
    && git config --global url."https://x-access-token:${TOKEN}@github.com/".insteadOf "https://github.com/" \
    && npm install -g \
      git+https://github.com/stainless/stlc.git \
      git+https://github.com/stainless/stlc-cli.git \
      git+https://github.com/stainless/stlc-csharp.git \
      git+https://github.com/stainless/stlc-go.git \
      git+https://github.com/stainless/stlc-java.git \
      git+https://github.com/stainless/stlc-php.git \
      git+https://github.com/stainless/stlc-python.git \
      git+https://github.com/stainless/stlc-ruby.git \
      git+https://github.com/stainless/stlc-sql.git \
      git+https://github.com/stainless/stlc-terraform.git \
      git+https://github.com/stainless/stlc-typescript.git \
    && rm -f /root/.gitconfig

WORKDIR /workspace
```

One-time setup: create a GitHub PAT with `repo` scope (or fine-grained access to the `stainless/stlc-*` repos) and save it where `docker build` can read it.

```sh
mkdir -p ~/.config/stlc && chmod 700 ~/.config/stlc
# paste your PAT into the file, then lock it down:
$EDITOR ~/.config/stlc/gh-token
chmod 600 ~/.config/stlc/gh-token
```

Build and run against your config repo:

```sh
docker build \
  --secret id=gh-token,src=$HOME/.config/stlc/gh-token \
  -t stlc-env .

docker run --rm -it -v "$PWD":/workspace stlc-env stlc build
```

Confirm the token didn't bleed into the image:

```sh
docker history stlc-env                                # no PAT visible
docker run --rm stlc-env cat /root/.gitconfig 2>&1     # "No such file"
docker run --rm stlc-env stlc version
```

> **Note:**
>
> If you want reproducible images, the `flake.nix` from Option 3 also works inside a container: replace the `apt-get` block with a Nix installation step and `nix develop --command stlc build`.

Install Docker from [docs.docker.com/get-docker](https://docs.docker.com/get-docker/).

## Verify your environment

Check the toolchains for the targets you build:

```sh
node --version
python3 --version
go version
ruby --version
java -version
dotnet --version
php --version
composer --version
```

Then check the CLI itself:

```sh
stlc version
```

Once `stlc version` reports the expected version, follow [Run your first build](./07-migrate-build.md) to generate SDKs locally.
