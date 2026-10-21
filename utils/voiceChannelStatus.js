const { Routes } = require('discord.js');

const IDLE_VOICE_STATUS = '𝘀𝗶𝗹𝗲𝗻𝗰𝗲, 𝗮𝗱𝗱 𝗮 𝘁𝗿𝗮𝗰𝗸';
const MAX_VOICE_STATUS_LENGTH = 500;
const VOICE_STATUS_EMOJI = '<a:soza:1562256028320399531>';

async function setVoiceChannelStatus(client, guildId, status, channelId = null) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;

    const resolvedChannelId = channelId || guild.members.me?.voice?.channelId;
    if (!resolvedChannelId) return false;

    const voiceChannel = guild.channels.cache.get(resolvedChannelId)
        || await guild.channels.fetch(resolvedChannelId).catch(() => null);
    if (!voiceChannel?.isVoiceBased?.()) return false;

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
