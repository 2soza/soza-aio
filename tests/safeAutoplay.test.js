const test = require('node:test');
const assert = require('node:assert/strict');
const { runSafeAutoplay } = require('../utils/safeAutoplay');

const makeTrack = id => ({ info: { identifier: id, uri: id, sourceName: 'youtube' } });

function makePlayer(resolveDelays) {
    let call = 0;
    const player = {
        previous: makeTrack('seed'),
        current: null,
        playing: false,
        queue: [],
        playCalls: 0,
        riffy: {
            resolve: () => {
                const delay = resolveDelays[call];
                const id = `t${++call}`;
                return new Promise(r => setTimeout(() => r({ loadType: 'search', tracks: [makeTrack(id)] }), delay));
            }
        },
        play() {
            player.playCalls++;
            player.current = player.queue.shift();
            player.playing = true;
        }
    };
    return player;
}

test('a timed-out autoplay search never plays or queues a second track later', async () => {
    // First search is slow (times out), second is fast.
    const player = makePlayer([200, 10]);
    const failures = [];
    const result = await runSafeAutoplay(player, {
        resolveTimeoutMs: 50,
        retryDelayMs: 1,
        onAttemptFailed: (a, t, e) => failures.push(e.message)
    });

    assert.equal(result.started, true);
    assert.deepEqual(failures, ['Autoplay resolve timed out']);
    const playing = player.current.info.identifier;

    // Let the stale first search finish.
    await new Promise(r => setTimeout(r, 250));
    assert.equal(player.playCalls, 1);
    assert.equal(player.queue.length, 0);
    assert.equal(player.current.info.identifier, playing);
});

test('autoplay stops quietly when the user started a song meanwhile', async () => {
    const player = makePlayer([30]);
    const pending = runSafeAutoplay(player, { resolveTimeoutMs: 1000 });
    player.playing = true; // user /play
    const result = await pending;
    assert.equal(result.started, false);
    assert.equal(player.playCalls, 0);
});
