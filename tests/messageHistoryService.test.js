const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { addRetention } = require('../utils/messageHistory');

const writes = [];
const fakeDeletedMessageModel = {
    updateOne: async (...args) => {
        writes.push(args);
    }
};
const originalLoad = Module._load;
let messageHistoryService;

Module._load = function loadWithMessageModelMock(request, parent, isMain) {
    if (
        request === '../models/serverLogs/DeletedMessage' &&
        parent?.filename?.endsWith('/services/messageHistoryService.js')
    ) {
        return fakeDeletedMessageModel;
    }
    return originalLoad.call(this, request, parent, isMain);
};

try {
    messageHistoryService = require('../services/messageHistoryService');
} finally {
    Module._load = originalLoad;
}

function createMessage(overrides = {}) {
    return {
        id: 'message-123',
        guildId: 'guild-123',
        channelId: 'channel-123',
        author: { id: 'user-123', tag: 'soza#1234', bot: false },
        content: 'A message that may be deleted',
        createdAt: new Date('2026-10-01T12:00:00.000Z'),
        attachments: new Map(),
        ...overrides
    };
}

test('active messages are archived per server and expire 30 days after sending', async () => {
    writes.length = 0;
    const message = createMessage();

    assert.equal(await messageHistoryService.archiveMessage(message), true);

    const [filter, update, options] = writes[0];
    assert.deepEqual(filter, { guildId: 'guild-123', messageId: 'message-123' });
    assert.equal(update.$set.content, message.content);
    assert.equal(update.$max.expiresAt.getTime(), addRetention(message.createdAt).getTime());
    assert.deepEqual(options, { upsert: true });
});

test('deleted-message records archive downloadable attachments within the storage limit', async () => {
    writes.length = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(Buffer.from('image-bytes'));
    const message = createMessage({
        attachments: new Map([['attachment-1', {
            name: 'image.png',
            url: 'https://cdn.discordapp.com/attachments/123/456/image.png',
            size: 11,
            contentType: 'image/png'
        }]])
    });

    try {
        assert.equal(await messageHistoryService.archiveMessage(message), true);
        const [, update] = writes[0];
        assert.equal(update.$set.attachments[0].data.toString(), 'image-bytes');
    } finally {
        global.fetch = originalFetch;
    }
});

test('deleting a message retains it for 30 days after deletion', async () => {
    writes.length = 0;
    const message = createMessage();
    const deletedAt = new Date('2026-10-10T12:00:00.000Z');

    assert.equal(await messageHistoryService.markMessageDeleted(message, deletedAt), true);

    const [filter, update] = writes[0];
    assert.deepEqual(filter, { guildId: 'guild-123', messageId: 'message-123' });
    assert.equal(update.$set.deletedAt.getTime(), deletedAt.getTime());
    assert.equal(update.$set.content, message.content);
    assert.equal(update.$max.expiresAt.getTime(), addRetention(deletedAt).getTime());
    assert.equal(update.$set.attachments, undefined);
    assert.deepEqual(update.$setOnInsert.attachments, []);
});

test('partial deletion events do not overwrite previously archived content', async () => {
    writes.length = 0;
    const message = createMessage({
        partial: true,
        author: null,
        content: undefined,
        attachments: new Map()
    });

    await messageHistoryService.markMessageDeleted(message, new Date('2026-10-10T12:00:00.000Z'));

    const [, update] = writes[0];
    assert.equal(update.$set.content, undefined);
    assert.equal(update.$setOnInsert.contentAvailable, false);
});

test('bot-authored messages are not archived', async () => {
    writes.length = 0;
    assert.equal(
        await messageHistoryService.archiveMessage(createMessage({
            author: { id: 'bot-123', tag: 'bot', bot: true }
        })),
        false
    );
    assert.equal(writes.length, 0);
});
