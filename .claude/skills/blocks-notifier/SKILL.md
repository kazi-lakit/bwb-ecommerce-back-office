---
name: blocks-notifier
description: "Push real-time/offline notifications and manage a signed-in user's own notification inbox, via both the SDK (`blocksClient.notifier.*`) and the CLI (`blocks notifier notify|list|unread|mark-read|mark-all-read`). Distinct from the sibling blocks-notification skill, which configures tenant notification-*channel* settings on a different backing service, not sending. `notifier unread` flattens its subscription filter into GET query params since Fetch forbids a GET body. `--dry-run` before `--yes` on CLI `notify`/`mark-read`/`mark-all-read`."
---

# blocks-notifier

This skill's content lives at [`.codex/skills/blocks-notifier/SKILL.md`](../../../.codex/skills/blocks-notifier/SKILL.md).

**Read that file now and follow it.** Its relative links (`flows/`, sibling files) resolve from that directory, not this one.

This stub exists so Claude Code discovers the skill. It holds no guidance of its own and must never be given any — the `.codex` copy is the single source of truth, and a second copy would drift.
