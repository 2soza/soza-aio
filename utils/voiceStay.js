const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { entersState, joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');
const VoicePresence = require('../models/voicePresence/VoicePresence');

const restoreJobs = new Map();
const restoreTimers = new Map();
const RESTORE_INTERVAL_MS = 60000;

function isSlashCommand(context) {
    return typeof context?.isChatInputCommand === 'function' && context.isChatInputCommand();
}

async function reply(context, content) {
    if (isSlashCommand(context)) {
        if (context.deferred || context.replied) {
            return context.editReply({ content });
        }
        return context.reply({ content, flags: MessageFlags.Ephemeral });
    }

    return context.reply({
        content,
        allowedMentions: { repliedUser: false }
    });
}

async function runCommand(context, action) {
    const slash = isSlashCommand(context);
    if (slash && !context.deferred && !context.replied) {
        await context.deferReply({ flags: MessageFlags.Ephemeral });
    }

    try {
        await reply(context, await action());
    } catch (error) {
        console.error('[VoiceStay] Command failed:', error?.message || error);
        await reply(context, `❌ ${error?.userMessage || error?.message || 'Perintah voice gagal dijalankan.'}`)
            .catch(() => {});
    }
}

function getGuild(context) {
    return context.guild || null;
}

async function getActor(context) {
    const guild = getGuild(context);
    const userId = context.user?.id || context.author?.id;
    if (context.member?.voice) return context.member;
    return guild?.members?.cache?.get(userId)
        || await guild?.members?.fetch(userId).catch(() => null)
        || null;
}

function hasManageGuildPermission(context, member) {
    return Boolean(
        context.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
        member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    );
}

async function getBotMember(guild) {
    return guild.members.me || guild.members.fetchMe();
}

function getVoiceOnlyConnections(client) {
    if (!(client.__voiceOnlyConnections instanceof Map)) {
        client.__voiceOnlyConnections = new Map();
    }
    return client.__voiceOnlyConnections;
}

function getVoiceOnlyConnection(client, guildId) {
    return getVoiceOnlyConnections(client).get(guildId) || null;
}

async function assertVoiceConnectPermission(guild, voiceChannel) {
    const botMember = await getBotMember(guild);
    const permissions = voiceChannel.permissionsFor(botMember);
    const missingPermissions = [
        [PermissionFlagsBits.ViewChannel, 'View Channel'],
        [PermissionFlagsBits.Connect, 'Connect']
    ]
        .filter(([permission]) => !permissions?.has(permission))
        .map(([, name]) => name);

    if (missingPermissions.length) {
        throw new Error(`Bot perlu izin ${missingPermissions.join(' dan ')} di voice channel tersebut.`);
    }
    return botMember;
}

async function connectVoiceOnly(client, guild, voiceChannel) {
    const botMember = await assertVoiceConnectPermission(guild, voiceChannel);
    const existing = client.riffy?.players.get(guild.id);
    const currentBotChannelId = botMember.voice.channelId;

    if (currentBotChannelId && currentBotChannelId !== voiceChannel.id) {
        throw new Error('Bot sedang berada di voice channel lain. Minta bot leave dahulu.');
    }

    if (existing?.connected && existing.voiceChannel === voiceChannel.id) {
        return { alreadyConnected: true };
    }

    const connections = getVoiceOnlyConnections(client);
    const currentConnection = connections.get(guild.id);
    if (
        currentConnection?.state.status === VoiceConnectionStatus.Ready &&
        currentConnection.joinConfig.channelId === voiceChannel.id
    ) {
        return { alreadyConnected: true };
    }

    if (currentConnection) {
        connections.delete(guild.id);
        currentConnection.destroy();
    }

    if (existing) {
        existing.__voiceStayRecoveryDestroy = true;
        try {
            await existing.destroy().catch(() => {});
        } finally {
            existing.__voiceStayRecoveryDestroy = false;
        }
    }

    let connection;
    try {
        if (!guild.voiceAdapterCreator) {
            throw new Error('Discord voice adapter tidak tersedia untuk server ini.');
        }

        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true
        });
        connections.set(guild.id, connection);
        connection.on('error', error => {
            console.error(`[VoiceStay] Discord voice connection error in guild ${guild.id}:`, error.message || error);
        });
        await entersState(connection, VoiceConnectionStatus.Ready, 30000);
        return { connection, alreadyConnected: false };
    } catch (error) {
        const connectionStatus = connection?.state?.status || 'not-created';
        if (connection && connections.get(guild.id) === connection) {
            connections.delete(guild.id);
        }
        connection?.destroy();
        console.error(`[VoiceStay] Could not join voice in guild ${guild.id}:`, {
            name: error?.name,
            code: error?.code,
            message: error?.message || String(error),
            connectionStatus
        });
        throw new Error(
            'Gagal terhubung ke voice Discord. Pastikan bot memiliki izin View Channel dan Connect, lalu cek Railway Console untuk detail kegagalan.'
        );
    }
}

