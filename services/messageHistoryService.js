const DeletedMessage = require('../models/serverLogs/DeletedMessage');
const {
    MAX_ATTACHMENT_DOWNLOAD_BYTES,
    addRetention,
    createMessageSnapshot,
    fetchAttachmentBuffer
} = require('../utils/messageHistory');

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
        let remainingBytes = MAX_ATTACHMENT_DOWNLOAD_BYTES;
        const sourceAttachments = message.attachments
            ? [...message.attachments.values()]
            : [];

        for (const [index, attachment] of sourceAttachments.entries()) {
            if (remainingBytes <= 0) break;
            const declaredSize = Number(attachment.size) || 0;
            if (declaredSize > remainingBytes) continue;

            const data = await fetchAttachmentBuffer(attachment, remainingBytes);
            if (!data) continue;

            snapshot.attachments[index].data = data;
            remainingBytes -= data.length;
        }

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
        const { attachments, ...snapshotWithoutAttachments } = snapshot;
        const update = snapshot.contentAvailable
            ? {
                $set: { ...snapshotWithoutAttachments, deletedAt },
                $setOnInsert: { attachments }
            }
            : {
                $set: { deletedAt },
                $setOnInsert: snapshot
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
