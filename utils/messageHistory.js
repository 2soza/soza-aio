const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_ATTACHMENT_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const DISCORD_ATTACHMENT_HOSTS = new Set([
    'cdn.discordapp.com',
    'media.discordapp.net'
]);

async function fetchAttachmentBuffer(attachment, maxBytes = MAX_ATTACHMENT_DOWNLOAD_BYTES) {
    let url;
    try {
        url = new URL(attachment?.url);
    } catch {
        return null;
    }

    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        !DISCORD_ATTACHMENT_HOSTS.has(url.hostname) ||
        !url.pathname.includes('/attachments/')
    ) {
        return null;
    }

    const limit = Math.min(Number(maxBytes) || 0, MAX_ATTACHMENT_DOWNLOAD_BYTES);
    if (limit <= 0) return null;

    try {
        const response = await fetch(url, {
            redirect: 'error',
            signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok || !response.body) return null;

        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > limit) {
            await response.body.cancel().catch(() => {});
            return null;
        }

        const reader = response.body.getReader();
        const chunks = [];
        let byteLength = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                byteLength += value.byteLength;
                if (byteLength > limit) {
                    await reader.cancel().catch(() => {});
                    return null;
                }
                chunks.push(Buffer.from(value));
            }
        } finally {
            reader.releaseLock();
        }

        return byteLength ? Buffer.concat(chunks, byteLength) : null;
    } catch {
        return null;
    }
}

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
    MAX_ATTACHMENT_DOWNLOAD_BYTES,
    addRetention,
    createMessageSnapshot,
    buildDeletedMessageQuery,
    fetchAttachmentBuffer
};