function releaseVoiceOnlyConnection(client, guildId) {
    const connections = getVoiceOnlyConnections(client);
    const connection = connections.get(guildId);
    if (!connection) return false;

    connections.delete(guildId);
    connection.destroy();
    return true;
}

async function joinFromContext(context, client) {
    const guild = getGuild(context);
    const member = await getActor(context);
    const voiceChannel = member?.voice?.channel;

    if (!guild || !member) throw new Error('Perintah ini hanya bisa dipakai di server.');
    if (!voiceChannel) throw new Error('Masuk ke voice channel terlebih dahulu.');

    const pinnedPresence = await VoicePresence.findOne({
        guildId: guild.id,
        enabled: true,
        mode247: true
    }).lean();
    if (pinnedPresence && pinnedPresence.channelId !== voiceChannel.id) {
        throw new Error(`Mode 24/7 sedang dikunci ke <#${pinnedPresence.channelId}>.`);
    }

    const result = await connectVoiceOnly(client, guild, voiceChannel);
    return result.alreadyConnected
        ? `✅ Bot sudah berada di <#${voiceChannel.id}>. Tidak ada lagu yang diputar.`
        : `✅ Bot bergabung ke <#${voiceChannel.id}> tanpa memutar lagu.`;
}

async function leaveFromContext(context, client) {
    const guild = getGuild(context);
    const member = await getActor(context);
    if (!guild || !member) throw new Error('Perintah ini hanya bisa dipakai di server.');

    const player = client.riffy?.players.get(guild.id);
    const voiceOnlyConnection = getVoiceOnlyConnection(client, guild.id);
    const botVoiceChannelId = guild.members.me?.voice?.channelId
        || voiceOnlyConnection?.joinConfig?.channelId
        || (player?.connected ? player.voiceChannel : null);
    if (!botVoiceChannelId) throw new Error('Bot tidak sedang berada di voice channel.');

    const actorVoiceChannelId = member.voice?.channelId;
    if (
        actorVoiceChannelId !== botVoiceChannelId &&
        !hasManageGuildPermission(context, member)
    ) {
        throw new Error('Masuk ke voice channel bot terlebih dahulu untuk menggunakan leave.');
    }

    if (player) await player.destroy().catch(() => {});
    releaseVoiceOnlyConnection(client, guild.id);

    const keepAlive = await VoicePresence.exists({
        guildId: guild.id,
        enabled: true,
        mode247: true
    });
    if (keepAlive) schedule247Restore(client, guild.id, 5000);
    return keepAlive
        ? '👋 Bot keluar sebentar. Mode 24/7 masih aktif, jadi bot akan mencoba bergabung kembali. Gunakan `/247 action:disable` atau `.247 disable` untuk mematikan mode 24/7.'
        : '👋 Bot sudah keluar dari voice channel.';
}

