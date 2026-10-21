---
name: Discord voice channel status
description: The requested voice-channel status behavior for the Discord music bot.
---

When the bot is in a voice channel, show the current song as `title - artist` (no connecting word such as `by`) while music plays, prefixed with the animated soza emoji. If the bot is connected without playback, show `silence, add a track`. Use the bot account's normal Discord avatar in the member list.

**Why:** The user asked to match the voice-channel presentation in the Jockie Music and Hedwig screenshots.

**How to apply:** Update Discord's voice-channel status on join and confirmed playback events. The status text does not carry a custom image; Discord shows the bot account avatar for the bot's voice member.
