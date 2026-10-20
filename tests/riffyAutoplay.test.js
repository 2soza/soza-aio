const test = require('node:test');
const assert = require('node:assert/strict');
const { setRiffyAutoplayEnabled } = require('../utils/riffyAutoplay');

class FakeRiffyPlayer {
    autoplay(player) {
        return player;
    }
}

test('autoplay preference updates the flag without replacing the Riffy method', () => {
    const player = new FakeRiffyPlayer();

    assert.equal(setRiffyAutoplayEnabled(player, true), true);
    assert.equal(player.isAutoplay, true);
    assert.equal(typeof player.autoplay, 'function');
    assert.equal(player.autoplay(player), player);

    assert.equal(setRiffyAutoplayEnabled(player, false), true);
    assert.equal(player.isAutoplay, false);
    assert.equal(typeof player.autoplay, 'function');
});

test('autoplay preference repairs a legacy boolean override', () => {
    const player = new FakeRiffyPlayer();
    player.autoplay = true;

    assert.equal(setRiffyAutoplayEnabled(player, true), true);
    assert.equal(player.isAutoplay, true);
    assert.equal(typeof player.autoplay, 'function');
    assert.equal(player.autoplay(player), player);
});

test('autoplay preference safely ignores a missing player', () => {
    assert.equal(setRiffyAutoplayEnabled(null, true), false);
});
