---
name: Deleted-message history
description: User-selected access and retention policy for deleted Discord message history.
---

Deleted-message history must be isolated by guild, visible only to moderators with `Manage Messages`, returned privately, and retained for 30 days. Capture message content while it is active so it can be found if deleted later; deleted records expire 30 days after deletion, while active archive records expire 30 days after sending. The Discord Message Content privileged intent must be enabled. Messages deleted before capture starts cannot be recovered.

**Why:** The user requested moderator-only access, 30-day retention, and per-server history to avoid unbounded accumulation.

**How to apply:** Scope every history query to the invoking guild, keep results ephemeral, and bound storage with TTL expiration. Be clear that only messages captured after activation are searchable.
