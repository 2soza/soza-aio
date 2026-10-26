const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits, PermissionsBitField, MessageFlags } = require('discord.js');
const purge = require('../excesscommands/other/purge');
const say = require('../commands/fun/say');
const adminOrBotOwner = require('../utils/adminOrBotOwner');

function message(userId, permissions) {
    const calls = { fetched: 0, deleted: 0, replies: [] };
    const reply = { delete: async () => {} };
    const recent = { size: 1, filter() { return this; }, first() { return [{ id: 'recent' }]; } };
    return { calls, author: { id: userId }, member: { permissions: new PermissionsBitField(permissions) },
        guild: { members: { me: { permissionsIn: () => new PermissionsBitField(PermissionFlagsBits.ManageMessages) } } },
        reply: async payload => { calls.replies.push(payload); return reply; },
        channel: { messages: { fetch: async () => { calls.fetched++; return recent; } },
            bulkDelete: async () => { calls.deleted++; return { size: 1 }; }, send: async () => reply } };
}

function interaction(userId, permissions) {
    const calls = { sent: [], replies: [], deferred: 0, optionsRead: 0 };
    return { calls, user: { id: userId, displayName: 'Tester' }, guild: { id: 'guild' },
        memberPermissions: new PermissionsBitField(permissions), isChatInputCommand: () => true,
        options: { getString: name => { calls.optionsRead++; return name === 'message' ? 'Hello friend' : 'plain'; } },
        reply: async payload => calls.replies.push(payload), deferReply: async () => { calls.deferred++; },
        editReply: async () => {}, channel: { name: 'general', send: async payload => calls.sent.push(payload) } };
}

 test('purge and say allow only Administrator or DISCORD_USER_ID, never Manage Messages or custom managers', async t => {
    const previousOwner = process.env.DISCORD_USER_ID;
    const previousTimeout = global.setTimeout;
    process.env.DISCORD_USER_ID = 'owner-test';
    global.setTimeout = () => ({ unref() {} });
    try {
        for (const [label, permissions, owner, allowed] of [
            ['Administrator', PermissionFlagsBits.Administrator, false, true],
            ['bot owner without permissions', 0n, true, true],
            ['Manage Messages only', PermissionFlagsBits.ManageMessages, false, false],
            ['ordinary member', 0n, false, false],
            ['configured manager without Administrator', 0n, false, false]
        ]) {
            await t.test(label, async () => {
                const userId = owner ? 'owner-test' : label;
                const msg = message(userId, permissions);
                const cmd = interaction(userId, permissions);
                // Custom labels / ownership must never confer access by themselves.
                msg.guild.ownerId = userId;
                msg.member.roles = { cache: new Map([['manager', {}]]) };
                await purge.execute(msg, ['1']);
                await say.execute(cmd);
                assert.equal(msg.calls.deleted, allowed ? 1 : 0);
                assert.equal(msg.calls.fetched, allowed ? 1 : 0);
                assert.equal(cmd.calls.sent.length, allowed ? 1 : 0);
                assert.equal(cmd.calls.deferred, allowed ? 1 : 0);
                if (!allowed) {
                    assert.equal(msg.calls.replies.length, 1);
                    assert.equal(cmd.calls.replies.length, 1);
                    assert.equal(cmd.calls.optionsRead, 0);
                    assert.equal(cmd.calls.replies[0].flags, MessageFlags.Ephemeral);
                }
            });
        }
        await t.test('missing or malformed permissions fail closed; empty owner does not match', () => {
            process.env.DISCORD_USER_ID = '';
            assert.equal(adminOrBotOwner({ guild: {}, author: { id: 'ordinary' } }), false);
            assert.equal(adminOrBotOwner({ guild: {}, user: { id: 'ordinary' }, memberPermissions: 'invalid' }), false);
            assert.equal(adminOrBotOwner({ guild: {}, user: { id: '' } }), false);
            assert.equal(adminOrBotOwner({ user: { id: 'ordinary' } }), false);
            assert.equal(adminOrBotOwner({ guild: {}, user: { id: 'admin' }, member: { permissions: '8' } }), true);
        });
        await t.test('configured owner is read at execution, ignoring legacy hardcoded IDs', () => {
            process.env.DISCORD_USER_ID = ' new-owner ';
            assert.equal(adminOrBotOwner({ user: { id: 'new-owner' } }), true);
            assert.equal(adminOrBotOwner({ guild: {}, user: { id: 'owner-test' } }), false);
            assert.equal(adminOrBotOwner({ guild: {}, user: { id: '1015128735416061952' } }), false);
        });
    } finally {
        global.setTimeout = previousTimeout;
        if (previousOwner === undefined) delete process.env.DISCORD_USER_ID;
        else process.env.DISCORD_USER_ID = previousOwner;
    }
});
