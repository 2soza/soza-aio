const test = require('node:test');
const assert = require('node:assert/strict');
const {
    RETENTION_MS,
    addRetention,
    createMessageSnapshot,
    buildDeletedMessageQuery
} = require('../utils/messageHistory');

test('message snapshots are scoped to the server and retain message and attachment details', () => {
    const sentAt = new Date('2026-10-01T12:00:00.000Z');
    const message = {
        id: 'message-123',
        guildId: 'guild-123',
        channelId: 'channel-123',
        author: { id: 'user-123', tag: 'soza#1234' },
        content: 'Hello',
        createdAt: sentAt,
        attachments: new Map([['attachment-1', {
            name: 'image.png',
            url: 'https://cdn.example.test/image.png',
            size: 42,
            contentType: 'image/png'
        }]])
    };

    assert.deepEqual(createMessageSnapshot(message), {
        guildId: 'guild-123',
        messageId: 'message-123',
        channelId: 'channel-123',
        authorId: 'user-123',
        authorTag: 'soza#1234',
        content: 'Hello',
        contentAvailable: true,
        attachments: [{
            name: 'image.png',
            url: 'https://cdn.example.test/image.png',
            size: 42,
            contentType: 'image/png'
        }],
        sentAt
    });
});

test('message snapshots skip direct messages without a server ID', () => {
    assert.equal(createMessageSnapshot({
        id: 'message-123',
        channelId: 'dm-123',
        content: 'Private message',
        createdAt: new Date()
    }), null);
});

test('history expiry is 30 days after the supplied date', () => {
    const deletedAt = new Date('2026-10-01T12:00:00.000Z');
    assert.equal(addRetention(deletedAt).getTime(), deletedAt.getTime() + RETENTION_MS);
});

test('history queries always stay within one server and respect optional filters', () => {
    const now = new Date('2026-10-21T12:00:00.000Z');
    assert.deepEqual(
        buildDeletedMessageQuery('guild-123', {
            userId: 'user-123',
            channelId: 'channel-123'
        }, now),
        {
            guildId: 'guild-123',
            deletedAt: { $ne: null },
            expiresAt: { $gt: now },
            authorId: 'user-123',
            channelId: 'channel-123'
        }
    );
});
