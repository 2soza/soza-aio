---
name: Deleted-message history
description: User-selected access and retention policy for deleted Discord message history.
---

Deleted-message history must be isolated by guild, returned privately, and accessible only to the configured bot owner as enforced by `DISCORD_USER_ID`. Restrict normal member visibility in each server's Integrations settings; Discord administrators may still see commands due to the platform override, but the handler must reject them unless they are the configured bot owner. Retain records for 30 days and capture bounded attachment copies while messages are active so deleted files can be delivered privately. The Discord Message Content privileged intent must be enabled. Messages deleted before capture starts cannot be recovered.

**Why:** The user requested bot-owner-only access and downloadable deleted attachments, with 30-day retention and per-server history.

**How to apply:** Scope every history query to the invoking guild, keep results ephemeral, limit stored attachment bytes, and bound storage with TTL expiration. Be clear that only messages captured after activation are searchable.
