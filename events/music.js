const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder, ThumbnailBuilder, MessageFlags, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const lavalinkConfig = require('../lavalink');
const { dynamicCard } = require("../UI/dynamicCard");
const path = require("path");
const axios = require('axios');
const musicIcons = require('../UI/icons/musicicons');
const { Riffy } = require('riffy');
const { autoplayCollection } = require('../mongodb');
const { runSafeAutoplay } = require('../utils/safeAutoplay');
const VoicePresence = require('../models/voicePresence/VoicePresence');
const { start247Monitoring } = require('../utils/voiceStay');
const { IDLE_VOICE_STATUS, setVoiceChannelStatus } = require('../utils/voiceChannelStatus');
const { fetchSyncedLyrics, parseSyncedLyrics, getCurrentLineIndex } = require('../utils/lyrics');


const lyricsStateManager = {
    activeGuilds: new Map(), 
    stoppedGuilds: new Set(), 
    collectors: new Map(),   
    
    startLyrics(guildId, data) {
        this.activeGuilds.set(guildId, { ...data, timestamp: Date.now() });
        this.stoppedGuilds.delete(guildId); 
        console.log(`✅ Lyrics STATE: STARTED for guild ${guildId}`);
    },
    
    stopLyrics(guildId, permanent = false) {
        this.activeGuilds.delete(guildId);
        if (permanent) {
            this.stoppedGuilds.add(guildId);
        }
        
        if (this.collectors.has(guildId)) {
            this.collectors.get(guildId).stop('manual_stop');
            this.collectors.delete(guildId);
        }
        
    },
    
    isActive(guildId) {
        return this.activeGuilds.has(guildId);
    },
    
    isManuallyStopped(guildId) {
        return this.stoppedGuilds.has(guildId);
    },
    
    clearGuild(guildId) {
        this.activeGuilds.delete(guildId);
        this.stoppedGuilds.delete(guildId);
        if (this.collectors.has(guildId)) {
            this.collectors.get(guildId).stop('cleanup');
            this.collectors.delete(guildId);
        }
       // console.log(`🧹 Lyrics STATE: CLEARED for guild ${guildId}`);
    },
    
    setCollector(guildId, collector) {
        this.collectors.set(guildId, collector);
    }
};

const advancedMessageManager = {
    trackMessages: new Map(),
    lyricsMessages: new Map(),
    queueMessages: new Map(),
    lastEmbeds: new Map(),
    controlPanels: new Map(),
    cleanupTimeouts: new Map(),

    getAutoDeleteTime: function (type, context = {}) {
        const times = {
            'track': 0,              // Keep now-playing visible until an explicit stop
            'lyrics': 0,            // Manual control only
            'queue': 45000,         // 45 seconds (quick reference)
            'control': 300000,      // 5 minutes (interactive controls)
            'success': 3000,        // 3 seconds (quick confirmations)
            'error': 3000,          // 3 seconds (errors need more time)
            'warning': 3000,        // 3 seconds (warnings)
            'info': 3000,           // 3 seconds (information)
            'session_end': 3000,    // 3 seconds for session end
            'autoplay': 3000,       // 3 seconds for autoplay
            'autoplay_success': 3000, // 3 seconds for autoplay success
            'autoplay_fail': 3000,  // 3 seconds for autoplay fail
            'volume': 3000,         // 3 seconds (volume changes)
            'pause_resume': 5000,   // 5 seconds (playback controls)
            'skip': 3000,           // 3 seconds (skip confirmations)
            'stop': 3000,           // 3 seconds for stop messages
            'loop': 3000,           // 3 seconds (loop mode changes)
            'shuffle': 3000,        // 3 seconds (shuffle confirmations)
            'queue_cleared': 3000   // 3 seconds (queue modifications)
        };

        if (context.isImportant) return times[type] * 1.5;
        if (context.isQuick) return Math.max(times[type] * 0.5, 3000);
        if (context.queueSize && context.queueSize > 10) return times[type] * 1.2;

        return times[type] || 3000;
    },

    addMessage: function (guildId, messageId, channelId, type, context = {}) {
        const autoDeleteTime = this.getAutoDeleteTime(type, context);
        const messageData = {
            messageId,
            channelId,
            type,
            timestamp: Date.now(),
            autoDelete: autoDeleteTime,
            context
        };

        const collections = {
            'track': this.trackMessages,
            'lyrics': this.lyricsMessages,
            'queue': this.queueMessages,
            'lastEmbed': this.lastEmbeds,
            'control': this.controlPanels
        };

        if (collections[type]) {
            collections[type].set(guildId, messageData);

            if (autoDeleteTime > 0) {
                const timeoutId = setTimeout(async () => {
                    await this.deleteMessage(null, messageData);
                    collections[type].delete(guildId);
                    this.cleanupTimeouts.delete(guildId + '_' + type);
                }, autoDeleteTime);

                this.cleanupTimeouts.set(guildId + '_' + type, timeoutId);
            }
        }
    },

    addQuickDeleteMessage: function (client, message, type = 'info') {
        if (!message || !message.id) return;
        setTimeout(() => {
            message.delete().catch(() => { });
        }, 3000);
        return message;
    },

    async cleanupGuildMessages(client, guildId, types = ['track', 'lyrics', 'queue', 'lastEmbed', 'control']) {
        const promises = [];
        const collections = {
            'track': this.trackMessages,
            'lyrics': this.lyricsMessages,
            'queue': this.queueMessages,
            'lastEmbed': this.lastEmbeds,
            'control': this.controlPanels
        };

        for (const type of types) {
            if (collections[type] && collections[type].has(guildId)) {
                const msgData = collections[type].get(guildId);
                promises.push(this.deleteMessage(client, msgData));
                collections[type].delete(guildId);

                const timeoutKey = guildId + '_' + type;
                if (this.cleanupTimeouts.has(timeoutKey)) {
                    clearTimeout(this.cleanupTimeouts.get(timeoutKey));
                    this.cleanupTimeouts.delete(timeoutKey);
                }
            }
        }

        await Promise.allSettled(promises);
    },

    async deleteMessage(client, messageData) {
        if (!messageData) return;

        const { messageId, channelId } = messageData;

        try {
            const channel = client ? client.channels.cache.get(channelId) : null;
            if (!channel) return;

            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (!message) return;

            await message.delete().catch(() => {
                if (message.components && message.components.length > 0) {
                    const disabledComponents = message.components.map(row =>
                        new ActionRowBuilder().addComponents(
                            row.components.map(component =>
                                ButtonBuilder.from(component).setDisabled(true)
                            )
                        )
                    );
                    message.edit({ components: disabledComponents }).catch(() => { });
                }
            });
        } catch (err) {
            console.warn(`V2 Message cleanup warning: ${err.message}`);
        }
    },

    createV2Container(type, data = {}) {
        const colors = {
            success: 0x00ff7f,
            error: 0xff4757,
            info: 0x3498db,
            warning: 0xffa500,
            music: 0xdc92ff,
            lyrics: 0xff69b4,
            queue: 0x9b59b6,
            session_end: 0x95a5a6,
            volume: 0x2196f3,
            autoplay: 0x17a2b8
        };

        return new ContainerBuilder()
            .setAccentColor(colors[type] || colors.info);
    }
};

const sessionManager = {
    activeSessions: new Map(),

    createSession(guildId, userId, data) {
        this.activeSessions.set(guildId, {
            userId,
            startTime: Date.now(),
            lastActivity: Date.now(),
            ...data
        });
    },

    updateActivity(guildId) {
        if (this.activeSessions.has(guildId)) {
            this.activeSessions.get(guildId).lastActivity = Date.now();
        }
    },

    isAuthorized(guildId, userId) {
        const session = this.activeSessions.get(guildId);
        return !session || session.userId === userId;
    },

    endSession(guildId) {
        this.activeSessions.delete(guildId);
    }
};

const lyricIntervals = new Map();
const queueDisplayTimeouts = new Map();

