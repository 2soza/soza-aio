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

If Discord's Audit Log records the new status text but a client still displays the old text, the API update succeeded and that client is showing stale channel-status UI. Compare another client or force-refresh/reopen Discord before changing bot code or retrying status writes.

**Why:** The Audit Log showed the exact new track status while the Android voice-channel list continued showing the previous playlist title.

**How to apply:** Treat the Audit Log entry as evidence of a successful write; ask the user to refresh or compare another Discord client when only the visible status is stale.

When a music player leaves voice, clear the channel status by sending an empty status through `setVoiceChannelStatus` before destroying the player. For an unexpected disconnect, use the channel ID from the old voice state; the bot may need `MANAGE_CHANNELS` because it is no longer connected.

**Why:** The user reported that track and idle statuses remained visible after the bot left voice.

**How to apply:** Clear status in centralized player cleanup, preserve stale-player protection so a replacement player is not cleared, and check the `[VoiceStatus]` warning if Discord rejects the update.

The shared `/leave` and `.leave` path must also clear status before destroying a voice-only connection; those sessions have no Riffy `playerDestroy` event to clear it.

**Why:** `/join` and `.join` set the idle status on a Discord voice-only connection.

**How to apply:** In `leaveFromContext`, send an empty status to the bot's current voice channel before destroying either its Riffy player or voice-only connection.
