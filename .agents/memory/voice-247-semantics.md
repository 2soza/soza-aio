---
name: 24/7 voice command behavior
description: The intended separation between explicit voice joining and always-on mode for this Discord bot.
---

`/247 enable` and `/247 disable` only toggle the saved 24/7 setting. Enabling requires the bot to already be connected to a voice channel through `/join` or a music command; `/247` itself must not join or leave voice. While the setting remains enabled, background recovery may reconnect after a later disconnect. Use `/leave` for an explicit disconnect.

**Why:** The user explicitly asked that `/247` behave as an enable/disable control rather than a join action, following the behavior they observed in Eleven.

**How to apply:** Keep user-triggered joining in `/join` and 24/7 state changes in `/247`; permit automatic reconnect only as background behavior while the saved mode is enabled.