module.exports = (client) => {
    const stuckTrackRetries = new WeakSet();
    const trackErrorRetries = new WeakSet();

    const migratePlayerForRecovery = async (player, reason) => {
        const currentNode = player?.node;
        if (!client.riffy || !player || !currentNode) return false;

        const availableNodes = [...(client.riffy.nodeMap?.values() || [])].filter((node) => (
            node &&
            node !== currentNode &&
            node.connected
        ));

        if (availableNodes.length === 0) {
            console.warn(`[V2 LAVALINK] No alternate connected node is available for guild ${player.guildId}`);
            return false;
        }

        try {
            await client.riffy.migrate(player);
            console.warn(
                `[V2 LAVALINK] Migrated guild ${player.guildId} from ${currentNode.name} to ${player.node.name} after ${reason}`
            );
            return player.node !== currentNode;
        } catch (migrationError) {
            console.error(
                `[V2 LAVALINK] Could not migrate guild ${player.guildId} after ${reason}:`,
                migrationError.message
            );
            return false;
        }
    };

    // Expose the shared message manager to prefix music commands so they
    // can clean up now-playing panels before destroying the Riffy player.
    client.musicMessageManager = advancedMessageManager;

    if (lavalinkConfig.enabled) {
        const nodes = lavalinkConfig.lavalink.nodes || [
            {
                name: lavalinkConfig.lavalink.name,
                host: lavalinkConfig.lavalink.host,
                password: lavalinkConfig.lavalink.password,
                port: lavalinkConfig.lavalink.port,
                secure: lavalinkConfig.lavalink.secure
            }
        ];
        console.log(`[V2 LAVALINK] Node configuration source: ${lavalinkConfig.nodeSource || 'unknown'}.`);
        if (lavalinkConfig.nodeSource !== 'LAVALINK_NODES_JSON') {
            console.warn(
                `[V2 LAVALINK] LAVALINK_NODES_JSON was not used by this process; loaded nodes from ${lavalinkConfig.nodeSource || 'an unknown source'}. Check the active Railway service/environment variables and redeploy if you recently changed them.`
            );
        }
        console.log(
            `[V2 LAVALINK] Loaded ${nodes.length} node configuration(s): ` +
            nodes.map(node => `${node.name} (${node.host}:${node.port}, secure=${Boolean(node.secure)})`).join(' | ')
        );

        client.riffy = new Riffy(client, nodes, {
            send: (payload) => {
                const guild = client.guilds.cache.get(payload.d.guild_id);
                if (guild) guild.shard.send(payload);
            },
            defaultSearchPlatform: lavalinkConfig.lavalink.defaultSearchPlatform || "ytmsearch",
            restVersion: lavalinkConfig.lavalink.restVersion || "v4",
            // Public nodes occasionally stop responding without closing the
            // websocket. Keep retrying long enough for a temporary outage,
            // and let Lavalink resume sessions when the node returns.
            reconnectTimeout: 10000,
            reconnectTries: 12,
            autoResume: true,
            resumeTimeout: 60,
        });

        const nodeWatchdog = {
            timer: null,
            running: false,
            lastFailures: new Map()
        };

        const nodeKey = (node) => node?.name || `${node?.host}:${node?.port}`;
        const withNodeTimeout = (promise, timeoutMs) => {
            let timer;
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Node health check timed out after ${timeoutMs}ms`)), timeoutMs);
            });

            return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
        };

        const restartStaleNode = (node) => {
            if (!node || node.reconnectAttempt || !node.connected) return;

            console.warn(`[V2 LAVALINK] Restarting unresponsive node ${node.name}`);
            // Replace the stale websocket directly. Calling Riffy's
            // reconnect() here would add another close listener, which can
            // create duplicate reconnect timers when the old socket closes.
            node.ws?.removeAllListeners();
            node.ws?.close();
            node.ws = null;
            node.connected = false;
            node.reconnectAttempted = 1;
            node.connect();
        };

        const recoverLavalinkNodes = async () => {
            if (nodeWatchdog.running || !client.riffy?.initiated) return;
            nodeWatchdog.running = true;

            try {
                for (const configuredNode of nodes) {
                    const key = nodeKey(configuredNode);
                    let node = client.riffy.nodeMap?.get(key);

                    // Riffy's Node removes itself from nodeMap after its
                    // built-in reconnect attempts are exhausted. Recreate it
                    // from the original configuration instead of requiring a
                    // bot process restart.
                    if (!node) {
                        console.warn(`[V2 LAVALINK] Re-adding missing node ${key}`);
                        node = client.riffy.createNode(configuredNode);
                    }

                    if (!node.connected) {
                        // After Riffy's finite reconnect attempts are
                        // exhausted, the node may stay in nodeMap with a
                        // completed timer and no active websocket. Reset it
                        // so the watchdog can bring it back.
                        if (
                            node.reconnectAttempted >= node.reconnectTries ||
                            !node.ws
                        ) {
                            clearTimeout(node.reconnectAttempt);
                            node.reconnectAttempt = null;
                            node.reconnectAttempted = 1;
                            console.warn(`[V2 LAVALINK] Reconnecting disconnected node ${key}`);
                            node.connect();
                        }
                        continue;
                    }

                    try {
                        await withNodeTimeout(node.rest.getStats(), 8000);
                        nodeWatchdog.lastFailures.delete(key);
                    } catch (error) {
                        const failures = (nodeWatchdog.lastFailures.get(key) || 0) + 1;
                        nodeWatchdog.lastFailures.set(key, failures);
                        console.warn(
                            `[V2 LAVALINK] Health check failed for ${key} (${failures}/2): ${error.message}`
                        );

                        // Require two consecutive failures so a brief REST
                        // delay does not interrupt otherwise healthy music.
                        if (failures >= 2) {
                            nodeWatchdog.lastFailures.delete(key);
                            if (node.ws?.readyState === 1) {
                                console.warn(
                                    `[V2 LAVALINK] REST stats timed out twice for ${key}, but its websocket is still open; keeping it connected to avoid interrupting active playback.`
                                );
                                continue;
                            }
                            restartStaleNode(node);
                        }
                    }
                }
            } catch (error) {
                console.error('[V2 LAVALINK] Node recovery watchdog failed:', error.message);
            } finally {
                nodeWatchdog.running = false;
            }
        };

        // Run often enough to restore a node that Riffy removed after its
        // finite reconnect attempts, but not so often that public nodes are
        // needlessly polled.
        nodeWatchdog.timer = setInterval(recoverLavalinkNodes, 60000);
        nodeWatchdog.timer.unref?.();

        // Restore saved always-on voice sessions after node reconnects and player destruction.
        start247Monitoring(client);
        
        client.riffy.on('nodeConnect', (node) => {
            console.log(`\x1b[34m[ V2 LAVALINK ]\x1b[0m Node connected: \x1b[32m${node.name}\x1b[0m`);
        });

        client.riffy.on('nodeReconnect', (node) => {
            console.warn(`[V2 LAVALINK] Reconnecting node: ${node.name}`);
        });

        client.riffy.on('nodeDisconnect', (node, reason) => {
            console.warn(
                `[V2 LAVALINK] Node disconnected: ${node.name}`,
                reason?.reason || reason || ''
            );
        });

        client.riffy.on('nodeError', (node, error) => {
            console.error(
                `\x1b[31m[ V2 LAVALINK ]\x1b[0m Node \x1b[32m${node.name} (${node.host}:${node.port})\x1b[0m error:`,
                { code: error?.code, message: error?.message || String(error) }
            );
        });

        client.riffy.on('playerMigrated', (player, oldNode, newNode) => {
            console.log(
                `[V2 LAVALINK] Player ${player.guildId} migrated from ${oldNode.name} to ${newNode.name}`
            );
        });

        client.riffy.on('playerMigrationFailed', (player, error) => {
            console.error(
                `[V2 LAVALINK] Player migration failed for guild ${player.guildId}:`,
                error.message
            );
        });

        client.on('voiceStateUpdate', async (oldState, newState) => {
            try {
                if (oldState.member?.id === client.user.id && oldState.channelId && !newState.channelId) {
                    const player = client.riffy.players.get(oldState.guild.id);
                    if (player) {
                        await handlePlayerCleanup(client, oldState.guild.id, player, 'Bot disconnected');
                    }
                }

                if (
                    oldState.channelId &&
                    oldState.channelId === newState.guild.me?.voice?.channelId &&
                    newState.guild.channels.cache.get(oldState.channelId)?.members.size === 1 &&
                    newState.guild.channels.cache.get(oldState.channelId)?.members.has(client.user.id)
                ) {
                    const keep247 = await VoicePresence.exists({
                        guildId: oldState.guild.id,
                        channelId: oldState.channelId,
                        enabled: true,
                        mode247: true
                    });
                    if (keep247) return;

                    const player = client.riffy.players.get(oldState.guild.id);
                    if (player) {
                        await handlePlayerCleanup(client, oldState.guild.id, player, 'Channel empty - Auto disconnect');

                        const channel = client.channels.cache.get(player.textChannel);
                        if (channel) {
                            const disconnectContainer = advancedMessageManager.createV2Container('session_end')
                                .addTextDisplayComponents(
                                    textDisplay => textDisplay.setContent('**👋 AUTO DISCONNECT**\nLeft voice channel since everyone left.\n\n**Session ended automatically to save resources.**')
                                );

                            const msg = await channel.send({
                                components: [disconnectContainer],
                                flags: MessageFlags.IsComponentsV2
                            });

                            advancedMessageManager.addQuickDeleteMessage(client, msg, 'session_end');
                        }
                    }
                }
            } catch (error) {
                console.error('V2 Voice state update error:', error);
            }
        });

        client.riffy.on('trackStart', async (player, track) => {
            try {
                player.__recoveringTrackError = false;
                player.__recoveringTrackStuck = false;
                clearTimeout(player.__trackRecoveryTimeout);
                player.__trackRecoveryTimeout = null;
                clearTimeout(player.__trackRecoveryResetTimer);
                player.__trackRecoveryResetTimer = setTimeout(() => {
                    if (player.playing) player.__trackRecoveryAttempts = 0;
                    player.__trackRecoveryResetTimer = null;
                }, 15000);
                clearTimeout(player.__trackStuckResetTimer);
                player.__trackStuckResetTimer = setTimeout(() => {
                    if (player.playing) player.__trackStuckAttempts = 0;
                    player.__trackStuckResetTimer = null;
                }, 30000);
                const channel = client.channels.cache.get(player.textChannel);
                const guildId = player.guildId;
                await setVoiceChannelStatus(
                    client,
                    guildId,
                    track?.info?.title || IDLE_VOICE_STATUS,
                    player.voiceChannel
                );

                if (!channel) return;

                // Lavalink can report a stream failure (trackError) while the
                // banner image below is still rendering. Remember which start
                // this is so a stale "NOW PLAYING / Active" panel is never
                // posted for a track that already failed.
                const startToken = (player.__trackStartToken || 0) + 1;
                player.__trackStartToken = startToken;
                const isStaleStart = () => (
                    player.__trackStartToken !== startToken ||
                    player.__recoveringTrackError ||
                    player.__manualStop ||
                    !client.riffy.players.has(guildId)
                );

                await advancedMessageManager.cleanupGuildMessages(client, guildId);
                sessionManager.updateActivity(guildId);

                function formatTime(ms) {
                    if (!ms || ms === 0) return "0:00";
                    const totalSeconds = Math.floor(ms / 1000);
                    const hours = Math.floor(totalSeconds / 3600);
                    const minutes = Math.floor((totalSeconds % 3600) / 60);
                    const seconds = totalSeconds % 60;
                    return `${hours > 0 ? hours + ":" : ""}${minutes.toString().padStart(hours > 0 ? 2 : 1, "0")}:${seconds.toString().padStart(2, "0")}`;
                }

                let cardBuffer = null;
                let attachment = null;

                try {
    

                    cardBuffer = await dynamicCard({
                        thumbnailURL: track.info.thumbnail || track.info.artworkUrl || 'https://via.placeholder.com/300x300/DC92FF/FFFFFF?text=Music',
                        songTitle: track.info.title || 'Unknown Title',
                        songArtist: track.info.author || 'Unknown Artist',
                        trackRequester: track.requester ? track.requester.username : "All In One",
                        fontPath: path.join(__dirname, "../UI", "fonts", "AfacadFlux-Regular.ttf"),
                        backgroundColor: "#DC92FF",
                    });

                    if (cardBuffer) {
                        attachment = new AttachmentBuilder(cardBuffer, { name: 'song-banner.png' });
                    }

                } catch (cardError) {
                    //console.error('Dynamic card error:', cardError);
                }

                let containerBuilder = advancedMessageManager.createV2Container('music')
                    .addTextDisplayComponents(
                        textDisplay => textDisplay.setContent('**<:nowplaying:1563476977531224115> NOW PLAYING**')
                    )
                    .addSeparatorComponents(separator => separator)
                    .addSectionComponents(
                        section => section
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent([
                                    `**<:nowplaying:1563476977531224115> ${track.info.title}**`,
                                    `**<:artist:1563476979968381008> Artist:** ${track.info.author}`,
                                    `**<:duration:1563476982044426342> Duration:** ${formatTime(track.info.length)}`,
                                    `**<:source:1563476983927676949> Source:** ${track.info.sourceName || 'YouTube'}`,
                                    `**<:highdefinition:1563481832048037979> Quality:** ${track.info.stream ? '🔴 Live Stream' : '<:quality:1563476985898995793> High Definition'}`
                                ].join('\n'))
                            )
                            .setThumbnailAccessory(
                                thumbnail => thumbnail
                                     .setURL(track.requester?.avatarURL ?? client.user.displayAvatarURL({ dynamic: true, size: 128 }))
                                     .setDescription(`Requested by ${track.requester ? track.requester.username : 'Unknown'}`)
                            )
                    );

                containerBuilder
                    .addSeparatorComponents(separator => separator)
                    .addTextDisplayComponents(
                        textDisplay => textDisplay.setContent([
                            `**<:requestedby:1563476988105195583> Requested by:** ${track.requester ? `<@${track.requester.id}>` : 'All In One'}`,
                            `**<:1000004993:1559504553844547584> Queue Position:** Playing Now`,
                            `**<:volume:1563476990558994432> Volume:** ${player.volume}%`,
                            `**<:1000004995:1559504557917216878> Loop:** ${player.loop || 'None'}`,
                            `**<:1000004990:1559504547079127050> Status:** ${player.playing ? '<:active:1563481834556366868> Active' : player.paused ? '🟡 Paused' : '🔴 Stopped'}`
                        ].join('\n'))
                    )
                    .addSeparatorComponents(separator => separator)
                    .addTextDisplayComponents(
                        textDisplay => textDisplay.setContent([
                            '**<:trackstats:1563476992853278830> TRACK STATISTICS**',
                            `**<:bitrate:1563476995596361808> Bitrate:** High Quality Audio`,
                            `**<:seekable:1563476997995503698> Seekable:** ${track.info.seekable ? '<:yes:1563481837114888273> Yes' : '❌ No'}`,
                            `**<:platform:1563476999941398588> Platform:** ${track.info.sourceName || 'YouTube Music'}`,
                            track.info.uri ? `**<:link:1563477002260840478> [Open Original](${track.info.uri})**` : ''
                        ].filter(Boolean).join('\n'))
                    );

                if (attachment) {
                    containerBuilder
                        .addSeparatorComponents(separator => separator)
                        .addMediaGalleryComponents(
                            mediaGallery => mediaGallery
                                .addItems(
                                    mediaItem => mediaItem
                                        .setURL('attachment://song-banner.png')
                                        .setDescription(`${track.info.title} - ${track.info.author}`)
                                )
                        );
                }

                const controlRow1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`v2_volume_down_${track.requester?.id || 'system'}`)
                        .setEmoji('<:1000004988:1559504542037573662>')
                        .setLabel('Vol -')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`v2_pause_${track.requester?.id || 'system'}`)
                        .setEmoji('<:1000004991:1559504549394382920>')
                        .setLabel('Pause')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`v2_resume_${track.requester?.id || 'system'}`)
                        .setEmoji('<:1000004990:1559504547079127050>')
                        .setLabel('Resume')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`v2_skip_${track.requester?.id || 'system'}`)
                        .setEmoji('<:1000004992:1559504551608983643>')
                        .setLabel('Skip')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`v2_volume_up_${track.requester?.id || 'system'}`)
                        .setEmoji('<:1000004989:1559504544600424498>')
                        .setLabel('Vol +')
                        .setStyle(ButtonStyle.Secondary)
                );

                const controlRow2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`v2_queue_${track.requester?.id || 'system'}`)
                        .setEmoji('<:1000004993:1559504553844547584>')
                        .setLabel('Queue')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`v2_lyrics_${track.requester?.id || 'system'}`)
                        .setEmoji('<:1000004994:1559504556017324112>')
                        .setLabel('Lyrics')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`v2_loop_${track.requester?.id || 'system'}`)
                        .setEmoji('<:1000004995:1559504557917216878>')
                        .setLabel('Loop')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`v2_shuffle_${track.requester?.id || 'system'}`)
                        .setEmoji('<:1000004996:1559504559838339073>')
                        .setLabel('Shuffle')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`v2_stop_${track.requester?.id || 'system'}`)
                        .setEmoji('<:1000004997:1559504562187145237>')
                        .setLabel('Stop')
                        .setStyle(ButtonStyle.Secondary)
                );

                const messageOptions = {
                    components: [containerBuilder],
                    flags: MessageFlags.IsComponentsV2
                };

                if (attachment) {
                    messageOptions.files = [attachment];
                }

                messageOptions.components.push(controlRow1, controlRow2);

                if (isStaleStart()) return;

                const message = await channel.send(messageOptions);

                if (isStaleStart()) {
                    // The track failed while this panel was being sent.
                    message.delete().catch(() => { });
                    return;
                }

                advancedMessageManager.addMessage(guildId, message.id, channel.id, 'track', {
                    isImportant: true,
                    queueSize: player.queue.length
                });

                player.currentMessageId = message.id;

                if (track.requester && track.requester.id) {
                    sessionManager.createSession(guildId, track.requester.id, {
                        trackTitle: track.info.title,
                        startedAt: Date.now()
                    });
                }

            } catch (error) {
                console.error('V2 Track start error:', error);

                try {
                    const channel = client.channels.cache.get(player.textChannel);
                    if (channel) {
                        const errorContainer = advancedMessageManager.createV2Container('error')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent('**❌ PLAYBACK ERROR**\nFailed to display track information.\n\n*Audio playback continues normally.*')
                            );

                        const errorMsg = await channel.send({
                            components: [errorContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        advancedMessageManager.addMessage(player.guildId, errorMsg.id, channel.id, 'error');
                    }
                } catch (fallbackError) {
                    console.error('V2 Fallback error message failed:', fallbackError);
                }
            }
        });


        client.riffy.on('trackEnd', async (player) => {
            try {
                const guildId = player.guildId;

                const hadLyricsSession = lyricsStateManager.isActive(guildId) ||
                    lyricsStateManager.collectors.has(guildId) ||
                    lyricIntervals.has(guildId) ||
                    advancedMessageManager.lyricsMessages.has(guildId);

                lyricsStateManager.clearGuild(guildId);

                if (lyricIntervals.has(guildId)) {
                    clearInterval(lyricIntervals.get(guildId));
                    lyricIntervals.delete(guildId);
                }

                await advancedMessageManager.cleanupGuildMessages(client, guildId, ['lyrics']);

                const channel = client.channels.cache.get(player.textChannel);
                if (channel && hadLyricsSession) {
                    const lyricsEndContainer = advancedMessageManager.createV2Container('info')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent('**🎤 LYRICS AUTO-CLOSED**\nLyrics session ended with track.')
                        );

                    const lyricsEndMsg = await channel.send({
                        components: [lyricsEndContainer],
                        flags: MessageFlags.IsComponentsV2
                    });

                    advancedMessageManager.addQuickDeleteMessage(client, lyricsEndMsg, 'info');
                }

                sessionManager.updateActivity(guildId);
            } catch (error) {
                console.error('V2 Track end error:', error);
            }
        });

        client.riffy.on("queueEnd", async (player) => {
            try {
                // A failed YouTube stream may temporarily leave the queue empty
                // before trackError arrives. Delay queue-end actions briefly so
                // the failure-recovery handler can claim the session first.
                const queueEndAttempt = (player.__queueEndAttempt || 0) + 1;
                player.__queueEndAttempt = queueEndAttempt;
                await new Promise(resolve => setTimeout(resolve, 750));
                if (
                    player.__queueEndAttempt !== queueEndAttempt ||
                    player.__recoveringTrackError ||
                    player.__recoveringTrackStuck ||
                    player.__autoplayInProgress ||
                    player.__manualStop ||
                    player.queue.length > 0 ||
                    player.playing
                ) return;

                // Recovery may have destroyed this player already (all
                // retries failed). Autoplay on a destroyed player throws
                // "Cannot read properties of null (reading 'establishing')".
                if (
                    !player.connection ||
                    client.riffy.players.get(player.guildId) !== player
                ) return;

                const channel = client.channels.cache.get(player.textChannel);
                const guildId = player.guildId;

                if (!channel) return;

                const result = await autoplayCollection.findOne({ guildId }).catch(() => null);
                const autoplay = result ? result.autoplay : false;

                if (autoplay) {
                    // Keep the player/session alive while Riffy resolves the next
                    // track. Cleaning up here used to remove the current panel and
                    // end the session before autoplay had actually started.
                    await advancedMessageManager.cleanupGuildMessages(
                        client,
                        guildId,
                        ['track', 'lyrics', 'queue', 'lastEmbed', 'control']
                    );
                    sessionManager.updateActivity(guildId);

                    const autoplayContainer = advancedMessageManager.createV2Container('autoplay')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent('**🔄 AUTOPLAY ACTIVE**\nSearching for similar tracks...\n\n*Continuous music experience enabled.*')
                        );

                    const autoplayMsg = await channel.send({
                        components: [autoplayContainer],
                        flags: MessageFlags.IsComponentsV2
                    });

                    advancedMessageManager.addQuickDeleteMessage(client, autoplayMsg, 'autoplay');

                    player.__autoplayInProgress = true;
                    try {
                        const result = await runSafeAutoplay(player, {
                            attempts: 3,
                            resolveTimeoutMs: 20000,
                            playTimeoutMs: 20000,
                            isStillValid: () =>
                                !player.__manualStop &&
                                !!player.connection &&
                                client.riffy.players.get(guildId) === player,
                            onAttemptFailed: (attempt, total, attemptError) => {
                                console.warn(
                                    `[V2 AUTOPLAY] Attempt ${attempt}/${total} failed in guild ${guildId}:`,
                                    attemptError.message
                                );
                            }
                        });

                        // Something else (user /play, stop, leave) took over.
                        if (!result.started) return;

                        const successContainer = advancedMessageManager.createV2Container('success')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent('**✅ AUTOPLAY SUCCESS**\nSimilar tracks have been queued.\n\n*Enjoy seamless playback!*')
                            );

                        const successMsg = await channel.send({
                            components: [successContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        advancedMessageManager.addQuickDeleteMessage(client, successMsg, 'autoplay_success');

                    } catch (autoplayError) {
                        console.error('V2 Autoplay failed:', autoplayError);
                        await setVoiceChannelStatus(
                            client,
                            guildId,
                            IDLE_VOICE_STATUS,
                            player.voiceChannel
                        );

                        const failContainer = advancedMessageManager.createV2Container('warning')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent('**⚠️ AUTOPLAY FAILED**\nCouldn\'t find similar tracks.\n\n*Session ended. Use `/music play` to restart.*')
                            );

                        const failMsg = await channel.send({
                            components: [failContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        advancedMessageManager.addQuickDeleteMessage(client, failMsg, 'autoplay_fail');

                        player.destroy();
                    } finally {
                        player.__autoplayInProgress = false;
                    }

                } else {
                    const keep247 = await VoicePresence.exists({
                        guildId,
                        channelId: player.voiceChannel,
                        enabled: true,
                        mode247: true
                    });

                    if (keep247) {
                        await setVoiceChannelStatus(
                            client,
                            guildId,
                            IDLE_VOICE_STATUS,
                            player.voiceChannel
                        );
                        await advancedMessageManager.cleanupGuildMessages(client, guildId);
                        const keepAliveContainer = advancedMessageManager.createV2Container('session_end')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent(
                                    '**🎵 MUSIC SESSION COMPLETED**\nThe queue has ended. I will stay in voice because 24/7 mode is enabled.'
                                )
                            );
                        const keepAliveMsg = await channel.send({
                            components: [keepAliveContainer],
                            flags: MessageFlags.IsComponentsV2
                        });
                        advancedMessageManager.addQuickDeleteMessage(client, keepAliveMsg, 'session_end');
                    } else {
                        await handlePlayerCleanup(client, guildId, player, 'Queue ended');
                        player.destroy();

                        const queueEndContainer = advancedMessageManager.createV2Container('session_end')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent('**🎵 MUSIC SESSION COMPLETED**')
                            )
                            .addSeparatorComponents(separator => separator)
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent(
                                    false
                                        ? ''
                                        : '**All tracks have been played successfully!**\n\n**📊 Session Summary:**\n• ✅ Playback completed without errors\n• 🔌 Player disconnected from voice channel\n• 🧹 All resources cleaned up automatically\n• 🎤 Lyrics sessions terminated\n• 📝 Message cache cleared\n\n*Ready for your next music session!*'
                                )
                            )
                            .addSeparatorComponents(separator => separator)
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent('**🎯 Quick Actions:**\n• Use `/music play <song>` to start a new session\n• Use `/music autoplay true` for continuous music\n• Join a voice channel to begin')
                            );

                        const queueEndMsg = await channel.send({
                            components: [queueEndContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        advancedMessageManager.addQuickDeleteMessage(client, queueEndMsg, 'session_end');
                    }
                }

                sessionManager.endSession(guildId);

            } catch (error) {
                console.error('V2 Queue end error:', error);
            }
        });

        client.on('interactionCreate', async (interaction) => {
            if (!interaction.isButton()) return;

            try {
                const match = interaction.customId.match(/^v2_(volume_up|volume_down|pause|resume|skip|stop|queue|lyrics|loop|shuffle|clear)_(\w+)$/);
                if (!match) return;

                const [, action, userId] = match;

                const player = client.riffy.players.get(interaction.guildId);
                if (!player) {
                    const noPlayerContainer = advancedMessageManager.createV2Container('warning')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent('**⚠️ NO ACTIVE PLAYER**\nMusic player not found or session has ended.\n\n*The session may have expired or been terminated.*')
                        );

                    return interaction.reply({
                        components: [noPlayerContainer],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                    });
                }

                const botVoiceChannel = interaction.guild.members.me?.voice?.channel;
                const userVoiceChannel = interaction.member?.voice?.channel;

                const isInSameChannel = botVoiceChannel && userVoiceChannel && botVoiceChannel.id === userVoiceChannel.id;
                const isOriginalRequester = sessionManager.isAuthorized(interaction.guildId, interaction.user.id) || interaction.user.id === userId;

                if (!isInSameChannel && !isOriginalRequester && userId !== 'system') {
                    const authContainer = advancedMessageManager.createV2Container('error')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent('**🚫 VOICE CHANNEL REQUIRED**\n\n**To control the music player, you must:**\n• Join the same voice channel as the bot\n• OR be the original session owner\n\n**Current Bot Channel:** ' + (botVoiceChannel ? botVoiceChannel.name : 'None') + '\n**Your Channel:** ' + (userVoiceChannel ? userVoiceChannel.name : 'None'))
                        );

                    return interaction.reply({
                        components: [authContainer],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                    });
                }

                await interaction.deferReply({ ephemeral: true });
                sessionManager.updateActivity(interaction.guildId);

                switch (action) {
                    case 'volume_up':
                        const newVolumeUp = Math.min(player.volume + 10, 100);
                        player.setVolume(newVolumeUp);

                        const volumeUpContainer = advancedMessageManager.createV2Container('volume')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent(`**🔊 VOLUME INCREASED**\n\nVolume: **${newVolumeUp}%**\n${getVolumeBar(newVolumeUp)}\n\n*Perfect for jamming out!*`)
                            );

                        const volUpReply = await interaction.editReply({
                            components: [volumeUpContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        setTimeout(() => volUpReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('volume'));
                        break;

                    case 'volume_down':
                        const newVolumeDown = Math.max(player.volume - 10, 0);
                        player.setVolume(newVolumeDown);

                        const volumeDownContainer = advancedMessageManager.createV2Container('volume')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent(`**🔉 VOLUME DECREASED**\n\nVolume: **${newVolumeDown}%**\n${getVolumeBar(newVolumeDown)}\n\n*${newVolumeDown === 0 ? 'Music is now muted.' : 'Quieter vibes activated.'}*`)
                            );

                        const volDownReply = await interaction.editReply({
                            components: [volumeDownContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        setTimeout(() => volDownReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('volume'));
                        break;

                    case 'pause':
                        player.pause(true);

                        const pauseContainer = advancedMessageManager.createV2Container('warning')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent('**⏸️ PLAYBACK PAUSED**\n\nMusic has been paused successfully.\n\n*Use the Resume button when ready to continue.*')
                            );

                        const pauseReply = await interaction.editReply({
                            components: [pauseContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        setTimeout(() => pauseReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('pause_resume'));
                        break;

                    case 'resume':
                        player.pause(false);

                        const resumeContainer = advancedMessageManager.createV2Container('success')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent('**▶️ PLAYBACK RESUMED**\n\nMusic playback has been resumed.\n\n*Let the music flow! 🎵*')
                            );

                        const resumeReply = await interaction.editReply({
                            components: [resumeContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        setTimeout(() => resumeReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('pause_resume'));
                        break;

                    case 'skip':
                        const currentTrack = player.current;
                        await advancedMessageManager.cleanupGuildMessages(client, interaction.guildId, ['track']);
                        player.stop();

                        const skipContainer = advancedMessageManager.createV2Container('info')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent(`**⏭️ TRACK SKIPPED**\n\n${currentTrack ? `**Skipped:** ${currentTrack.info.title}` : 'Current track skipped'}\n\n*${player.queue.length > 0 ? 'Moving to next track...' : 'Queue is empty - session will end.'}*`)
                            );

                        const skipReply = await interaction.editReply({
                            components: [skipContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        setTimeout(() => skipReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('skip'));
                        break;

                    case 'stop':
                      
                        lyricsStateManager.stopLyrics(interaction.guildId, true);

                        if (lyricIntervals.has(interaction.guildId)) {
                            clearInterval(lyricIntervals.get(interaction.guildId));
                            lyricIntervals.delete(interaction.guildId);
                        }

                        await advancedMessageManager.cleanupGuildMessages(client, interaction.guildId, ['lyrics']);
                        await handlePlayerCleanup(client, interaction.guildId, player, 'Manual stop by user');
                        player.destroy();
                        sessionManager.endSession(interaction.guildId);

                        const stopContainer = advancedMessageManager.createV2Container('error')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent('**⏹️ MUSIC SESSION TERMINATED**\n\nSession stopped by user request.\n\n**🔧 Actions Performed:**\n• ⏹️ Playback completely stopped\n• 🗑️ Queue cleared and reset\n• 🔌 Player disconnected from voice\n• 🎤 Lyrics sessions permanently disabled\n• 🧹 All resources cleaned up\n\n**Ready for your next session!**')
                            );

                        const stopReply = await interaction.editReply({
                            components: [stopContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        const channel = client.channels.cache.get(player.textChannel);
                        if (channel) {
                            const channelStopContainer = advancedMessageManager.createV2Container('session_end')
                                .addTextDisplayComponents(
                                    textDisplay => textDisplay.setContent('**🎵 MUSIC SESSION ENDED**\nStopped by user request.\n\n*All resources have been cleaned up and the bot is ready for the next music session.*')
                                );

                            const stopMsg = await channel.send({
                                components: [channelStopContainer],
                                flags: MessageFlags.IsComponentsV2
                            });

                            advancedMessageManager.addQuickDeleteMessage(client, stopMsg, 'session_end');
                        }

                        setTimeout(() => stopReply.delete().catch(() => { }), 3000);
                        break;

                    case 'shuffle':
                        if (!player.queue || player.queue.length === 0) {
                            const emptyContainer = advancedMessageManager.createV2Container('warning')
                                .addTextDisplayComponents(
                                    textDisplay => textDisplay.setContent('**❌ EMPTY QUEUE**\nCannot shuffle an empty queue.\n\n*Add some tracks first with `/music play`.*')
                                );

                            const emptyReply = await interaction.editReply({
                                components: [emptyContainer],
                                flags: MessageFlags.IsComponentsV2
                            });

                            setTimeout(() => emptyReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('warning'));
                            return;
                        }

                        player.queue.shuffle();

                        const shuffleContainer = advancedMessageManager.createV2Container('success')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent(`**🔀 QUEUE SHUFFLED**\nThe music queue has been shuffled randomly!\n\n**📊 Queue Info:**\n• **Total Tracks:** ${player.queue.length}\n• **Order:** Completely randomized\n• **Next Up:** ${player.queue[0]?.info.title || 'None'}\n\n*Time for some musical surprises! 🎲*`)
                            );

                        const shuffleReply = await interaction.editReply({
                            components: [shuffleContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        setTimeout(() => shuffleReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('shuffle'));
                        break;

                    case 'loop':
                        const loopMode = player.loop === 'none' ? 'track' : player.loop === 'track' ? 'queue' : 'none';
                        player.setLoop(loopMode);

                        const loopContainer = advancedMessageManager.createV2Container('info')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent(`**🔁 LOOP MODE UPDATED**\n\n**Mode:** ${loopMode.toUpperCase()}\n\n${getLoopDescription(loopMode)}\n\n*Loop preferences saved for this session.*`)
                            );

                        const loopReply = await interaction.editReply({
                            components: [loopContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        setTimeout(() => loopReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('loop'));
                        break;

                    case 'queue':
                        if (!player.queue || player.queue.length === 0) {
                            const emptyQueueContainer = advancedMessageManager.createV2Container('warning')
                                .addTextDisplayComponents(
                                    textDisplay => textDisplay.setContent('**📜 EMPTY QUEUE**\n\nNo tracks in queue.\n\n*Add tracks using `/music play <song>`*')
                                );

                            const emptyQueueReply = await interaction.editReply({
                                components: [emptyQueueContainer],
                                flags: MessageFlags.IsComponentsV2
                            });

                            setTimeout(() => emptyQueueReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('warning'));
                        } else {
                            await showV2Queue(client, player, interaction);
                        }
                        break;

                    case 'lyrics':
                        await showV2Lyrics(client, player, interaction);
                        break;

                    default:
                        const unknownContainer = advancedMessageManager.createV2Container('error')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent('**❌ UNKNOWN ACTION**\n\nUnrecognized control action.')
                            );

                        const unknownReply = await interaction.editReply({
                            components: [unknownContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        setTimeout(() => unknownReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('error'));
                        break;
                }
            } catch (error) {
                console.error('V2 Button interaction error:', error);

                try {
                    const errorContainer = advancedMessageManager.createV2Container('error')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent('**❌ INTERACTION ERROR**\n\nSomething went wrong processing your request.\n\n*Please try again or restart the music session.*')
                        );

                    if (interaction.deferred) {
                        const errorReply = await interaction.editReply({
                            components: [errorContainer],
                            flags: MessageFlags.IsComponentsV2
                        });
                        setTimeout(() => errorReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('error'));
                    } else {
                        await interaction.reply({
                            components: [errorContainer],
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                        });
                    }
                } catch (fallbackError) {
                    console.error('V2 Interaction fallback error:', fallbackError);
                }
            }
        });

        async function showV2Queue(client, player, interaction) {
            try {
                const channel = client.channels.cache.get(player.textChannel);
                if (!channel) {
                    const channelErrorContainer = advancedMessageManager.createV2Container('error')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent('**❌ CHANNEL ERROR**\n\nCould not find music text channel.')
                        );

                    const errorReply = await interaction.editReply({
                        components: [channelErrorContainer],
                        flags: MessageFlags.IsComponentsV2
                    });

                    setTimeout(() => errorReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('error'));
                    return;
                }

                await advancedMessageManager.cleanupGuildMessages(client, interaction.guildId, ['queue']);

                const queue = player.queue;
                const currentTrack = player.current;

                const queueItems = queue.slice(0, 15).map((track, i) =>
                    `**${i + 1}.** **${track.info.title}**\n> *🎤 ${track.info.author} • 👤 ${track.requester?.username || 'Unknown'} • ⏱️ ${formatTime(track.info.length)}*`
                );

                const queueContainer = advancedMessageManager.createV2Container('queue')
                    .addTextDisplayComponents(
                        textDisplay => textDisplay.setContent('**🎵 MUSIC QUEUE**')
                    )
                    .addSeparatorComponents(separator => separator);

                if (currentTrack) {
                    queueContainer.addSectionComponents(
                        section => section
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent(`**🎧 Currently Playing:**\n**${currentTrack.info.title}**\n*${currentTrack.info.author} • ${formatTime(currentTrack.info.length)}*`)
                            )
                            .setThumbnailAccessory(
                                thumbnail => thumbnail
                                    .setURL(currentTrack.info.thumbnail || 'https://via.placeholder.com/300x300/DC92FF/FFFFFF?text=Music')
                                    .setDescription('Now Playing')
                            )
                    ).addSeparatorComponents(separator => separator);
                }

                queueContainer.addTextDisplayComponents(
                    textDisplay => textDisplay.setContent([
                        '**📊 Queue Statistics:**',
                        `• **Total Tracks:** ${queue.length}`,
                        `• **Estimated Time:** ~${Math.round(queue.length * 3.5)} minutes`,
                        `• **Loop Mode:** ${player.loop || 'None'}`,
                        `• **Shuffle:** ${queue.shuffled ? 'Enabled' : 'Disabled'}`,
                        `• **Volume:** ${player.volume}%`
                    ].join('\n'))
                ).addSeparatorComponents(separator => separator);

                if (queueItems.length > 0) {
                    queueContainer.addTextDisplayComponents(
                        textDisplay => textDisplay.setContent([
                            '**📋 Up Next:**',
                            '',
                            queueItems.join('\n\n'),
                            queue.length > 15 ? `\n\n*...and ${queue.length - 15} more tracks*` : ''
                        ].join('\n'))
                    );
                } else {
                    queueContainer.addTextDisplayComponents(
                        textDisplay => textDisplay.setContent('**📭 No tracks in queue**\n\nAdd more tracks with `/music play` or enable autoplay for continuous music.')
                    );
                }

                const queueMessage = await channel.send({
                    components: [queueContainer],
                    flags: MessageFlags.IsComponentsV2
                });

                const context = { queueSize: queue.length };
                advancedMessageManager.addMessage(interaction.guildId, queueMessage.id, channel.id, 'queue', context);

                const successContainer = advancedMessageManager.createV2Container('success')
                    .addTextDisplayComponents(
                        textDisplay => textDisplay.setContent('**📜 QUEUE DISPLAYED**\n\nQueue information shown in channel.\n\n*Auto-deletes in 45 seconds for a clean chat.*')
                    );

                const successReply = await interaction.editReply({
                    components: [successContainer],
                    flags: MessageFlags.IsComponentsV2
                });

                setTimeout(() => successReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('success'));

            } catch (error) {
                console.error('V2 Queue display error:', error);

                const errorContainer = advancedMessageManager.createV2Container('error')
                    .addTextDisplayComponents(
                        textDisplay => textDisplay.setContent('**❌ QUEUE DISPLAY ERROR**\n\nFailed to show queue information.')
                    );

                const errorReply = await interaction.editReply({
                    components: [errorContainer],
                    flags: MessageFlags.IsComponentsV2
                });

                setTimeout(() => errorReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('error'));
            }
        }

   
        async function showV2Lyrics(client, player, interaction) {
            try {
                const channel = client.channels.cache.get(player.textChannel);
                if (!channel) {
                    const channelErrorContainer = advancedMessageManager.createV2Container('error')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent('**❌ CHANNEL ERROR**\n\nCould not find music text channel.')
                        );

                    const errorReply = await interaction.editReply({
                        components: [channelErrorContainer],
                        flags: MessageFlags.IsComponentsV2
                    });

                    setTimeout(() => errorReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('error'));
                    return;
                }

                if (!player.current) {
                    const noTrackContainer = advancedMessageManager.createV2Container('warning')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent('**🎵 NO TRACK PLAYING**\n\nNo song is currently active.\n\n*Start playing music to view lyrics.*')
                        );

                    const noTrackReply = await interaction.editReply({
                        components: [noTrackContainer],
                        flags: MessageFlags.IsComponentsV2
                    });

                    setTimeout(() => noTrackReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('warning'));
                    return;
                }

             
                if (lyricsStateManager.isActive(interaction.guildId)) {
                    const alreadyActiveContainer = advancedMessageManager.createV2Container('warning')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent('**⚠️ LYRICS ALREADY ACTIVE**\nLyrics are already running for this track.\n\n*Use the existing lyrics controls or stop them first.*')
                        );

                    await interaction.editReply({
                        components: [alreadyActiveContainer],
                        flags: MessageFlags.IsComponentsV2
                    });
                    return;
                }

              
                if (lyricsStateManager.isManuallyStopped(interaction.guildId)) {
                    const stoppedContainer = advancedMessageManager.createV2Container('warning')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent('**🛑 LYRICS MANUALLY DISABLED**\nLyrics were stopped for this session.\n\n*They will not auto-restart. Click below to restart manually.*')
                        );

                    const restartRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('v2_lyrics_force_restart')
                            .setLabel('Force Restart Lyrics')
                            .setEmoji('🔄')
                            .setStyle(ButtonStyle.Success)
                    );

                    const stoppedReply = await interaction.editReply({
                        components: [stoppedContainer, restartRow],
                        flags: MessageFlags.IsComponentsV2
                    });

              
                    const forceCollector = stoppedReply.createMessageComponentCollector({ time: 30000 });
                    forceCollector.on('collect', async (i) => {
                        if (i.customId === 'v2_lyrics_force_restart') {
                            await i.deferUpdate();
                            lyricsStateManager.clearGuild(interaction.guildId);
                            const currentTrack = player.current.info;
                            const lyricsResult = await getLyrics(currentTrack.title, currentTrack.author, Math.floor(currentTrack.length / 1000));
                            if (lyricsResult?.syncedLyrics) {
                                await startV2LiveLyrics(client, channel, player, currentTrack, lyricsResult, interaction);
                            } else {
                                await i.followUp({
                                    content: 'No time-synced lyrics were found for this song.',
                                    flags: MessageFlags.Ephemeral
                                }).catch(() => {});
                            }
                        }
                    });

                    setTimeout(() => stoppedReply.delete().catch(() => { }), 30000);
                    return;
                }

                await advancedMessageManager.cleanupGuildMessages(client, interaction.guildId, ['lyrics']);

                if (lyricIntervals.has(interaction.guildId)) {
                    clearInterval(lyricIntervals.get(interaction.guildId));
                    lyricIntervals.delete(interaction.guildId);
                }

                const track = player.current.info;

                const loadingContainer = advancedMessageManager.createV2Container('info')
                    .addTextDisplayComponents(
                        textDisplay => textDisplay.setContent('**🎤 LOADING LYRICS**\n\nSearching for lyrics...\n\n*Please wait while we fetch the lyrics.*')
                    );

                const loadingReply = await interaction.editReply({
                    components: [loadingContainer],
                    flags: MessageFlags.IsComponentsV2
                });

                const lyricsResult = await getLyrics(track.title, track.author, Math.floor(track.length / 1000));

                if (!lyricsResult?.syncedLyrics || !parseSyncedLyrics(lyricsResult.syncedLyrics).length) {
                    const noLyricsContainer = advancedMessageManager.createV2Container('warning')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent('**❌ SYNCED LYRICS NOT FOUND**\n\n**No time-synced lyrics available for:**\n**' + track.title + '** - *' + track.author + '*\n\nWe checked LRCLib and the available lyrics providers. Live lyrics require timestamps; some songs may only have plain lyrics.')
                        );

                    await loadingReply.edit({
                        components: [noLyricsContainer],
                        flags: MessageFlags.IsComponentsV2
                    });

                    setTimeout(() => loadingReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('warning', { isImportant: true }));
                    return;
                }

                await loadingReply.delete().catch(() => { });
                await startV2LiveLyrics(client, channel, player, track, lyricsResult, interaction);

            } catch (error) {
                console.error('V2 Lyrics error:', error);

                const errorContainer = advancedMessageManager.createV2Container('error')
                    .addTextDisplayComponents(
                        textDisplay => textDisplay.setContent('**❌ LYRICS ERROR**\n\nFailed to load lyrics.\n\n*Try again or check if the song has lyrics available.*')
                    );

                const errorReply = await interaction.editReply({
                    components: [errorContainer],
                    flags: MessageFlags.IsComponentsV2
                });

                setTimeout(() => errorReply.delete().catch(() => { }), advancedMessageManager.getAutoDeleteTime('error'));
            }
        }

      
        async function startV2LiveLyrics(client, channel, player, track, lyricsResult, interaction) {
            const guildId = player.guildId;
            try {
                const syncedLines = parseSyncedLyrics(lyricsResult.syncedLyrics);
                if (!syncedLines.length) return;
                const lines = syncedLines.map(line => line.text);
                const songDuration = Math.floor(track.length / 1000);

            
                lyricsStateManager.startLyrics(guildId, {
                    trackTitle: track.title,
                    source: lyricsResult.source,
                    startTime: Date.now(),
                    messageId: null
                });

                const lyricsContainer = advancedMessageManager.createV2Container('lyrics')
                    .addTextDisplayComponents(
                        textDisplay => textDisplay.setContent(`**🎤 LIVE LYRICS**`)
                    )
                    .addSeparatorComponents(separator => separator)
                    .addSectionComponents(
                        section => section
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent(`**${track.title}**\n*${track.author}*\n\n🔄 Syncing lyrics...`)
                            )
                            .setThumbnailAccessory(
                                thumbnail => thumbnail
                                    .setURL(track.thumbnail || 'https://via.placeholder.com/300x300/FF69B4/FFFFFF?text=Lyrics')
                                    .setDescription('Live Lyrics')
                            )
                    );

           
                const lyricsControlRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('v2_lyrics_full')
                        .setLabel('Full Lyrics')
                        .setEmoji('📜')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('v2_lyrics_stop_final')
                        .setLabel('Stop & Disable')
                        .setEmoji('⏹️')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('v2_lyrics_restart')
                        .setLabel('Restart')
                        .setEmoji('🔄')
                        .setStyle(ButtonStyle.Secondary)
                );

                const lyricsMessage = await channel.send({
                    components: [lyricsContainer, lyricsControlRow],
                    flags: MessageFlags.IsComponentsV2
                });

              
                const stateData = lyricsStateManager.activeGuilds.get(guildId);
                if (stateData) {
                    stateData.messageId = lyricsMessage.id;
                    lyricsStateManager.activeGuilds.set(guildId, stateData);
                }

                advancedMessageManager.addMessage(guildId, lyricsMessage.id, channel.id, 'lyrics');

          
                let lastLineIndex = -1;
                let lastProgressUpdate = -1;
                const updateLyrics = async () => {
                    try {
                     
                        if (!lyricsStateManager.isActive(guildId)) {
                            //console.log(`🛑 UpdateLyrics stopped - guild ${guildId} not active`);
                            if (lyricIntervals.has(guildId)) {
                                clearInterval(lyricIntervals.get(guildId));
                                lyricIntervals.delete(guildId);
                            }
                            return;
                        }

                      
                        if (lyricsStateManager.isManuallyStopped(guildId)) {
                            //console.log(`🛑 UpdateLyrics stopped - guild ${guildId} manually stopped`);
                            if (lyricIntervals.has(guildId)) {
                                clearInterval(lyricIntervals.get(guildId));
                                lyricIntervals.delete(guildId);
                            }
                            return;
                        }

                        const currentPlayer = client.riffy.players.get(guildId);
                        if (!currentPlayer || !currentPlayer.current || currentPlayer.current.info.title !== track.title) {
                            //console.log(`🛑 UpdateLyrics stopped - track changed or player gone`);

                            lyricsStateManager.clearGuild(guildId);

                            if (lyricIntervals.has(guildId)) {
                                clearInterval(lyricIntervals.get(guildId));
                                lyricIntervals.delete(guildId);
                            }

                            const autoCleanupContainer = advancedMessageManager.createV2Container('info')
                                .addTextDisplayComponents(
                                    textDisplay => textDisplay.setContent('**🎤 LYRICS AUTO-CLOSED**\nTrack ended or changed.')
                                );

                            await lyricsMessage.edit({
                                components: [autoCleanupContainer],
                                flags: MessageFlags.IsComponentsV2
                            }).catch(() => { });

                            setTimeout(() => {
                                lyricsMessage.delete().catch(() => { });
                                advancedMessageManager.lyricsMessages.delete(guildId);
                            }, 3000);
                            return;
                        }

                        
                        const position = Math.max(0, Number(currentPlayer.position) || 0);
                        const currentTime = Math.floor(position / 1000);
                        const currentLineIndex = getCurrentLineIndex(syncedLines, position);
                        const progressUpdate = Math.floor(currentTime / 15);
                        if (currentLineIndex === lastLineIndex && progressUpdate === lastProgressUpdate) return;
                        lastLineIndex = currentLineIndex;
                        lastProgressUpdate = progressUpdate;

                        const start = Math.max(0, currentLineIndex - 5);
                        const end = Math.min(lines.length, currentLineIndex + 6);
                        const visibleLines = lines.slice(start, end).map((line, i) => {
                            const actualIndex = start + i;
                            const isCurrentLine = actualIndex === currentLineIndex;
                            return isCurrentLine ? `**► ${line}**` : `${line}`;
                        }).join('\n');

                        const updatedContainer = advancedMessageManager.createV2Container('lyrics')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent(`**🎤 LIVE LYRICS**`)
                            )
                            .addSeparatorComponents(separator => separator)
                            .addSectionComponents(
                                section => section
                                    .addTextDisplayComponents(
                                        textDisplay => textDisplay.setContent([
                                            `**${track.title}**`,
                                            `*${track.author}*`,
                                            `-# Lyrics source: ${lyricsResult.source}`,
                                            '',
                                            visibleLines || '🎵 *Waiting for lyrics...*'
                                        ].join('\n'))
                                    )
                                    .setThumbnailAccessory(
                                        thumbnail => thumbnail
                                            .setURL(track.thumbnail || 'https://via.placeholder.com/300x300/FF69B4/FFFFFF?text=Lyrics')
                                            .setDescription('Live Lyrics')
                                    )
                            )
                            .addSeparatorComponents(separator => separator)
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent(`**⏱️ Progress:** ${Math.floor(currentTime / 60)}:${(currentTime % 60).toString().padStart(2, '0')} / ${Math.floor(songDuration / 60)}:${(songDuration % 60).toString().padStart(2, '0')}\n**🎵 Line:** ${Math.min(currentLineIndex + 1, lines.length)} of ${lines.length}`)
                            );

                        await lyricsMessage.edit({
                            components: [updatedContainer, lyricsControlRow],
                            flags: MessageFlags.IsComponentsV2
                        }).catch(() => {
                           
                            lyricsStateManager.clearGuild(guildId);
                            if (lyricIntervals.has(guildId)) {
                                clearInterval(lyricIntervals.get(guildId));
                                lyricIntervals.delete(guildId);
                            }
                        });

                    } catch (updateError) {
                        console.error('Lyrics update error:', updateError);
                        
                        lyricsStateManager.clearGuild(guildId);
                        if (lyricIntervals.has(guildId)) {
                            clearInterval(lyricIntervals.get(guildId));
                            lyricIntervals.delete(guildId);
                        }
                    }
                };

          
                const interval = setInterval(updateLyrics, 1000);
                lyricIntervals.set(guildId, interval);
                updateLyrics(); 

                const collector = lyricsMessage.createMessageComponentCollector({
                    time: 600000,
                    filter: (i) => ['v2_lyrics_full', 'v2_lyrics_stop_final', 'v2_lyrics_restart'].includes(i.customId)
                });

     
                lyricsStateManager.setCollector(guildId, collector);

                collector.on('collect', async (i) => {
                    try {
                        let hasResponded = false;

                        try {
                            await i.deferUpdate();
                            hasResponded = true;
                        } catch (deferError) {
                            console.warn('Defer failed:', deferError.code);
                            if (!hasResponded && !i.replied && !i.deferred) {
                                try {
                                    await i.reply({
                                        content: 'Processing...',
                                        flags: MessageFlags.Ephemeral
                                    });
                                    hasResponded = true;
                                } catch (replyError) {
                                    console.warn('Reply also failed:', replyError.code);
                                    return;
                                }
                            }
                        }

                        if (i.customId === 'v2_lyrics_stop_final') {


                         
                            lyricsStateManager.stopLyrics(guildId, true);

                         
                            if (lyricIntervals.has(guildId)) {
                                clearInterval(lyricIntervals.get(guildId));
                                lyricIntervals.delete(guildId);
                            }

                         
                            collector.stop('nuclear_stop');

                      
                            advancedMessageManager.lyricsMessages.delete(guildId);

                         
                            try {
                                await lyricsMessage.delete();
                                //console.log('✅ Lyrics message deleted immediately');
                            } catch (deleteError) {
                                //console.warn('Could not delete lyrics message:', deleteError.code);
                            }

                    
                            const confirmMsg = await channel.send({
                                content: '🛑 LYRICS PERMANENTLY STOPPED - Will not auto-restart this session.',
                                components: []
                            });

                            setTimeout(() => confirmMsg.delete().catch(() => { }), 3000);

                               return;

                        } else if (i.customId === 'v2_lyrics_restart') {
                       
                            lyricsStateManager.clearGuild(guildId);
                            lyricsStateManager.startLyrics(guildId, {
                                trackTitle: track.title,
                                startTime: Date.now(),
                                messageId: lyricsMessage.id
                            });

                            if (lyricIntervals.has(guildId)) {
                                clearInterval(lyricIntervals.get(guildId));
                                lyricIntervals.delete(guildId);
                            }

                            const newInterval = setInterval(updateLyrics, 2000);
                            lyricIntervals.set(guildId, newInterval);
                            updateLyrics();

                        } else if (i.customId === 'v2_lyrics_full') {
                        
                            if (lyricIntervals.has(guildId)) {
                                clearInterval(lyricIntervals.get(guildId));
                                lyricIntervals.delete(guildId);
                            }

                            try {
                                const maxLength = 4000;
                                let lyricsText = lines.join('\n');
                                let isShortened = false;

                                if (lyricsText.length > maxLength) {
                                    const cutPoint = lyricsText.lastIndexOf('\n', maxLength);
                                    if (cutPoint > maxLength * 0.7) {
                                        lyricsText = lyricsText.substring(0, cutPoint);
                                        isShortened = true;
                                    } else {
                                        const lastSpace = lyricsText.lastIndexOf(' ', maxLength);
                                        lyricsText = lyricsText.substring(0, lastSpace > 0 ? lastSpace : maxLength);
                                        isShortened = true;
                                    }
                                }

                                const messageExists = await channel.messages.fetch(lyricsMessage.id).catch(() => null);
                                if (!messageExists) {
                                    const fullLyricsEmbed = new EmbedBuilder()
                                        .setColor(0xff69b4)
                                        .setTitle('📜 FULL LYRICS')
                                        .setDescription(`**${track.title}**\n*${track.author}*\n\n${lyricsText}${isShortened ? '\n\n*...lyrics truncated due to length*' : ''}`)
                                        .setFooter({
                                            text: `${lines.length} lines total ${isShortened ? '(shortened)' : '(complete)'}`
                                        });

                                    const newLyricsMsg = await channel.send({
                                        embeds: [fullLyricsEmbed]
                                    });

                                    setTimeout(() => newLyricsMsg.delete().catch(() => { }), 60000);
                                    return;
                                }

                                const fullLyricsEmbed = new EmbedBuilder()
                                    .setColor(0xff69b4)
                                    .setTitle('📜 FULL LYRICS')
                                    .setDescription(`**${track.title}**\n*${track.author}*\n\n${lyricsText}${isShortened ? '\n\n*...lyrics truncated due to Discord length limits*' : ''}`)
                                    .setThumbnail(track.thumbnail || 'https://via.placeholder.com/300x300/FF69B4/FFFFFF?text=Lyrics')
                                    .setFooter({
                                        text: `${lines.length} lines total ${isShortened ? '(showing first part)' : '(complete)'} • Click buttons to control`,
                                        iconURL: 'https://via.placeholder.com/32x32/FF69B4/FFFFFF?text=♪'
                                    })
                                    .setTimestamp();

                                const backRow = new ActionRowBuilder().addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('v2_lyrics_back')
                                        .setLabel('Back to Live')
                                        .setEmoji('↩️')
                                        .setStyle(ButtonStyle.Primary),
                                    new ButtonBuilder()
                                        .setCustomId('v2_lyrics_download')
                                        .setLabel('Download Full')
                                        .setEmoji('📥')
                                        .setStyle(ButtonStyle.Secondary),
                                    new ButtonBuilder()
                                        .setCustomId('v2_lyrics_delete')
                                        .setLabel('Delete')
                                        .setEmoji('🗑️')
                                        .setStyle(ButtonStyle.Danger)
                                );

                                await lyricsMessage.edit({
                                    embeds: [fullLyricsEmbed],
                                    components: [backRow],
                                    flags: 0
                                });

                            } catch (fullLyricsError) {
                                console.error('Full lyrics display error:', fullLyricsError);

                                try {
                                    const lyricsFile = new AttachmentBuilder(
                                        Buffer.from(lines.join('\n'), 'utf8'),
                                        { name: `${track.title.replace(/[^a-zA-Z0-9\s]/g, '_')}_lyrics.txt` }
                                    );

                                    if (hasResponded && i.deferred) {
                                        await i.followUp({
                                            content: `📜 **FULL LYRICS** - ${track.title}\n\n*Lyrics too long for display, attached as file.*`,
                                            files: [lyricsFile],
                                            flags: MessageFlags.Ephemeral
                                        });
                                    }
                                } catch (fileError) {
                                    console.error('File fallback failed:', fileError);
                                }
                            }
                        }

                     
                        if (['v2_lyrics_back', 'v2_lyrics_download', 'v2_lyrics_delete'].includes(i.customId)) {
                            const additionalCollector = lyricsMessage.createMessageComponentCollector({ time: 300000 });
                            additionalCollector.on('collect', async (ci) => {
                                try {
                                    await ci.deferUpdate();

                                    if (ci.customId === 'v2_lyrics_back') {
                                        const messageExists = await channel.messages.fetch(lyricsMessage.id).catch(() => null);
                                        if (!messageExists) return;

                                        if (lyricIntervals.has(guildId)) {
                                            clearInterval(lyricIntervals.get(guildId));
                                            lyricIntervals.delete(guildId);
                                        }

                                        const newInterval = setInterval(updateLyrics, 2000);
                                        lyricIntervals.set(guildId, newInterval);
                                        await updateLyrics();

                                    } else if (ci.customId === 'v2_lyrics_download') {
                                        const lyricsFile = new AttachmentBuilder(
                                            Buffer.from(lines.join('\n'), 'utf8'),
                                            { name: `${track.title.replace(/[^a-zA-Z0-9\s]/g, '_')}_lyrics.txt` }
                                        );

                                        await ci.followUp({
                                            content: `📥 **LYRICS DOWNLOAD** - ${track.title}\n\n**Complete lyrics file attached.**`,
                                            files: [lyricsFile],
                                            flags: MessageFlags.Ephemeral
                                        });

                                    } else if (ci.customId === 'v2_lyrics_delete') {
                                        lyricsStateManager.clearGuild(guildId);
                                        if (lyricIntervals.has(guildId)) {
                                            clearInterval(lyricIntervals.get(guildId));
                                            lyricIntervals.delete(guildId);
                                        }

                                        await lyricsMessage.delete();
                                        advancedMessageManager.lyricsMessages.delete(guildId);
                                        collector.stop('manual_delete');
                                        additionalCollector.stop('manual_delete');
                                    }
                                } catch (additionalError) {
                                    console.error('Additional collector error:', additionalError);
                                }
                            });
                        }

                    } catch (collectorError) {
                        console.error('Lyrics collector error:', collectorError);
                    }
                });

                collector.on('end', (collected, reason) => {
                    //console.log(`Lyrics collector ended: ${reason}`);

                    if (reason === 'nuclear_stop' || reason === 'manual_delete') {
                       // console.log('Nuclear stop/manual delete - no cleanup needed');
                        return;
                    }

              
                    lyricsStateManager.clearGuild(guildId);

                    if (lyricIntervals.has(guildId)) {
                        clearInterval(lyricIntervals.get(guildId));
                        lyricIntervals.delete(guildId);
                    }

                    advancedMessageManager.lyricsMessages.delete(guildId);

                    setTimeout(() => {
                        lyricsMessage.delete().catch(() => { });
                    }, 1000);
                });

          
                const successContainer = advancedMessageManager.createV2Container('success')
                    .addTextDisplayComponents(
                        textDisplay => textDisplay.setContent('**🎤 LIVE LYRICS STARTED**\n\nLyrics are now syncing with the music!\n\n**⚠️ Important:** Use "Stop & Disable" to permanently stop lyrics for this session.')
                    );

                const successReply = await interaction.editReply({
                    components: [successContainer],
                    flags: MessageFlags.IsComponentsV2
                });

                setTimeout(() => successReply.delete().catch(() => { }), 5000);

            } catch (error) {
                console.error('V2 Live lyrics start error:', error);

              
                lyricsStateManager.clearGuild(guildId);
                if (lyricIntervals.has(guildId)) {
                    clearInterval(lyricIntervals.get(guildId));
                    lyricIntervals.delete(guildId);
                }
            }
        }

        async function handlePlayerCleanup(client, guildId, player, reason) {
            try {
                //console.log(`🧹 Starting complete cleanup for guild ${guildId}: ${reason}`);

             
                lyricsStateManager.clearGuild(guildId);

                await advancedMessageManager.cleanupGuildMessages(client, guildId);

                if (lyricIntervals.has(guildId)) {
                    clearInterval(lyricIntervals.get(guildId));
                    lyricIntervals.delete(guildId);
                }

                if (queueDisplayTimeouts.has(guildId)) {
                    clearTimeout(queueDisplayTimeouts.get(guildId));
                    queueDisplayTimeouts.delete(guildId);
                }

                sessionManager.endSession(guildId);

                //console.log(`✅ Complete V2 cleanup finished for guild ${guildId}: ${reason}`);
            } catch (error) {
                //console.error('V2 Player cleanup error:', error);
            }
        }

        function formatTime(ms) {
            if (!ms || ms === 0) return "0:00";
            const totalSeconds = Math.floor(ms / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            return `${hours > 0 ? hours + ":" : ""}${minutes.toString().padStart(hours > 0 ? 2 : 1, "0")}:${seconds.toString().padStart(2, "0")}`;
        }

        async function getLyrics(trackName, artistName, duration) {
            return fetchSyncedLyrics(trackName, artistName, duration);
        }

        function getVolumeBar(volume) {
            const barLength = 20;
            const filledLength = Math.round((volume / 100) * barLength);
            const emptyLength = barLength - filledLength;
            return '█'.repeat(filledLength) + '░'.repeat(emptyLength) + ` ${volume}%`;
        }

        function getLoopDescription(mode) {
            const descriptions = {
                'none': '*No looping - plays through queue once*',
                'track': '*Current track repeats indefinitely*',
                'queue': '*Entire queue repeats when finished*'
            };
            return descriptions[mode] || '*Unknown loop mode*';
        }

        client.riffy.on('playerDestroy', async (player) => {
            const guildId = player.guildId;
            clearTimeout(player.__trackRecoveryTimeout);
            clearTimeout(player.__trackRecoveryResetTimer);
            clearTimeout(player.__trackStuckResetTimer);
            await handlePlayerCleanup(client, guildId, player, 'Player destroyed');
        });

        client.riffy.on('trackStuck', (player, track, payload) => {
            const trackInfo = track?.info || {};
            const guildId = player.guildId;

            console.warn(`[V2 TRACK STUCK] Guild ${guildId}: ${trackInfo.title || 'Unknown track'} stalled after ${payload?.thresholdMs || 'unknown'}ms`);
            advancedMessageManager.cleanupGuildMessages(client, guildId, ['track']).catch(() => {});

            if (player.__manualStop || player.__recoveringTrackError || player.__recoveringTrackStuck) return;
            player.__recoveringTrackStuck = true;
            const recoveryVersion = (player.__trackStuckRecoveryVersion || 0) + 1;
            player.__trackStuckRecoveryVersion = recoveryVersion;
            player.__trackStuckAttempts = (player.__trackStuckAttempts || 0) + 1;

            const recoveryPromise = (async () => {
                try {
                    // Riffy calls stop() immediately after emitting this event.
                    // Let that stop finish before migrating or starting again.
                    await new Promise(resolve => setTimeout(resolve, 0));
                    if (
                        player.__trackStuckRecoveryVersion !== recoveryVersion ||
                        player.__manualStop ||
                        player.__recoveringTrackError
                    ) return;

                    await migratePlayerForRecovery(player, 'stuck track');
                    if (
                        player.__trackStuckRecoveryVersion !== recoveryVersion ||
                        player.__manualStop ||
                        player.__recoveringTrackError
                    ) return;

                    // If there are queued tracks, start the next one instead
                    // of leaving the player silent on an unhealthy node.
                    if (player.queue.length > 0) {
                        await player.play();
                        return;
                    }

                    // Retry the same song once after moving to another healthy
                    // node. Replaying it repeatedly on a degraded node causes
                    // the short stop/start loop users hear as choppy audio.
                    if (track && typeof track === 'object' && !stuckTrackRetries.has(track)) {
                        stuckTrackRetries.add(track);
                        player.queue.unshift(track);
                        await player.play();
                        return;
                    }

                    if (player.__trackStuckAttempts < 3 && track) {
                        const title = String(trackInfo.title || '').trim();
                        const author = String(trackInfo.author || '').trim();
                        const requester = track.requester || trackInfo.requester;
                        const searchPlatform = client.riffy.options?.defaultSearchPlatform || 'ytsearch';
                        const searchTerms = [
                            [title, author].filter(Boolean).join(' '),
                            `${title} official audio`,
                            title
                        ].filter(Boolean);
                        const candidates = [];

                        for (const terms of searchTerms) {
                            const result = await withNodeTimeout(
                                client.riffy.resolve({
                                    query: terms,
                                    source: searchPlatform,
                                    requester,
                                    node: player.node
                                }),
                                12000
                            );
                            const matches = result?.tracks?.filter(candidate => (
                                candidate?.info?.identifier &&
                                candidate.info.identifier !== trackInfo.identifier &&
                                candidate.info.uri !== trackInfo.uri &&
                                !candidates.some(existing =>
                                    existing.info?.identifier === candidate.info.identifier
                                )
                            )) || [];
                            candidates.push(...matches);
                            if (candidates.length >= 3) break;
                        }

                        for (const candidate of candidates.slice(0, 3).reverse()) {
                            candidate.requester = requester;
                            if (candidate.info) candidate.info.requester = requester;
                            player.queue.unshift(candidate);
                        }

                        if (candidates.length > 0) {
                            await player.play();
                            return;
                        }
                    }

                    console.warn(`[V2 TRACK STUCK] Recovery exhausted in guild ${guildId}`);
                    const channel = client.channels.cache.get(player.textChannel);
                    if (channel) {
                        const errorContainer = advancedMessageManager.createV2Container('error')
                            .addTextDisplayComponents(textDisplay =>
                                textDisplay.setContent(
                                    `**❌ PLAYBACK INTERRUPTED**\n\n**${trackInfo.title || 'This track'}** repeatedly stalled, even after switching Lavalink servers.\n\n*Try another version or start playback again in a moment.*`
                                )
                            );
                        const errorMsg = await channel.send({
                            components: [errorContainer],
                            flags: MessageFlags.IsComponentsV2
                        });
                        advancedMessageManager.addQuickDeleteMessage(client, errorMsg, 'error');
                    }
                    await handlePlayerCleanup(client, guildId, player, 'Track stalled repeatedly');
                    player.destroy();
                } catch (retryError) {
                    console.error(`[V2 TRACK STUCK] Recovery failed in guild ${guildId}:`, retryError);
                    if (player.__trackStuckRecoveryVersion === recoveryVersion && !player.__recoveringTrackError) {
                        await handlePlayerCleanup(client, guildId, player, 'Track stall recovery failed');
                        player.destroy();
                    }
                }
            })().finally(() => {
                if (player.__trackStuckRecoveryVersion === recoveryVersion) {
                    player.__recoveringTrackStuck = false;
                }
                if (player.__trackStuckRecoveryPromise === recoveryPromise) {
                    player.__trackStuckRecoveryPromise = null;
                }
            });
            player.__trackStuckRecoveryPromise = recoveryPromise;
        });

        client.riffy.on('trackError', async (player, track, error) => {
            const exception = error?.exception || error || {};
            const errorMessage = exception.message || exception.cause || error?.message || 'Unknown Lavalink error';
            const trackInfo = track?.info || {};
            const guildId = player.guildId;
            const channel = client.channels.cache.get(player.textChannel);

            if (player.__manualStop || player.__recoveringTrackError) return;
            if (track && typeof track === 'object' && trackErrorRetries.has(track)) return;
            if (track && typeof track === 'object') trackErrorRetries.add(track);
            // Set this before any await so queueEnd cannot start autoplay while
            // the failed source is being recovered.
            player.__trackStuckRecoveryVersion = (player.__trackStuckRecoveryVersion || 0) + 1;
            player.__recoveringTrackStuck = false;
            player.__recoveringTrackError = true;
            clearTimeout(player.__trackRecoveryTimeout);
            player.__trackRecoveryTimeout = setTimeout(() => {
                if (!player.__recoveringTrackError) return;
                console.warn(`[V2 TRACK ERROR] Recovery timed out in guild ${guildId}`);
                player.destroy();
            }, 45000);
            player.__trackRecoveryTimeout.unref?.();

            console.error(`V2 Track error in guild ${guildId}:`, {
                message: errorMessage,
                severity: exception.severity,
                cause: exception.cause,
                identifier: trackInfo.identifier,
                source: trackInfo.sourceName
            });

            // Lavalink can emit TrackStart before the source stream is
            // rejected. Remove the stale "Active" panel immediately so it
            // does not claim that silent audio is still playing.
            await advancedMessageManager.cleanupGuildMessages(client, guildId, ['track']);

            if ((player.__trackRecoveryAttempts || 0) >= 5) {
                if (channel) {
                    const exhaustedContainer = advancedMessageManager.createV2Container('error')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent(
                                `**❌ TRACK COULD NOT START**\n\nYouTube rejected **${trackInfo.title || 'this track'}** and the playback retries are exhausted.\n\n*Try a different version, live upload, or remix.*`
                            )
                        );
                    const exhaustedMsg = await channel.send({
                        components: [exhaustedContainer],
                        flags: MessageFlags.IsComponentsV2
                    });
                    advancedMessageManager.addQuickDeleteMessage(client, exhaustedMsg, 'error');
                }

                player.destroy();
                return;
            }
            player.__trackRecoveryAttempts = (player.__trackRecoveryAttempts || 0) + 1;

            // If another track is already queued, let the active player move
            // forward instead of creating another voice connection.
            if (player.queue.length > 0) {
                if (channel) {
                    const skipContainer = advancedMessageManager.createV2Container('warning')
                        .addTextDisplayComponents(
                            textDisplay => textDisplay.setContent(
                                `**⚠️ TRACK SKIPPED**\n\n**${trackInfo.title || 'Unknown track'}** could not be streamed.\n\n*Moving to the next queued track...*`
                            )
                        );

                    const skipMsg = await channel.send({
                        components: [skipContainer],
                        flags: MessageFlags.IsComponentsV2
                    });

                    advancedMessageManager.addQuickDeleteMessage(client, skipMsg, 'error');
                }

                setTimeout(async () => {
                    try {
                        await migratePlayerForRecovery(player, 'queued track error');

                        if (!client.riffy.players.has(guildId)) return;

                        // After a load failure Riffy already starts the next
                        // queued track by itself. Calling play() again here
                        // threw "Queue is empty" and the catch below then
                        // destroyed a player that was already playing the
                        // replacement track.
                        const alreadyAdvanced = player.playing &&
                            player.current &&
                            player.current !== track;
                        if (alreadyAdvanced) return;

                        if (!player.queue.length) {
                            if (!player.playing) player.destroy();
                            return;
                        }

                        await player.play();
                    } catch (playError) {
                        console.error(`[V2 TRACK ERROR] Queue recovery failed in guild ${guildId}:`, playError);
                        // Never kill a player that has already moved on.
                        if (!player.playing) player.destroy();
                    }
                }, 0);
                return;
            }

            // A single resolved YouTube result can still fail at stream time
            // because YouTube requires login, blocks the client, or exposes no
            // audio format. Search for another result using the same player.
            if (
                !track ||
                typeof track !== 'object'
            ) {
                player.destroy();
                return;
            }

            if (channel) {
                const retryContainer = advancedMessageManager.createV2Container('warning')
                    .addTextDisplayComponents(
                        textDisplay => textDisplay.setContent(
                            `**⚠️ TRACK UNAVAILABLE**\n\n**${trackInfo.title || 'Unknown track'}** could not be streamed by YouTube.\n\n*Searching for another playable version...*`
                        )
                    );

                const retryMsg = await channel.send({
                    components: [retryContainer],
                    flags: MessageFlags.IsComponentsV2
                });

                advancedMessageManager.addQuickDeleteMessage(client, retryMsg, 'error');
            }

            setTimeout(async () => {
                try {
                    await migratePlayerForRecovery(player, 'track error');

                    const title = String(trackInfo.title || '').trim();
                    const author = String(trackInfo.author || '').trim();
                    const searchTerms = [
                        [title, author].filter(Boolean).join(' '),
                        `${title} official audio`,
                        title
                    ].filter(Boolean);
                    const failedIdentifier = trackInfo.identifier;
                    const failedUri = trackInfo.uri;
                    const youtubeCandidates = [];
                    const fallbackCandidates = [];
                    const searchPlatform = client.riffy.options?.defaultSearchPlatform || 'ytsearch';
                    const requester = track.requester || track.info?.requester;

                    const collectCandidates = async (terms, source, bucket, limit) => {
                        try {
                            const result = await client.riffy.resolve({
                                query: terms,
                                source,
                                requester,
                                node: player.node
                            });

                            for (const candidate of result?.tracks || []) {
                                const info = candidate?.info || {};
                                if (
                                    !info.identifier ||
                                    info.identifier === failedIdentifier ||
                                    info.uri === failedUri ||
                                    youtubeCandidates.some(c => c.info?.identifier === info.identifier) ||
                                    fallbackCandidates.some(c => c.info?.identifier === info.identifier)
                                ) continue;
                                bucket.push(candidate);
                                if (bucket.length >= limit) break;
                            }
                        } catch (searchError) {
                            console.warn(`[V2 TRACK ERROR] ${source} search failed for "${terms}":`, searchError.message);
                        }
                    };

                    for (const terms of searchTerms) {
                        if (youtubeCandidates.length >= 2) break;
                        await collectCandidates(terms, searchPlatform, youtubeCandidates, 2);
                    }

                    // When YouTube refuses to stream (login/bot checks), more
                    // YouTube results usually fail the same way. Add
                    // SoundCloud results so recovery has a different source.
                    for (const terms of [[title, author].filter(Boolean).join(' '), title].filter(Boolean)) {
                        if (fallbackCandidates.length >= 3) break;
                        await collectCandidates(terms, 'scsearch', fallbackCandidates, 3);
                    }

                    const candidates = [...youtubeCandidates, ...fallbackCandidates].slice(0, 5);

                    if (!candidates.length) {
                        throw new Error('No alternative playable result found');
                    }

                    // Queue several alternatives. If Lavalink rejects the
                    // first replacement too, trackError will naturally move
                    // to the next candidate instead of leaving a silent voice
                    // connection.
                    for (const candidate of candidates.slice(0, 5).reverse()) {
                        candidate.requester = requester;
                        if (candidate.info) candidate.info.requester = requester;
                        player.queue.unshift(candidate);
                    }

                    await player.play();
                } catch (recoveryError) {
                    console.error(`[V2 TRACK ERROR] Alternative search failed in guild ${guildId}:`, recoveryError);

                    if (channel) {
                        const failContainer = advancedMessageManager.createV2Container('error')
                            .addTextDisplayComponents(
                                textDisplay => textDisplay.setContent(
                                    `**❌ TRACK SKIPPED**\n\nYouTube did not provide a playable audio stream for **${trackInfo.title || 'this track'}**.\n\n*Try another version, live upload, or remix of this song.*`
                                )
                            );

                        const failMsg = await channel.send({
                            components: [failContainer],
                            flags: MessageFlags.IsComponentsV2
                        });

                        advancedMessageManager.addQuickDeleteMessage(client, failMsg, 'error');
                    }

                    player.destroy();
                }
            }, 0);
        });

        const cleanupOrphanedResources = async () => {
            try {
                const guildsWithResources = new Set([
                    ...advancedMessageManager.trackMessages.keys(),
                    ...advancedMessageManager.lyricsMessages.keys(),
                    ...advancedMessageManager.queueMessages.keys(),
                    ...advancedMessageManager.lastEmbeds.keys(),
                    ...lyricIntervals.keys(),
                    ...queueDisplayTimeouts.keys(),
                    ...sessionManager.activeSessions.keys(),
                    ...lyricsStateManager.activeGuilds.keys()
                ]);

                for (const guildId of guildsWithResources) {
                    if (!client.riffy.players.has(guildId)) {
                        await handlePlayerCleanup(client, guildId, null, 'Orphaned resource cleanup');
                    }
                }

                //console.log(`V2 Cleanup completed for ${guildsWithResources.size} guilds`);
            } catch (error) {
                //console.error("V2 Cleanup routine error:", error);
            }
        };

        setInterval(cleanupOrphanedResources, 3 * 60 * 1000);

        client.on('error', async (error) => {
            // A Discord client error does not reliably identify the affected
            // guild. Never destroy every guild's player from this global event:
            // an isolated voice failure in one guild would disconnect all
            // other active music sessions as well.
            console.error('V2 Client error:', error);
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('V2 Unhandled Rejection at:', promise, 'reason:', reason);
        });

        process.on('uncaughtException', (error) => {
            console.error('V2 Uncaught Exception:', error);
        });

        client.on('raw', d => client.riffy.updateVoiceState(d));

        const initializeRiffy = async () => {
            try {
                if (!client.isReady()) {
                    //console.log('\x1b[33m[ V2 LAVALINK ]\x1b[0m Waiting for client to be ready...');
                    await new Promise(resolve => client.once('ready', resolve));
                }

                //console.log('\x1b[34m[ V2 LAVALINK ]\x1b[0m Client ready, initializing Riffy...');
                
              
                client.riffy.init(client.user.id);
                
                //console.log('\x1b[34m[ V2 LAVALINK ]\x1b[0m Riffy.init() called, waiting for node connection...');

              
                await Promise.race([
                    new Promise((resolve) => {
                        client.riffy.once('nodeConnect', resolve);
                    }),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Node connection timeout after 15 seconds')), 15000)
                    )
                ]);

                console.log('\x1b[35m[ V2 MUSIC ]\x1b[0m', '\x1b[32mAdvanced V2 Music System Active ✅\x1b[0m');

            
                setTimeout(async () => {
                    try {
                        for (const guild of client.guilds.cache.values()) {
                            await advancedMessageManager.cleanupGuildMessages(client, guild.id);
                        }
                        //console.log('\x1b[34m[ V2 LAVALINK ]\x1b[0m Initial cleanup completed');
                    } catch (cleanupError) {
                        console.error('\x1b[33m[ V2 LAVALINK ]\x1b[0m Cleanup error:', cleanupError.message);
                    }
                }, 5000);

            } catch (error) {
                console.error('\x1b[31m[ V2 LAVALINK ]\x1b[0m Initialization failed:', error.message);
                console.error('\x1b[31m[ V2 LAVALINK ]\x1b[0m Stack:', error.stack);

                console.log('\x1b[33m[ V2 LAVALINK ]\x1b[0m Checking every configured node over REST (credentials are not logged)...');
                await Promise.all(nodes.map(async node => {
                    const testUrl = `http${node.secure ? 's' : ''}://${node.host}:${node.port}/version`;
                    try {
                        const response = await axios.get(testUrl, {
                            headers: { Authorization: node.password },
                            timeout: 5000
                        });
                        console.log(
                            `\x1b[32m[ V2 LAVALINK ]\x1b[0m REST probe succeeded for ${node.name} (${node.host}:${node.port}): HTTP ${response.status}.`
                        );
                    } catch (testError) {
                        const failure = testError.response?.status
                            ? `HTTP ${testError.response.status}`
                            : `${testError.code || testError.name || 'Error'}: ${testError.message}`;
                        console.error(
                            `\x1b[31m[ V2 LAVALINK ]\x1b[0m REST probe failed for ${node.name} (${node.host}:${node.port}): ${failure}.`
                        );
                    }
                }));
            }
        };

       
        initializeRiffy();
    } else {
        console.log('\x1b[31m[ V2 MUSIC ]\x1b[0m Lavalink Music System Disabled ❌');
    }
};
