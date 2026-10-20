const { PermissionFlagsBits } = require('discord.js');
const { getSpotifyTrackQueries, parseSpotifyUrl } = require('../../utils/spotifyTracks');
const { maximizeVoiceChannelBitrate } = require('../../utils/voiceQuality');
const {
    getRiffyQueuePosition,
    startRiffyPlayerAndWaitForStart
} = require('../../utils/riffyPlayback');
const { releaseVoiceOnlyConnection } = require('../../utils/voiceStay');

function temporaryReply(message, content, timeout = 6000) {
    return message.reply(content).then(reply => {
        setTimeout(() => reply.delete().catch(() => {}), timeout);
        return reply;
    });
}

function withTimeout(promise, timeoutMs, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const guildPlayLocks = new Map();
const nodeHealthCache = new WeakMap();
let nodeResolutionQueue = Promise.resolve();

function withGuildPlayLock(guildId, task) {
    const previous = guildPlayLocks.get(guildId) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    guildPlayLocks.set(guildId, current);

    return current.finally(() => {
        if (guildPlayLocks.get(guildId) === current) {
            guildPlayLocks.delete(guildId);
        }
    });
}

function destroyGuildPlayer(client, guildId) {
    const player = client.riffy?.players.get(guildId);
    if (!player) return;

    try {
        player.__manualStop = true;
        player.destroy();
    } catch (error) {
        console.warn(`[RIFFY] Could not destroy stale player for ${guildId}:`, error.message);
    }

    if (client.riffy.players.get(guildId) === player) {
        client.riffy.players.delete(guildId);
    }
}

function withNodeResolutionLock(task) {
    const run = nodeResolutionQueue.then(task);
    nodeResolutionQueue = run.catch(() => {});
    return run;
}

function markNodeUnhealthy(node, error) {
    if (!node) return;

    nodeHealthCache.set(node, {
        healthy: false,
        checkedAt: Date.now(),
        error: error?.message || String(error || 'Unknown node failure')
    });
}

function getNodeLoadScore(node, stats) {
    const cpu = stats?.cpu?.systemLoad ?? stats?.cpu?.lavalinkLoad ?? 0;
    const playing = stats?.playingPlayers ?? 0;
    const deficit = stats?.frameStats?.deficit ?? 0;
    const nulled = stats?.frameStats?.nulled ?? 0;
    // Lower is better. Dropped audio frames (deficit/nulled) are what
    // listeners hear as stuttering, so they dominate the score.
    return deficit * 3 + nulled + cpu * 100 + playing * 2;
}

function isNodeStruggling(stats) {
    if (!stats) return false;
    const deficit = stats.frameStats?.deficit ?? 0;
    const systemLoad = stats.cpu?.systemLoad ?? 0;
    // A node dropping a meaningful share of audio frames per minute, or
    // running near CPU saturation, will stutter no matter what we send it.
    return deficit > 1000 || systemLoad > 0.95;
}

function logNodeHealthSnapshot(client, reason) {
    const nodes = [...(client.riffy?.nodeMap?.values() || [])];
    if (!nodes.length) {
        console.warn(`[RIFFY] ${reason}: Riffy has no configured nodes in nodeMap.`);
        return;
    }

    const summary = nodes.map(node => {
        const cachedHealth = nodeHealthCache.get(node);
        const state = node.connected ? 'connected' : 'disconnected';
        const failure = cachedHealth?.error ? `; last health error: ${cachedHealth.error}` : '';
        return `${node.name} (${node.host}:${node.port}, ${state}${failure})`;
    });

    console.warn(`[RIFFY] ${reason}: ${summary.join(' | ')}`);
}

async function checkNodeHealth(node) {
    if (!node?.connected || !node.rest?.getStats) return false;

    const cached = nodeHealthCache.get(node);
    if (cached && Date.now() - cached.checkedAt < 30000) {
        return cached.healthy;
    }

    try {
        const stats = await withTimeout(
            node.rest.getStats(),
            5000,
            `Lavalink node health check (${node.name})`
        );
        if (isNodeStruggling(stats)) {
            markNodeUnhealthy(node, new Error('Node is dropping audio frames (overloaded)'));
            console.warn(`[RIFFY] Node ${node.name} is overloaded (audio frame deficit), skipping it`);
            return false;
        }
        nodeHealthCache.set(node, {
            healthy: true,
            checkedAt: Date.now(),
            score: getNodeLoadScore(node, stats)
        });
        return true;
    } catch (error) {
        markNodeUnhealthy(node, error);
        console.warn(`[RIFFY] Node ${node.name} failed health check:`, error.message);
        return false;
    }
}

async function waitForHealthyNode(client, timeoutMs = 15000, excludedNodes = new Set()) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const candidates = (client.riffy?.leastUsedNodes || [])
            .filter(node => !excludedNodes.has(node));

        const healthy = [];
        for (const node of candidates) {
            if (await checkNodeHealth(node)) healthy.push(node);
        }

        if (healthy.length) {
            // Pick the least-loaded healthy node: fewest dropped audio
            // frames first, then CPU load, then active players. REST call
            // count says nothing about audio quality, so it is not used.
            healthy.sort((a, b) =>
                (nodeHealthCache.get(a)?.score ?? 0) - (nodeHealthCache.get(b)?.score ?? 0)
            );
            return healthy[0];
        }

        await new Promise(resolve => setTimeout(resolve, 250));
    }

    logNodeHealthSnapshot(client, 'No healthy Lavalink node was found');
    throw new Error('No healthy Lavalink nodes are available');
}

