---
name: blocks-iam-access-control
description: "Work with SELISE Blocks RBAC (roles & permissions) via `blocks iam roles/permissions *` (CLI, project-scoped) or `blocksClient.iam.*` (SDK), never raw fetch/curl. Two facets: read-only feature-gating by the current user's own roles/permissions (common, safe), and creating/editing role and permission definitions (sensitive — CLI `--dry-run`→`--yes`, or an in-app admin screen). Use for permission-gated UI, role/permission pickers, scripting role & permission admin, granting platform-seeded (built-in) permissions to custom roles, or diagnosing 403s / missing UI controls caused by an under-permissioned role. OIDC/identity-provider setup is a different skill."
---

# blocks-iam-access-control

This skill's content lives at [`.codex/skills/blocks-iam-access-control/SKILL.md`](../../../.codex/skills/blocks-iam-access-control/SKILL.md).

**Read that file now and follow it.** Its relative links (`flows/`, sibling files) resolve from that directory, not this one.

This stub exists so Claude Code discovers the skill. It holds no guidance of its own and must never be given any — the `.codex` copy is the single source of truth, and a second copy would drift.
