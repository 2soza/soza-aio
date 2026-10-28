const test = require('node:test');
const assert = require('node:assert/strict');
const {
    RETENTION_MS,
    MAX_ATTACHMENT_DOWNLOAD_BYTES,
    addRetention,
    createMessageSnapshot,
    buildDeletedMessageQuery,
    fetchAttachmentBuffer
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

test('attachment downloads accept Discord CDN URLs within the size limit', async () => {
    const originalFetch = global.fetch;
    let requestedUrl;
    global.fetch = async url => {
        requestedUrl = url.toString();
        return new Response(Buffer.from('file-data'), {
            headers: { 'content-length': '9' }
        });
    };

    try {
        const data = await fetchAttachmentBuffer({
            url: 'https://cdn.discordapp.com/attachments/123/456/image.png'
        }, MAX_ATTACHMENT_DOWNLOAD_BYTES);
        assert.equal(data.toString(), 'file-data');
        assert.equal(requestedUrl, 'https://cdn.discordapp.com/attachments/123/456/image.png');
    } finally {
        global.fetch = originalFetch;
    }
});

test('attachment downloads reject responses larger than the configured limit', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(Buffer.from('too-large'));

    try {
        assert.equal(await fetchAttachmentBuffer({
            url: 'https://cdn.discordapp.com/attachments/123/456/image.png'
        }, 4), null);
    } finally {
        global.fetch = originalFetch;
    }
});

test('attachment downloads reject non-Discord URLs without making a request', async () => {
    const originalFetch = global.fetch;
    let wasRequested = false;
    global.fetch = async () => {
        wasRequested = true;
        throw new Error('unexpected request');
    };

    try {
        assert.equal(await fetchAttachmentBuffer({
            url: 'https://example.test/attachments/123/image.png'
        }), null);
        assert.equal(wasRequested, false);
    } finally {
        global.fetch = originalFetch;
    }
});