function isUsablePlayer(player, voiceChannelId) {
    return Boolean(
        player &&
        player.voiceChannel === voiceChannelId &&
        player.connected &&
        player.node?.connected
    );
}

function getPlaybackFailureMessage(error) {
    const message = String(error?.message || error || '').toLowerCase();

    if (message.includes('no lavalink nodes')) {
        return 'Tidak ada server Lavalink yang sedang online.';
    }

    if (message.includes('no healthy lavalink nodes')) {
        return 'Tidak ada node Lavalink yang merespons dengan sehat. Periksa status node di Railway Console dan pastikan alamat serta password node masih berlaku.';
    }

    if (message.includes('track search')) {
        return 'Server Lavalink tidak merespons pencarian lagu.';
    }

    if (message.includes('player connection is not initiated')) {
        return 'Koneksi player musik ke voice belum siap. `.join` hanya menghubungkan bot; gunakan `.play <lagu>` untuk memulai musik, lalu coba lagi setelah beberapa detik.';
    }

    if (message.includes('lavalink playback')) {
        return 'Server Lavalink tidak merespons saat memulai audio.';
    }

    if (message.includes('timed out') || message.includes('timeout')) {
        return 'Koneksi voice atau Lavalink belum siap. Tunggu beberapa detik lalu coba lagi.';
    }

    if (message.includes('no matches') || message.includes('load failed')) {
        return 'Lavalink tidak dapat menemukan atau memuat lagu tersebut.';
    }

    return 'Server musik gagal memproses lagu tersebut. Coba lagi sebentar lagi.';
}

