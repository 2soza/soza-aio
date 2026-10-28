---
name: Riffy playback start
description: Riffy player creation and track resolution behavior relevant to playlist playback.
---

Riffy's `createPlayer()` establishes the voice request but playlist playback does not begin until `player.play()` is called after at least one resolved track is queued. Resolving a large Spotify collection sequentially before calling `play()` leaves the bot in voice with no audio or `trackStart` event.

**Why:** The Riffy play call selects and sends the current encoded track, while later collection searches are independent queue work. Delaying that call makes long playlists appear stuck.

**How to apply:** Queue and start the first successful result immediately, then resolve and append remaining tracks. Pass the selected node through Riffy's `resolve({ node })` option rather than relying on an unsupported node selector property.

Lavalink may emit `TrackStartEvent` before YouTube rejects the actual source stream with `TrackExceptionEvent`; `queueEnd` can race with that error, so a green voice connection or “Active” panel does not prove that audio is flowing.

**Why:** Track selection and source-stream acquisition happen as separate Lavalink steps, and asynchronous cleanup can let autoplay react to `queueEnd` before the error-recovery handler claims the player.

**How to apply:** Set the recovery guard before awaiting cleanup, have `queueEnd`/autoplay recheck it after a short grace period, remove stale now-playing UI, retry distinct candidates, and bound recovery by both attempts and elapsed time instead of leaving a silent session alive.

When a track error may be caused by a degraded Lavalink node, `client.riffy.migrate(player)` moves the active player to another connected node while preserving its voice state and queue.

**Why:** Riffy's public node list contains configuration objects, while connected runtime nodes live in `client.riffy.nodeMap`; recovery must select from the latter.

**How to apply:** Before retrying a failed track, migrate only when another connected node exists, then resolve replacement tracks against `player.node`.

All music playback in this project uses Riffy; do not keep or restore DisTube playback paths or dependencies.

**Why:** The user requested complete DisTube removal to prevent playback-engine conflicts.

**How to apply:** Route prefix and slash music through Riffy, keep a single owner for each guild's voice session, and remove obsolete DisTube command, event, and package references.

Riffy's finite reconnect loop can leave a disconnected node in `nodeMap` after retries are exhausted, so recovery must reset/reconnect that node or recreate it from configuration.

**Why:** A missing `nodeDisconnect` cleanup path can make all later node selection report no healthy nodes until the bot process restarts.

**How to apply:** Keep a low-frequency watchdog for configured nodes; restore disconnected nodes without rebuilding the Discord client.

Riffy's autoplay implementation can resolve a track and call `play()` without awaiting the playback promise, so a successful return does not guarantee that the next track started.

**Why:** A rejected or stalled `play()` promise can occur after the autoplay method has already returned, producing a false success message and no `trackStart` embed.

**How to apply:** Capture and await the internal play promise, bound the wait with a timeout, retry a few times, and keep the queue-end recovery guarded against re-entry.

Before queue-end autoplay calls `player.play()`, require `player.connected` as well as a connection object and the same live player in Riffy's guild map. A truthy `player.connection` alone does not prove the voice connection was initiated.

**Why:** The runtime reported “Player connection is not initiated” during autoplay even though the queue-end guard only checked for a connection object.

**How to apply:** Check `player.connected` before autoplay starts and again through its validity callback so a disconnect during track resolution cancels playback.
