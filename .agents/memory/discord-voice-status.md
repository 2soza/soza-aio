---
name: Discord voice channel status
description: The requested voice-channel status behavior for the Discord music bot.
---

When the bot is in a voice channel, show the current song as `title - artist` (no connecting word such as `by`) while music plays, prefixed with the animated soza emoji. If the bot is connected without playback, show `silence, add a track`. Use the bot account's normal Discord avatar in the member list.

**Why:** The user asked to match the voice-channel presentation in the Jockie Music and Hedwig screenshots.

**How to apply:** Update Discord's voice-channel status on join and confirmed playback events. The status text does not carry a custom image; Discord shows the bot account avatar for the bot's voice member.

The bot also needs Discord's `SET_VOICE_CHANNEL_STATUS` permission on the target voice channel. `VIEW_CHANNEL` and `CONNECT` alone allow playback but not status changes; if the bot is not connected to that channel, Discord additionally requires `MANAGE_CHANNELS`. A rejected status request leaves the prior text visible even when the now-playing message has advanced.

**Why:** The deployed bot could play a new track and update its now-playing card while the voice-channel status stayed on an older playlist title; Discord's status endpoint requires this separate permission.

**How to apply:** Grant `Set Voice Channel Status` to the bot role or as a channel override. Check the bot's Railway logs for `[VoiceStatus] Could not update channel status` if the status still does not change; do not block playback just because this optional permission is missing.
