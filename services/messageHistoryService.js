const DeletedMessage = require('../models/serverLogs/DeletedMessage');
const { addRetention, createMessageSnapshot } = require('../utils/messageHistory');

const pendingWrites = new Map();

function serializeMessageWrite(guildId, messageId, operation) {
    const key = `${guildId}:${messageId}`;
    const previousWrite = pendingWrites.get(key) || Promise.resolve();
    const write = previousWrite.catch(() => {}).then(operation);
    pendingWrites.set(key, write);

    return write.finally(() => {
        if (pendingWrites.get(key) === write) {
            pendingWrites.delete(key);
        }
    });
}

function archiveMessage(message) {
    if (message?.author?.bot || message?.webhookId) return Promise.resolve(false);

    const snapshot = createMessageSnapshot(message);
    if (!snapshot || !snapshot.contentAvailable) return Promise.resolve(false);

    return serializeMessageWrite(snapshot.guildId, snapshot.messageId, async () => {
        const expiresAt = addRetention(snapshot.sentAt);
        await DeletedMessage.updateOne(
            { guildId: snapshot.guildId, messageId: snapshot.messageId },
            {
                $set: snapshot,
                $setOnInsert: { deletedAt: null },
                $max: { expiresAt }
            },
            { upsert: true }
        );
        return true;
    });
}

function markMessageDeleted(message, deletedAt = new Date()) {
    if (message?.author?.bot || message?.webhookId) return Promise.resolve(false);

    const snapshot = createMessageSnapshot(message, deletedAt);
    if (!snapshot) return Promise.resolve(false);

    return serializeMessageWrite(snapshot.guildId, snapshot.messageId, async () => {
        const update = snapshot.contentAvailable
            ? { $set: { ...snapshot, deletedAt } }
            : {
                $set: { deletedAt },
                $setOnInsert: {
                    channelId: snapshot.channelId,
                    authorId: snapshot.authorId,
                    authorTag: snapshot.authorTag,
                    content: snapshot.content,
                    contentAvailable: snapshot.contentAvailable,
                    attachments: snapshot.attachments,
                    sentAt: snapshot.sentAt
                }
            };
        update.$max = { expiresAt: addRetention(deletedAt) };

        await DeletedMessage.updateOne(
            { guildId: snapshot.guildId, messageId: snapshot.messageId },
            update,
            { upsert: true }
        );
        return true;
    });
}

module.exports = {
    archiveMessage,
    markMessageDeleted
};
