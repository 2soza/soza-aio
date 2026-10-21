const { Routes } = require('discord.js');

const IDLE_VOICE_STATUS = 'silence, add a track';
const MAX_VOICE_STATUS_LENGTH = 500;
const VOICE_STATUS_EMOJI = '<a:soza:1562256028320399531>';

const statusQueues = new Map();

async function setVoiceChannelStatus(client, guildId, status, channelId = null) {
    let queue = statusQueues.get(guildId);
    if (!queue) {
        queue = { revision: 0, pending: Promise.resolve() };
        statusQueues.set(guildId, queue);
    }

    const revision = ++queue.revision;
    const update = queue.pending.catch(() => false).then(async () => {
        if (queue.revision !== revision) return false;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return false;

        const resolvedChannelId = channelId || guild.members.me?.voice?.channelId;
        if (!resolvedChannelId) return false;

        const voiceChannel = guild.channels.cache.get(resolvedChannelId)
            || await guild.channels.fetch(resolvedChannelId).catch(() => null);
        if (!voiceChannel?.isVoiceBased?.() || queue.revision !== revision) return false;

        let text = typeof status === 'string' ? status.trim() : '';
        const currentInfo = client.riffy?.players?.get?.(guildId)?.current?.info;
        if (text && currentInfo && text === String(currentInfo.title || '').trim()) {
            text = formatTrackStatus(currentInfo);
        }
        const normalizedStatus = text
            ? `${VOICE_STATUS_EMOJI} ${text}`.slice(0, MAX_VOICE_STATUS_LENGTH)
            : '';

        try {
            await client.rest.put(Routes.channelVoiceStatus(voiceChannel.id), {
                body: { status: normalizedStatus }
            });
            return true;
        } catch (error) {
            console.warn(
                `[VoiceStatus] Could not update channel status in guild ${guildId}:`,
                error?.message || error
            );
            return false;
        }
    });
    queue.pending = update;

    try {
        return await update;
    } finally {
        if (statusQueues.get(guildId) === queue && queue.pending === update) {
            statusQueues.delete(guildId);
        }
    }
}

const NOISE_WORDS = /\b(official|lyrics?|lyric video|video|audio|music video|mv|m\/v|visuali[sz]er|hd|hq|4k|remaster(ed)?|explicit|clean|color coded|full album|live)\b/i;

function cleanTitle(title) {
    let text = title
        .replace(/\s*[([【][^)\]】]*[)\]】]/g, match => (NOISE_WORDS.test(match) ? '' : match))
        .replace(/\s*[|｜].*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    return text || title;
}

function cleanAuthor(author) {
    return author.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
}

function formatTrackStatus(info) {
    const rawTitle = typeof info?.title === 'string' ? info.title.trim() : '';
    const author = cleanAuthor(typeof info?.author === 'string' ? info.author.trim() : '');
    if (!rawTitle) return IDLE_VOICE_STATUS;
    let title = cleanTitle(rawTitle, author);
    const squash = value => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const dash = title.indexOf(' - ');
    let artist = author;
    if (dash > 0 && author && squash(title.slice(0, dash)) === squash(author)) {
        artist = title.slice(0, dash).trim();
        title = title.slice(dash + 3).trim();
    }
    return artist ? `${title} - ${artist}` : title;
}

module.exports = {
    IDLE_VOICE_STATUS,
    VOICE_STATUS_EMOJI,
    formatTrackStatus,
    setVoiceChannelStatus
};