module.exports = {
    async execute(message, args, client) {
        const query = args.join(' ').trim();
        if (!query) {
            return temporaryReply(message, '❌ Please provide a song name or URL.\nExample: `.play royalty`');
        }

        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) {
            return temporaryReply(message, '❌ Join a voice channel first, then use `.play <song>`.');
        }

        const botVoiceChannel = message.guild.members.me?.voice?.channel;
        if (botVoiceChannel && botVoiceChannel.id !== voiceChannel.id) {
            return temporaryReply(message, '❌ I am already playing music in another voice channel.');
        }

        const permissions = voiceChannel.permissionsFor(client.user);
        if (
            !permissions?.has(PermissionFlagsBits.ViewChannel) ||
            !permissions?.has(PermissionFlagsBits.Connect) ||
            !permissions.has(PermissionFlagsBits.Speak)
        ) {
            return temporaryReply(message, '❌ I need **View Channel**, **Connect**, and **Speak** permission in that voice channel.');
        }

        if (!client.riffy) {
            return temporaryReply(message, '❌ The music system is not ready yet. Please try again shortly.');
        }

        const guildId = message.guild.id;

        return withGuildPlayLock(guildId, async () => {
        const parsedSpotify = parseSpotifyUrl(query);
        let spotifyRequest = parsedSpotify
            ? { ...parsedSpotify, name: null, queries: [], partial: false }
            : null;
        if (parsedSpotify) {
            try {
                const metadataRequest = await getSpotifyTrackQueries(query);
                if (metadataRequest) spotifyRequest = metadataRequest;
            } catch (error) {
                // A private link or a failed public metadata request can still
                // be playable by a Lavalink node with Spotify support.
                console.warn('Spotify metadata lookup failed; trying Lavalink directly:', error.message);
            }
        }

            const createPlayer = (node) => {
                // Hand off a voice-only /join connection before Riffy
                // establishes its own player connection for playback.
                releaseVoiceOnlyConnection(client, guildId);
                return withTimeout(
                    client.riffy.createPlayer(node, {
                        guildId,
                        voiceChannel: voiceChannel.id,
                        textChannel: message.channel.id,
                        deaf: true
                    }),
                    15000,
                    'Lavalink voice connection'
                );
            };

            const resolveTrack = (node, searchQuery = query) => withNodeResolutionLock(async () => {
                return withTimeout(
                    client.riffy.resolve({
                        query: searchQuery,
                        requester: message.author,
                        node
                    }),
                    20000,
                    'Track search'
                );
            });

            let lastAttemptNode = null;
            const playAttempt = async (forceFresh, excludedNodes) => {
                lastAttemptNode = null;

                if (forceFresh) {
                    destroyGuildPlayer(client, guildId);
                }

                let player = client.riffy.players.get(guildId);
                if (isUsablePlayer(player, voiceChannel.id) && await checkNodeHealth(player.node)) {
                    lastAttemptNode = player.node;
                } else {
                    if (player) destroyGuildPlayer(client, guildId);
                    lastAttemptNode = await waitForHealthyNode(client, 15000, excludedNodes);
                    player = await createPlayer(lastAttemptNode);
                }

                const queries = spotifyRequest?.queries?.length
                    ? spotifyRequest.queries
                    : [query];
                const tracks = [];
                let lastTrackError = null;
                let startedPlayback = false;
                const playbackRequired = !player.paused && !(player.current && player.playing);
                let firstQueuePosition = null;
                const addTrackAndStart = async (track) => {
                    track.requester = {
                        id: message.author.id,
                        username: message.author.username,
                        avatarURL: message.author.displayAvatarURL()
                    };
                    if (track.info) track.info.requester = message.author;
                    if (firstQueuePosition === null) {
                        firstQueuePosition = getRiffyQueuePosition(player);
                    }
                    tracks.push(track);
                    player.queue.add(track);

                    // Do not wait for the rest of a large playlist before
                    // starting audio. TrackStart (and the now-playing
                    // panel) should happen as soon as the first result
                    // is available; remaining results can fill the queue.
                    if (
                        !startedPlayback &&
                        !player.paused &&
                        (!player.current || !player.playing)
                    ) {
                        await startRiffyPlayerAndWaitForStart(player, client.riffy, 20000);
                        startedPlayback = true;
                    }
                };

                // Prefer Lavalink's native Spotify loader. Nodes with the
                // Spotify source plugin can return the complete collection
                // (including 100+ tracks), unlike public page metadata which
                // is commonly limited to eight preview items.
                if (spotifyRequest?.type === 'playlist' || spotifyRequest?.type === 'album') {
                    try {
                        const collectionResult = await resolveTrack(lastAttemptNode, query);
                        if (
                            collectionResult?.loadType === 'playlist' &&
                            collectionResult.tracks?.length
                        ) {
                            spotifyRequest = {
                                ...spotifyRequest,
                                name: collectionResult.playlistInfo?.name || spotifyRequest.name,
                                partial: false
                            };
                            for (const track of collectionResult.tracks) {
                                await addTrackAndStart(track);
                            }
                            return { player, track: tracks[0], tracks, firstQueuePosition };
                        }
                    } catch (error) {
                        console.warn('[RIFFY] Native Spotify collection load failed; using track fallback:', error.message);
                    }
                }

                for (const searchQuery of queries) {
                    try {
                        const result = await resolveTrack(lastAttemptNode, searchQuery);
                        if (result?.tracks?.length) {
                            await addTrackAndStart(result.tracks[0]);
                        }
                    } catch (error) {
                        lastTrackError = error;
                        console.warn(`[RIFFY] Could not search or start "${searchQuery}":`, error.message);
                    }
                }

                if (!tracks.length && lastTrackError) throw lastTrackError;
                if (playbackRequired && tracks.length && !startedPlayback) {
                    throw lastTrackError || new Error('Lavalink did not confirm that playback started');
                }
                if (!tracks.length) return { player, track: null, tracks };

                return { player, track: tracks[0], tracks, firstQueuePosition };
            };

            try {
                const failedNodes = new Set();
                let result = null;
                let lastError = null;

                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        result = await playAttempt(attempt > 0, failedNodes);
                        lastError = null;
                        break;
                    } catch (attemptError) {
                        lastError = attemptError;

                        if (lastAttemptNode) {
                            failedNodes.add(lastAttemptNode);
                            markNodeUnhealthy(lastAttemptNode, attemptError);
                            console.warn(
                                `[RIFFY] Playback attempt ${attempt + 1} failed on ${lastAttemptNode.name}:`,
                                attemptError.message
                            );
                        } else {
                            console.warn(
                                `[RIFFY] Playback attempt ${attempt + 1} failed before node selection:`,
                                attemptError.message
                            );
                        }

                        destroyGuildPlayer(client, guildId);
                    }
                }

                if (!result) {
                    throw lastError || new Error('Playback failed after node failover attempts');
                }

                if (!result.track) {
                    return temporaryReply(message, `❌ No tracks found for **${query}**.`);
                }

                const position = result.firstQueuePosition ?? 0;
                const addedCount = result.tracks?.length || 1;
                const collectionLabel = spotifyRequest?.type === 'album' ? 'album' : 'playlist';
                const partialWarning = spotifyRequest?.partial
                    ? '\n⚠️ Metadata publik Spotify hanya mengembalikan sebagian lagu. Tambahkan SPOTIFY_CLIENT_ID dan SPOTIFY_CLIENT_SECRET agar seluruh isi dimuat.'
                    : '';
                const confirmation = spotifyRequest
                    ? `🎵 Spotify ${collectionLabel} **${spotifyRequest.name}** ditambahkan ke queue.\n✅ **${addedCount}** lagu berhasil ditambahkan.\n📍 Lagu pertama mulai di posisi: **#${position}**${partialWarning}`
                    : `🎵 Added **${result.track.info.title}** to the queue.\n📍 Position: **#${position}**`;
                try {
                    const reply = await message.reply(confirmation);
                    setTimeout(() => reply.delete().catch(() => {}), 6000);
                } catch (replyError) {
                    // A Discord reply failure must not be reported as a
                    // playback failure or destroy a song that already started.
                    console.warn('[RIFFY] Playback started, but the queue confirmation could not be sent:', replyError.message);
                }
            } catch (error) {
                console.error('Prefix music play error:', error);
                destroyGuildPlayer(client, guildId);
                return temporaryReply(
                    message,
                    `❌ Saya tidak bisa memutar lagu itu.\n${getPlaybackFailureMessage(error)}\n\nCoba lagi setelah beberapa detik.`
                );
            }
        });
    }
};