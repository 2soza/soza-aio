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
        } else if (text) {
            text = cleanTitle(text);
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

function cleanTitle(title) {
    let text = title;
    // Remove innermost groups first, including nested parentheses/brackets.
    let previous;
    do {
        previous = text;
        text = text.replace(/\([^()]*\)|\[[^\[\]]*\]/g, ' ');
    } while (text !== previous);
    return text
        .replace(/\s*[|｜].*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatTrackStatus(info) {
    const rawTitle = typeof info?.title === 'string' ? info.title.trim() : '';
    if (!rawTitle) return IDLE_VOICE_STATUS;
    return cleanTitle(rawTitle) || IDLE_VOICE_STATUS;
}

module.exports = {
    IDLE_VOICE_STATUS,
    VOICE_STATUS_EMOJI,
    formatTrackStatus,
    setVoiceChannelStatus
};
