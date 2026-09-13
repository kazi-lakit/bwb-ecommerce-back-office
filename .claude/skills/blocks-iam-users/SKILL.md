---
name: blocks-iam-users
description: "Manage OTHER users' IAM records via `blocksClient.iam.users.*` (never raw fetch/curl), or the equivalent project-scoped `blocks iam users *` / `blocks iam email available` CLI. Covers reads (`get`, `list`, `emailAvailable`, `exists`) and admin mutations (`create`, `update`, `activate`, `deactivate`, `updateAccess`, `revokeAccess`) — CLI mutations require `--dry-run`/`--yes`. Use to invite, edit, deactivate/reactivate, list/search users, or grant/revoke roles/org access. Not for the current user's own profile (blocks-iam-account) or role/permission definitions (blocks-iam-access-control)."
---

# blocks-iam-users

This skill's content lives at [`.codex/skills/blocks-iam-users/SKILL.md`](../../../.codex/skills/blocks-iam-users/SKILL.md).

**Read that file now and follow it.** Its relative links (`flows/`, sibling files) resolve from that directory, not this one.

This stub exists so Claude Code discovers the skill. It holds no guidance of its own and must never be given any — the `.codex` copy is the single source of truth, and a second copy would drift.
