---
name: blocks-release-deployment
description: "Trigger and inspect SELISE Blocks Release builds/deploys entirely through `blocks release *` — never raw fetch/curl; there is no SDK path. Covers `deploy` (re-deploy), `setup` (first deploy), `status`/`logs` (by build id), `repos list`/`builds list` (inventory), `secrets sync` (env vars from a dotenv file), `reports get` (SAST/SCA), and `teardown` (destructive). Use for 'deploy a release', 'check build status', 'stream build logs', 'sync env vars', 'list builds'. Always `--dry-run` before `--yes`. No artifact upload — deploy triggers a configured pipeline only."
---

# blocks-release-deployment

This skill's content lives at [`.codex/skills/blocks-release-deployment/SKILL.md`](../../../.codex/skills/blocks-release-deployment/SKILL.md).

**Read that file now and follow it.** Its relative links (`flows/`, sibling files) resolve from that directory, not this one.

This stub exists so Claude Code discovers the skill. It holds no guidance of its own and must never be given any — the `.codex` copy is the single source of truth, and a second copy would drift.
