---
title: "Activate stlc access"
description: "Invite your org to the private stlc repositories so authorized members can install and run stlc."
slug: migrate-activate
source: https://app.stainless.com/knock/transition/docs/migrate-activate
---

# Activate stlc access

_Invite your org to the private stlc repositories so authorized members can install and run stlc._

`stlc` and its per-target `stlc-*` packages live in private GitHub repositories under the `stainless` org. Activating access invites authorized members of your org to those repos so they can install the CLI, run builds in CI, and mint the `STLC_READ_TOKEN` used by your workflows.

Do this first. The rest of the migration depends on having access, and the `STLC_READ_TOKEN` PAT listed on the [Migration plan](./03-migration-plan.md#prerequisites) can only be minted once your account has accepted the invites and can see the `stlc-*` repos.

## Get access

```widget:activate-stlc-access```
