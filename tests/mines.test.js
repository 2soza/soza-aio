const test = require('node:test');
const assert = require('node:assert/strict');
const {
    BOARD_SIZE, combination, multiplierFor, payoutFor,
    generateMinePositions, parseMineCount
} = require('../funeconomy/minesMath');

test('Mines payouts match the 94% RTP examples from the reference image', () => {
    assert.equal(payoutFor(250000, 1, 5), 528750);
    assert.equal(payoutFor(250000, 1, 6), 705000);
    assert.equal(payoutFor(250000, 1, 7), 1057500);
    assert.equal(multiplierFor(1, 6), 2.82);
});

test('Mines payout validation rejects impossible board states', () => {
    assert.equal(combination(9, 0), 1);
    assert.equal(combination(9, 10), 0);
    assert.equal(multiplierFor(0, 1), null);
    assert.equal(multiplierFor(9, 1), null);
    assert.equal(multiplierFor(1, 0), null);
    assert.equal(multiplierFor(1, 9), null);
    assert.equal(payoutFor(0, 1, 1), null);
    assert.equal(payoutFor(250000, 1, 9), null);
});

test('Mine placement creates the requested number of unique cells', () => {
    for (const mineCount of [1, 4, 8]) {
        const positions = generateMinePositions(mineCount);
        assert.equal(positions.length, mineCount);
        assert.equal(new Set(positions).size, mineCount);
        assert.ok(positions.every((position) => position >= 0 && position < BOARD_SIZE));
    }
});

test('Mine count defaults to one and accepts only 1 through 8', () => {
    assert.deepEqual(parseMineCount(undefined), { mineCount: 1 });
    assert.deepEqual(parseMineCount('8'), { mineCount: 8 });
    assert.ok(parseMineCount('0').error);
    assert.ok(parseMineCount('9').error);
    assert.ok(parseMineCount('1.5').error);
});
