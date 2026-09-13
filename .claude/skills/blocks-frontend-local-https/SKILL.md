---
name: blocks-frontend-local-https
description: "Run a scaffolded (`blocks new web`) Blocks app locally over HTTPS on its real project domain — required for hosted IAM login, since plain HTTP or localhost never gets the session cookie. The scaffold already automates cert generation (npm run cert, no OpenSSL needed) and HTTPS serving via vite.config.ts. Covers running that flow, trusting the cert, the hosts-file entry, and troubleshooting. Use when running a scaffolded app over HTTPS, hitting 'SSO cookie not set' / Vite 'Blocked request' errors, trusting the dev cert, or asking why local login redirects back but doesn't stay signed in."
---

# blocks-frontend-local-https

This skill's content lives at [`.codex/skills/blocks-frontend-local-https/SKILL.md`](../../../.codex/skills/blocks-frontend-local-https/SKILL.md).

**Read that file now and follow it.** Its relative links (`flows/`, sibling files) resolve from that directory, not this one.

This stub exists so Claude Code discovers the skill. It holds no guidance of its own and must never be given any — the `.codex` copy is the single source of truth, and a second copy would drift.
