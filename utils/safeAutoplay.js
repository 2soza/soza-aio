// Cancellation-safe replacement for Riffy's player.autoplay().
//
// Riffy's built-in autoplay() resolves a track and then directly calls
// queue.push(), play() or stop() on the player. When our timeout fired, that
// call kept running in the background; once it finished it would push/play a
// second track or call stop(), which skipped the song a later retry had
// already started. Here resolving is separated from playing: a resolve that
// finishes after its attempt was abandoned is simply discarded.

let riffyAutoPlayHelper = null;
function getAutoPlayHelper() {
    if (!riffyAutoPlayHelper) {
        // Same helper Riffy uses internally for Spotify/SoundCloud/Apple Music.
        riffyAutoPlayHelper = require('riffy/build/functions/autoPlay').autoPlay;
    }
    return riffyAutoPlayHelper;
}

function withTimeout(promise, timeoutMs, message) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function rememberPlayed(player, track) {
    if (!track) return;
    if (!player.playedIdentifiers) player.playedIdentifiers = new Set();
    const id = track.info.identifier || track.info.uri;
    player.playedIdentifiers.add(id);
    if (player.playedIdentifiers.size > 50) {
        player.playedIdentifiers.delete(player.playedIdentifiers.values().next().value);
    }
}

// Resolves a similar track WITHOUT touching the player's queue or playback.
async function resolveAutoplayTrack(player, seedTrack) {
    if (!seedTrack || !seedTrack.info) throw new Error('No previous track to base autoplay on');

    const platform = seedTrack.info.sourceName;
    let query;
    let source;

    if (platform === 'youtube') {
        query = `https://www.youtube.com/watch?v=${seedTrack.info.identifier}&list=RD${seedTrack.info.identifier}`;
        source = 'ytmsearch';
    } else if (['soundcloud', 'spotify', 'applemusic'].includes(platform)) {
        const helperSource = platform === 'applemusic'
            ? 'apple-music'
            : (platform === 'soundcloud' ? 'sound-cloud' : platform);
        query = await getAutoPlayHelper()(seedTrack.info.uri, helperSource);
        source = platform === 'soundcloud' ? 'scsearch' : (platform === 'spotify' ? 'spsearch' : 'amsearch');
    } else {
        throw new Error(`Autoplay does not support source "${platform}"`);
    }

    if (!query) throw new Error('Autoplay could not find related tracks');

    const response = await player.riffy.resolve({
        query,
        source,
        requester: seedTrack.info.requester
    });

    const failedTypes = ['error', 'empty', 'LOAD_FAILED', 'NO_MATCHES'];
    if (!response || !Array.isArray(response.tracks) || failedTypes.includes(response.loadType)) {
        throw new Error('Autoplay search returned no tracks');
    }

    const played = player.playedIdentifiers || new Set();
    let candidates = response.tracks.filter(t => !played.has(t.info.identifier || t.info.uri));
    if (candidates.length === 0) candidates = response.tracks;
    if (candidates.length === 0) throw new Error('Autoplay search returned no tracks');

    const track = candidates[Math.floor(Math.random() * candidates.length)];
    Object.defineProperty(track, 'isAutoplay', { writable: false, enumerable: true, value: true });
    return track;
}

/**
 * Runs autoplay with retries. Only one result can ever reach the player.
 * Returns { started: true, track } or { started: false, cancelled: true }.
 * Throws the last error when every attempt failed.
 */
async function runSafeAutoplay(player, {
    attempts = 3,
    resolveTimeoutMs = 20000,
    playTimeoutMs = 20000,
    retryDelayMs = 1000,
    isStillValid = () => true,
    onAttemptFailed = () => {}
} = {}) {
    const seedTrack = player.previous || player.current;
    rememberPlayed(player, seedTrack);
    player.isAutoplay = true;

    // Anything else (a user /play, a stop, a destroy) wins over autoplay.
    const cancelled = () =>
        !isStillValid() ||
        player.playing ||
        player.queue.length > 0;

    let lastError = null;
    let pendingPlay = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        // A play() that timed out earlier may have succeeded in the meantime.
        if (pendingPlay && pendingPlay.done && player.playing && player.current) {
            return { started: true, track: pendingPlay.track };
        }
        if (pendingPlay && pendingPlay.done) pendingPlay = null;
        if (cancelled()) return { started: false, cancelled: true };

        try {
            // If a previous play() is still in flight, wait for it instead of
            // starting another track on top of it.
            if (pendingPlay) {
                await withTimeout(pendingPlay.promise, playTimeoutMs, 'Autoplay playback timed out');
                if (player.playing && player.current) {
                    return { started: true, track: pendingPlay.track };
                }
                pendingPlay = null;
                throw new Error('Autoplay did not leave an active track');
            }

            // A timed-out resolve keeps running but can no longer do anything:
            // its result is just a value nobody reads.
            const track = await withTimeout(
                resolveAutoplayTrack(player, seedTrack),
                resolveTimeoutMs,
                'Autoplay resolve timed out'
            );

            if (cancelled()) return { started: false, cancelled: true };

            player.queue.push(track);
            const promise = Promise.resolve().then(() => player.play());
            const entry = { promise, track, done: false };
            promise.then(() => { entry.done = true; }, () => { entry.done = true; });
            pendingPlay = entry;

            await withTimeout(promise, playTimeoutMs, 'Autoplay playback timed out');
            pendingPlay = null;

            if (!player.playing || !player.current) {
                throw new Error('Autoplay did not leave an active track');
            }

            rememberPlayed(player, track);
            return { started: true, track };
        } catch (error) {
            lastError = error;
            onAttemptFailed(attempt, attempts, error);
            if (attempt < attempts) {
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            }
        }
    }

    throw lastError || new Error('Autoplay could not start a track');
}

module.exports = { runSafeAutoplay, resolveAutoplayTrack, withTimeout };