async function set247FromContext(context, args, client) {
    const guild = getGuild(context);
    const member = await getActor(context);
    if (!guild || !member) throw new Error('Perintah ini hanya bisa dipakai di server.');
    if (!hasManageGuildPermission(context, member)) {
        throw new Error('Hanya Admin atau anggota dengan izin Manage Server yang dapat mengubah mode 24/7.');
    }

    const action = isSlashCommand(context)
        ? context.options.getString('action')
        : String(args?.[0] || '').toLowerCase();

    if (!['enable', 'disable'].includes(action)) {
        throw new Error('Gunakan `/247 action:enable` atau `/247 action:disable` (prefix: `.247 enable` / `.247 disable`).');
    }

    if (action === 'disable') {
        await VoicePresence.deleteOne({ guildId: guild.id, mode247: true });
        const pendingRestore = restoreTimers.get(guild.id);
        if (pendingRestore) clearTimeout(pendingRestore);
        restoreTimers.delete(guild.id);
        return '✅ Mode 24/7 dimatikan. Bot tetap di voice saat ini; gunakan `/leave` atau `.leave` jika ingin keluar.';
    }

    const player = client.riffy?.players.get(guild.id);
    const voiceOnlyConnection = getVoiceOnlyConnection(client, guild.id);
    const botMember = await getBotMember(guild);
    const currentChannelId = botMember.voice?.channelId
        || (voiceOnlyConnection?.state.status === VoiceConnectionStatus.Ready
            ? voiceOnlyConnection.joinConfig.channelId
            : null)
        || (player?.connected ? player.voiceChannel : null);
    const isConnected = Boolean(
        (voiceOnlyConnection?.state.status === VoiceConnectionStatus.Ready &&
            voiceOnlyConnection.joinConfig.channelId === currentChannelId) ||
        (player?.connected && player.voiceChannel === currentChannelId)
    );
    if (!isConnected || !currentChannelId) {
        throw new Error('Bot harus sudah berada di voice lewat `/join` atau perintah musik. `/247` hanya mengatur mode dan tidak menghubungkan bot.');
    }

    const voiceChannel = guild.channels.cache.get(currentChannelId)
        || await guild.channels.fetch(currentChannelId).catch(() => null);
    if (!voiceChannel?.isVoiceBased?.()) {
        throw new Error('Voice channel bot tidak ditemukan. Gunakan `/join` untuk menyambungkan bot kembali.');
    }
    await assertVoiceConnectPermission(guild, voiceChannel);

    await VoicePresence.findOneAndUpdate(
        { guildId: guild.id },
        {
            $set: {
                guildId: guild.id,
                channelId: voiceChannel.id,
                textChannelId: context.channel.id,
                enabled: true,
                mode247: true,
                requestedBy: member.id
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return `✅ Mode 24/7 aktif untuk <#${voiceChannel.id}>. Bot tetap di sana dan akan mencoba tersambung kembali jika terputus.`;
}

async function restore247Guild(client, guildId) {
    if (restoreJobs.has(guildId)) return restoreJobs.get(guildId);

    const job = Promise.resolve().then(async () => {
        const presence = await VoicePresence.findOne({
            guildId,
            enabled: true,
            mode247: true
        }).lean();
        if (!presence || !client.user) return false;

        const guild = client.guilds.cache.get(guildId)
            || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return false;

        const voiceChannel = guild.channels.cache.get(presence.channelId)
            || await guild.channels.fetch(presence.channelId).catch(() => null);
        if (!voiceChannel?.isVoiceBased?.()) {
            console.warn(`[VoiceStay] Saved 24/7 voice channel is unavailable in guild ${guildId}.`);
            return false;
        }

        const botMember = await getBotMember(guild).catch(() => null);
        if (!botMember) return false;
        const existing = client.riffy?.players.get(guildId);
        const voiceOnlyConnection = getVoiceOnlyConnection(client, guildId);
        if (
            voiceOnlyConnection?.state.status === VoiceConnectionStatus.Ready &&
            voiceOnlyConnection.joinConfig.channelId === voiceChannel.id
        ) {
            return true;
        }
        if (existing?.connected && existing.voiceChannel === voiceChannel.id) return true;
        if (
            (botMember.voice?.channelId && botMember.voice.channelId !== voiceChannel.id) ||
            (existing?.connected && existing.voiceChannel !== voiceChannel.id)
        ) {
            console.warn(`[VoiceStay] Bot is already connected to a different voice channel in guild ${guildId}.`);
            return false;
        }

        // A disable or channel change may happen while the restore job is
        // fetching guild/channel data. Recheck the persisted intent before
        // touching the active player or requesting a new voice connection.
        const stillEnabled = await VoicePresence.exists({
            guildId,
            channelId: presence.channelId,
            enabled: true,
            mode247: true
        });
        if (!stillEnabled) return false;

        if (existing) {
            existing.__voiceStayRecoveryDestroy = true;
            try {
                await existing.destroy().catch(() => {});
            } finally {
                existing.__voiceStayRecoveryDestroy = false;
            }
        }

        const stillEnabledBeforeJoin = await VoicePresence.exists({
            guildId,
            channelId: presence.channelId,
            enabled: true,
            mode247: true
        });
        if (!stillEnabledBeforeJoin) return false;

        try {
            await connectVoiceOnly(client, guild, voiceChannel);
            console.log(`[VoiceStay] Restored 24/7 voice connection for guild ${guildId}.`);
            return true;
        } catch (error) {
            console.warn(`[VoiceStay] 24/7 reconnect failed for guild ${guildId}:`, error.message);
            return false;
        }
    });

    restoreJobs.set(guildId, job);
    try {
        return await job;
    } finally {
        if (restoreJobs.get(guildId) === job) restoreJobs.delete(guildId);
    }
}

async function restoreAll247(client) {
    try {
        const presences = await VoicePresence.find({
            enabled: true,
            mode247: true
        }).select('guildId').lean();
        for (const presence of presences) {
            const restored = await restore247Guild(client, presence.guildId);
            if (!restored) schedule247Restore(client, presence.guildId, 5000);
        }
    } catch (error) {
        console.error('[VoiceStay] Could not load saved 24/7 sessions:', error.message || error);
    }
}

function schedule247Restore(client, guildId, delayMs = 3000) {
    if (restoreTimers.has(guildId)) return;

    const timer = setTimeout(() => {
        restoreTimers.delete(guildId);
        restore247Guild(client, guildId).catch(error => {
            console.error(`[VoiceStay] Scheduled reconnect failed for guild ${guildId}:`, error.message || error);
        });
    }, delayMs);
    timer.unref?.();
    restoreTimers.set(guildId, timer);
}

function start247Monitoring(client) {
    if (client.__voiceStayMonitoring) return;
    client.__voiceStayMonitoring = true;

    client.riffy?.on('nodeConnect', () => {
        restoreAll247(client);
    });

    client.riffy?.on('playerDestroy', player => {
        if (player?.guildId && !player.__voiceStayRecoveryDestroy) {
            schedule247Restore(client, player.guildId, 5000);
        }
    });

    client.on('voiceStateUpdate', async (oldState, newState) => {
        if (newState.id !== client.user?.id) return;

        try {
            const presence = await VoicePresence.findOne({
                guildId: newState.guild.id,
                enabled: true,
                mode247: true
            });
            if (!presence) return;

            if (newState.channelId) {
                if (presence.channelId !== newState.channelId) {
                    presence.channelId = newState.channelId;
                    await presence.save();
                }
            } else if (oldState.channelId) {
                schedule247Restore(client, newState.guild.id, 5000);
            }
        } catch (error) {
            console.error('[VoiceStay] Failed to process 24/7 voice state:', error.message || error);
        }
    });

    restoreAll247(client);
    const interval = setInterval(() => restoreAll247(client), RESTORE_INTERVAL_MS);
    interval.unref?.();
}

module.exports = {
    runCommand,
    joinFromContext,
    leaveFromContext,
    set247FromContext,
    releaseVoiceOnlyConnection,
    start247Monitoring,
    restoreAll247,
    schedule247Restore
};
