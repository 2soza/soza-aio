const { Routes } = require('discord.js');

const IDLE_VOICE_STATUS = 'silence, add a track';
const MAX_VOICE_STATUS_LENGTH = 500;

async function setVoiceChannelStatus(client, guildId, status, channelId = null) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;

    const resolvedChannelId = channelId || guild.members.me?.voice?.channelId;
    if (!resolvedChannelId) return false;

    const voiceChannel = guild.channels.cache.get(resolvedChannelId)
        || await guild.channels.fetch(resolvedChannelId).catch(() => null);
    if (!voiceChannel?.isVoiceBased?.()) return false;

    const normalizedStatus = typeof status === 'string'
        ? status.trim().slice(0, MAX_VOICE_STATUS_LENGTH)
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

module.exports = {
    IDLE_VOICE_STATUS,
    setVoiceChannelStatus
};
