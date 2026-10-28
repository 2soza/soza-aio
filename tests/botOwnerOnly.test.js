const test = require('node:test');
const assert = require('node:assert/strict');
const { getBotOwnerId, isBotOwner } = require('../utils/botOwnerOnly');

const originalOwnerId = process.env.DISCORD_USER_ID;

test.after(() => {
    if (originalOwnerId === undefined) {
        delete process.env.DISCORD_USER_ID;
    } else {
        process.env.DISCORD_USER_ID = originalOwnerId;
    }
});

test('only the configured owner ID is accepted', () => {
    process.env.DISCORD_USER_ID = '123456789012345678';

    assert.equal(getBotOwnerId(), '123456789012345678');
    assert.equal(isBotOwner({ user: { id: '123456789012345678' } }), true);
    assert.equal(isBotOwner({ user: { id: '123456789012345679' } }), false);
    assert.equal(isBotOwner({
        user: { id: '123456789012345679' },
        memberPermissions: { has: () => true }
    }), false);
});

test('an unset or invalid owner ID fails closed', () => {
    process.env.DISCORD_USER_ID = 'not-a-discord-id';
    assert.equal(getBotOwnerId(), null);
    assert.equal(isBotOwner({ user: { id: '123456789012345678' } }), false);

    delete process.env.DISCORD_USER_ID;
    assert.equal(isBotOwner({ user: { id: '123456789012345678' } }), false);
});
