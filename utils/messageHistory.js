const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

function addRetention(date) {
    return new Date(new Date(date).getTime() + RETENTION_MS);
}

function createMessageSnapshot(message, now = new Date()) {
    const guildId = message?.guildId || message?.guild?.id;
    const channelId = message?.channelId || message?.channel?.id;
    if (!guildId || !channelId || !message?.id) return null;

    const sentAt = message.createdAt
        ? new Date(message.createdAt)
        : message.createdTimestamp
            ? new Date(message.createdTimestamp)
            : new Date(now);
    const authorTag = message.author?.tag
        || message.author?.username
        || 'Unknown user';
    const attachments = message.attachments
        ? [...message.attachments.values()].map(attachment => ({
            name: attachment.name || 'attachment',
            url: attachment.url || '',
            size: Number(attachment.size) || 0,
            contentType: attachment.contentType || ''
        }))
        : [];

    return {
        guildId,
        messageId: message.id,
        channelId,
        authorId: message.author?.id || null,
        authorTag,
        content: typeof message.content === 'string' ? message.content : '',
        contentAvailable: !message.partial && typeof message.content === 'string',
        attachments,
        sentAt
    };
}

function buildDeletedMessageQuery(guildId, filters = {}, now = new Date()) {
    const query = {
        guildId,
        deletedAt: { $ne: null },
        expiresAt: { $gt: new Date(now) }
    };

    if (filters.userId) query.authorId = filters.userId;
    if (filters.channelId) query.channelId = filters.channelId;
    return query;
}

module.exports = {
    RETENTION_DAYS,
    RETENTION_MS,
    addRetention,
    createMessageSnapshot,
    buildDeletedMessageQuery
};
