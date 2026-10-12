const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const VoicePresence = require('../models/voicePresence/VoicePresence');

const restoreJobs = new Map();
const RESTORE_INTERVAL_MS = 30000;

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

function hasConnectedLavalinkNode(client) {
    return [...(client.riffy?.nodeMap?.values() || [])].some(node => node?.connected);
}

async function getBotMember(guild) {
    return guild.members.me || guild.members.fetchMe();
}

async function assertVoicePermissions(guild, voiceChannel) {
    const botMember = await getBotMember(guild);
    const permissions = voiceChannel.permissionsFor(botMember);
    if (
        !permissions?.has(PermissionFlagsBits.Connect) ||
        !permissions.has(PermissionFlagsBits.Speak)
    ) {
        throw new Error('Bot perlu izin Connect dan Speak di voice channel tersebut.');
    }
    return botMember;
}

async function createVoicePlayer(client, guild, voiceChannel, textChannelId) {
    if (!client.riffy) {
        throw new Error('Sistem musik Lavalink belum siap.');
    }
    if (!hasConnectedLavalinkNode(client)) {
        throw new Error('Tidak ada node Lavalink yang sedang terhubung.');
    }

    const botMember = await assertVoicePermissions(guild, voiceChannel);
    const existing = client.riffy.players.get(guild.id);
    const currentBotChannelId = botMember.voice.channelId;
    if (currentBotChannelId && currentBotChannelId !== voiceChannel.id) {
        throw new Error('Bot sedang berada di voice channel lain. Minta bot leave dahulu.');
    }

    if (existing?.connected && currentBotChannelId) {
        if (currentBotChannelId === voiceChannel.id && existing.voiceChannel === voiceChannel.id) {
            return { player: existing, alreadyConnected: true };
        }
        throw new Error('Bot sedang berada di voice channel lain. Minta bot leave dahulu.');
    }

    if (existing) {
        await existing.destroy().catch(() => {});
    }

    try {
        const player = await client.riffy.createConnection({
            guildId: guild.id,
            voiceChannel: voiceChannel.id,
            textChannel: textChannelId,
            deaf: true
        });
        return { player, alreadyConnected: false };
    } catch (error) {
        console.error(`[VoiceStay] Could not join voice in guild ${guild.id}:`, error?.message || error);
        throw new Error('Gagal terhubung ke voice. Periksa node Lavalink dan izin Connect/Speak bot.');
    }
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

    const result = await createVoicePlayer(client, guild, voiceChannel, context.channel.id);
    return result.alreadyConnected
        ? `✅ Bot sudah berada di <#${voiceChannel.id}>. Tidak ada lagu yang diputar.`
        : `✅ Bot bergabung ke <#${voiceChannel.id}> tanpa memutar lagu.`;
}

async function leaveFromContext(context, client) {
    const guild = getGuild(context);
    const member = await getActor(context);
    if (!guild || !member) throw new Error('Perintah ini hanya bisa dipakai di server.');

    const player = client.riffy?.players.get(guild.id);
    const botVoiceChannelId = guild.members.me?.voice?.channelId
        || (player?.connected ? player.voiceChannel : null);
    if (!botVoiceChannelId) throw new Error('Bot tidak sedang berada di voice channel.');

    const actorVoiceChannelId = member.voice?.channelId;
    if (
        actorVoiceChannelId !== botVoiceChannelId &&
        !hasManageGuildPermission(context, member)
    ) {
        throw new Error('Masuk ke voice channel bot terlebih dahulu untuk menggunakan leave.');
    }

    if (player) await player.destroy();

    const keepAlive = await VoicePresence.exists({
        guildId: guild.id,
        enabled: true,
        mode247: true
    });
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
        return '✅ Mode 24/7 dimatikan. Bot tidak akan bergabung kembali otomatis; gunakan `/leave` atau `.leave` jika ingin langsung keluar.';
    }

    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) throw new Error('Masuk ke voice channel yang ingin dipakai terlebih dahulu.');
    await assertVoicePermissions(guild, voiceChannel);

    const currentChannelId = guild.members.me?.voice?.channelId;
    if (currentChannelId && currentChannelId !== voiceChannel.id) {
        throw new Error('Bot sedang berada di voice channel lain. Pindahkan atau keluarkan bot dahulu.');
    }

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

    try {
        const result = await createVoicePlayer(client, guild, voiceChannel, context.channel.id);
        return result.alreadyConnected
            ? `✅ Mode 24/7 aktif. Bot akan tetap di <#${voiceChannel.id}> tanpa memutar lagu.`
            : `✅ Mode 24/7 aktif. Bot bergabung ke <#${voiceChannel.id}> tanpa memutar lagu dan akan mencoba kembali jika terputus.`;
    } catch (error) {
        console.warn(`[VoiceStay] 24/7 saved; connection will retry for guild ${guild.id}:`, error.message);
        schedule247Restore(client, guild.id, 5000);
        return `✅ Mode 24/7 tersimpan untuk <#${voiceChannel.id}>. Bot belum berhasil masuk sekarang, tetapi akan mencoba kembali otomatis.`;
    }
}

async function restore247Guild(client, guildId) {
    if (restoreJobs.has(guildId)) return restoreJobs.get(guildId);

    const job = Promise.resolve().then(async () => {
        const presence = await VoicePresence.findOne({
            guildId,
            enabled: true,
            mode247: true
        }).lean();
        if (!presence || !client.riffy || !hasConnectedLavalinkNode(client)) return false;

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
        const textChannel = guild.channels.cache.get(presence.textChannelId)
            || guild.systemChannel
            || guild.channels.cache.find(channel =>
                channel.isTextBased?.() &&
                channel.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages)
            );
        if (!textChannel) {
            console.warn(`[VoiceStay] No usable text channel for 24/7 recovery in guild ${guildId}.`);
            return false;
        }

        const existing = client.riffy.players.get(guildId);
        if (
            existing?.connected &&
            existing.voiceChannel === voiceChannel.id &&
            guild.members.me?.voice?.channelId === voiceChannel.id &&
            existing.node?.connected
        ) {
            return true;
        }

        if (existing) await existing.destroy().catch(() => {});

        try {
            await createVoicePlayer(client, guild, voiceChannel, textChannel.id);
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
            await restore247Guild(client, presence.guildId);
        }
    } catch (error) {
        console.error('[VoiceStay] Could not load saved 24/7 sessions:', error.message || error);
    }
}

function schedule247Restore(client, guildId, delayMs = 3000) {
    const timer = setTimeout(() => {
        restore247Guild(client, guildId).catch(error => {
            console.error(`[VoiceStay] Scheduled reconnect failed for guild ${guildId}:`, error.message || error);
        });
    }, delayMs);
    timer.unref?.();
}

function start247Monitoring(client) {
    if (client.__voiceStayMonitoring || !client.riffy) return;
    client.__voiceStayMonitoring = true;

    client.riffy.on('nodeConnect', () => {
        restoreAll247(client);
    });

    client.riffy.on('playerDestroy', player => {
        if (player?.guildId) schedule247Restore(client, player.guildId, 5000);
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

    const interval = setInterval(() => restoreAll247(client), RESTORE_INTERVAL_MS);
    interval.unref?.();
}

module.exports = {
    runCommand,
    joinFromContext,
    leaveFromContext,
    set247FromContext,
    start247Monitoring,
    restoreAll247,
    schedule247Restore
};
