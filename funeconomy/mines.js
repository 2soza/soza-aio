const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const cfg = require('./config');
const cooldown = require('./cooldown');
const Mines = require('../models/funeconomy/mines');
const Economy = require('../models/funeconomy/economy');
const { ensureRegistered } = require('./register');
const {
    BOARD_SIZE, payoutFor, generateMinePositions, parseMineCount
} = require('./minesMath');
const {
    fmt, displayName, send, sendTemporaryError, resolveBet, errorLine,
    acquireGambleLock, releaseGambleLock, onCooldown
} = require('./utils');

const BUTTON_PREFIX = 'fmn';
const TERMINAL_STATES = new Set(['lost', 'cashed_out']);
const QUESTION_TILE_LABEL = '\u2002?\u2002';

function formatMultiplier(value) {
    return `${value.toFixed(2)}x`;
}

function render(game, userId) {
    const picks = game.revealed.length;
    const currentPayout = picks ? payoutFor(game.bet, game.mineCount, picks) : 0;
    const currentAmount = game.status === 'cashed_out' ? game.payout : currentPayout;
    const nextPayout = picks < BOARD_SIZE - game.mineCount
        ? payoutFor(game.bet, game.mineCount, picks + 1)
        : null;
    const ended = TERMINAL_STATES.has(game.status);

    let heading;
    if (game.status === 'lost') {
        heading = `### 💥 **<@${userId}> touched a mine!**`;
    } else if (game.status === 'cashed_out') {
        heading = `### 💎 **<@${userId}> cashed out!**`;
    } else if (picks === 0) {
        heading = `### 💣 **<@${userId}> started a mines game.**`;
    } else {
        heading = `### 💣 **<@${userId}> is playing a mines game.**`;
    }

    const currentLabel = game.status === 'cashed_out' ? 'Winnings' : 'Cash Out';
    const currentLine = `**${currentLabel}:** \`${fmt(currentAmount)}\` \`(${formatMultiplier(currentAmount / game.bet)})\``;
    const nextValue = nextPayout === null
        ? '—'
        : `\`${fmt(nextPayout)}\` \`(${formatMultiplier(nextPayout / game.bet)})\``;
    const nextLine = `**Next:** ${nextValue}`;
    const summary = [
        `-# **Bet:** \`${fmt(game.bet)}\`　 **Mines:** \`${game.mineCount}\``,
        game.status === 'lost' ? `-# ~~${currentLine}~~` : `-# ${currentLine}`,
        ended ? `-# ~~${nextLine}~~` : `-# ${nextLine}`
    ].join('\n');

    const accentColor = game.status === 'lost'
        ? 0x7a7a7a
        : picks > 0 || game.status === 'cashed_out'
            ? 0x2ee820
            : 0x7ab8f5;

    const container = new ContainerBuilder()
        .setAccentColor(accentColor)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(heading))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(summary))
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );

    const mines = new Set(game.minePositions);
    const safeTiles = new Set(game.revealed);
    for (let rowIndex = 0; rowIndex < 3; rowIndex += 1) {
        const row = new ActionRowBuilder();
        for (let column = 0; column < 3; column += 1) {
            const index = rowIndex * 3 + column;
            const isMine = mines.has(index);
            const isSafe = safeTiles.has(index);
            const isHitMine = game.status === 'lost' && game.hitPosition === index;
            const button = new ButtonBuilder()
                .setCustomId(`${BUTTON_PREFIX}:tile:${game.userId}:${index}`)
                .setStyle(isHitMine ? ButtonStyle.Danger : isSafe ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(ended || isSafe);

            if (isMine && ended) button.setEmoji(isHitMine ? '💥' : '💣');
            else if (isSafe || ended) button.setEmoji('💎');
            else button.setEmoji('<:tile_question:1564474304257720361>');
            row.addComponents(button);
        }
        container.addActionRowComponents(row);
    }

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    const cashOut = new ButtonBuilder()
        .setCustomId(`${BUTTON_PREFIX}:cash:${game.userId}`)
        .setLabel('Cash Out')
        .setEmoji(cfg.CASH_EMOJI)
        .setStyle(ButtonStyle.Success)
        .setDisabled(ended || picks === 0);
    container.addActionRowComponents(new ActionRowBuilder().addComponents(cashOut));

    return container;
}

function buildComponents(game) {
    return [render(game, game.userId)];
}

function boardMessageOptions(game) {
    return {
        components: buildComponents(game),
        allowedMentions: { parse: [] }
    };
}

async function retireOldMessage(client, game) {
    if (!game.channelId || !game.messageId) return;
    try {
        const channel = await client.channels.fetch(game.channelId);
        const oldMessage = await channel?.messages?.fetch(game.messageId);
        await oldMessage?.edit({ components: [] });
    } catch {
        // A deleted or inaccessible previous message does not prevent resuming the saved game.
    }
}

async function postBoard(message, game, client) {
    const sent = await message.channel.send({
        ...boardMessageOptions(game),
        flags: MessageFlags.IsComponentsV2,
    });
    const attached = await Mines.findOneAndUpdate(
        { _id: game._id, userId: game.userId, status: 'playing', version: game.version },
        { $set: { channelId: message.channel.id, messageId: sent.id } },
        { new: true }
    ).lean();

    if (!attached) {
        await sent.edit({ components: [] }).catch(() => {});
        return false;
    }
    await retireOldMessage(client, game);
    return true;
}

/** Complete a pending stake once; the account marker protects against retry charges. */
async function prepareGame(userId, game) {
    if (game.status !== 'pending') return game;

    const debited = await Economy.deductMinesBet(userId, game._id, game.bet);
    if (!debited) {
        await Mines.deleteOne({ _id: game._id, userId, status: 'pending' });
        return null;
    }

    return await Mines.findOneAndUpdate(
        { _id: game._id, userId, status: 'pending' },
        { $set: { status: 'playing' }, $inc: { version: 1 } },
        { new: true }
    ).lean() || await Mines.findOne({ _id: game._id, userId }).lean();
}

/** Idempotently credit a finished cash-out, then remove the active session. */
async function completeGame(game) {
    const finalGame = await Mines.findOne({ _id: game._id, userId: game.userId }).lean();
    if (!finalGame || !TERMINAL_STATES.has(finalGame.status)) return finalGame;

    if (finalGame.payout > 0) {
        let credited = false;
        for (let attempt = 1; attempt <= 3 && !credited; attempt += 1) {
            try {
                await Economy.addMinesPayout(finalGame.userId, finalGame._id, finalGame.payout);
                credited = true;
            } catch (error) {
                if (attempt === 3) throw error;
            }
        }
    }

    await Mines.deleteOne({
        _id: finalGame._id,
        userId: finalGame.userId,
        status: finalGame.status
    });
    return finalGame;
}

async function sendCurrentBoard(interaction, game) {
    if (!game) return interaction.editReply({ components: [] });
    if (TERMINAL_STATES.has(game.status)) game = await completeGame(game);
    if (!game) return interaction.editReply({ components: [] });
    return interaction.editReply(boardMessageOptions(game));
}

async function handleButton(interaction) {
    const [, action, ownerId, rawIndex] = interaction.customId.split(':');
    if (!['tile', 'cash'].includes(action) || !ownerId) return;

    if (interaction.user.id !== ownerId) {
        return interaction.reply({
            content: "This isn't your Mines game!",
            flags: MessageFlags.Ephemeral
        });
    }
    if (!acquireGambleLock(ownerId)) {
        return interaction.reply({
            content: 'Your game is already processing an action. Try again in a moment.',
            flags: MessageFlags.Ephemeral
        });
    }

    try {
        const game = await Mines.findOne({ userId: ownerId }).lean();
        if (!game) return interaction.update({ components: [] });
        if (!game.messageId || game.messageId !== interaction.message.id) {
            return interaction.reply({
                content: `This game is on a newer message. Type \`${cfg.PREFIX}mines\` to resume it.`,
                flags: MessageFlags.Ephemeral
            });
        }
        if (!interaction.message.flags.has(MessageFlags.IsComponentsV2)) {
            return interaction.reply({
                content: `This board uses the old layout. Type \`${cfg.PREFIX}mines\` to resume it in the updated layout.`,
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferUpdate();
        let active = game.status === 'pending' ? await prepareGame(ownerId, game) : game;
        if (!active) {
            const failedGame = { ...game, status: 'lost', payout: 0 };
            return interaction.editReply(boardMessageOptions(failedGame));
        }
        if (TERMINAL_STATES.has(active.status)) return sendCurrentBoard(interaction, active);

        const versionFilter = {
            _id: active._id,
            userId: ownerId,
            status: 'playing',
            version: active.version
        };

        if (action === 'cash') {
            if (active.revealed.length === 0) {
                return interaction.followUp({
                    content: 'Reveal a gem before cashing out.',
                    flags: MessageFlags.Ephemeral
                });
            }
            const payout = payoutFor(active.bet, active.mineCount, active.revealed.length);
            const finished = await Mines.findOneAndUpdate(
                versionFilter,
                { $set: { status: 'cashed_out', payout }, $inc: { version: 1 } },
                { new: true }
            ).lean();
            if (!finished) {
                return sendCurrentBoard(interaction, await Mines.findOne({ userId: ownerId }).lean());
            }
            const completed = await completeGame(finished);
            return interaction.editReply(boardMessageOptions(completed));
        }

        const index = Number(rawIndex);
        if (!Number.isInteger(index) || index < 0 || index >= BOARD_SIZE) {
            return interaction.followUp({ content: 'That tile is not valid.', flags: MessageFlags.Ephemeral });
        }
        if (active.revealed.includes(index)) return sendCurrentBoard(interaction, active);

        if (active.minePositions.includes(index)) {
            const finished = await Mines.findOneAndUpdate(
                versionFilter,
                { $set: { status: 'lost', payout: 0, hitPosition: index }, $inc: { version: 1 } },
                { new: true }
            ).lean();
            if (!finished) {
                return sendCurrentBoard(interaction, await Mines.findOne({ userId: ownerId }).lean());
            }
            const completed = await completeGame(finished);
            return interaction.editReply(boardMessageOptions(completed));
        }

        const revealed = [...active.revealed, index];
        const clearedBoard = revealed.length === BOARD_SIZE - active.mineCount;
        const update = clearedBoard
            ? {
                $set: {
                    revealed,
                    status: 'cashed_out',
                    payout: payoutFor(active.bet, active.mineCount, revealed.length)
                },
                $inc: { version: 1 }
            }
            : { $set: { revealed }, $inc: { version: 1 } };
        const updated = await Mines.findOneAndUpdate(versionFilter, update, { new: true }).lean();
        if (!updated) {
            return sendCurrentBoard(interaction, await Mines.findOne({ userId: ownerId }).lean());
        }
        if (clearedBoard) {
            const completed = await completeGame(updated);
            return interaction.editReply(boardMessageOptions(completed));
        }
        return interaction.editReply(boardMessageOptions(updated));
    } catch (error) {
        console.error('[FUNECONOMY] Mines button error:', error);
        const reply = {
            content: `Your game is saved. Try the button again or type \`${cfg.PREFIX}mines\` to resume.`,
            flags: MessageFlags.Ephemeral
        };
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(reply).catch(() => {});
        } else {
            await interaction.reply(reply).catch(() => {});
        }
    } finally {
        releaseGambleLock(ownerId);
    }
}

async function startCommand(message, args, client) {
    if (!(await ensureRegistered(message, client))) return;

    const userId = message.author.id;
    const name = displayName(message);
    if (!acquireGambleLock(userId)) return;

    try {
        let game = await Mines.findOne({ userId }).lean();
        if (game && TERMINAL_STATES.has(game.status)) {
            await completeGame(game);
            game = await Mines.findOne({ userId }).lean();
        }
        if (game) {
            game = await prepareGame(userId, game);
            if (!game) {
                return sendTemporaryError(message, errorLine(name, `you don't have enough ${cfg.CASH_NAME} to start that game!`));
            }
            if (TERMINAL_STATES.has(game.status)) {
                await completeGame(game);
                game = await Mines.findOne({ userId }).lean();
            }
            if (game) {
                return await postBoard(message, game, client)
                    || send(message, errorLine(name, 'your game changed while resuming. Type `smines` again.'));
            }
        }

        if (args.length > 2) {
            return send(message, errorLine(name, 'use `smines <bet|all> [1-8 mines, default 3]`.'));
        }
        const parsedMines = parseMineCount(args[1]);
        if (parsedMines.error) return send(message, errorLine(name, parsedMines.error));

        const balance = await Economy.getCash(userId);
        const { bet, error, insufficientBalance } = resolveBet(args[0], balance);
        if (error) {
            const reply = errorLine(name, error);
            return insufficientBalance ? sendTemporaryError(message, reply) : send(message, reply);
        }
        if (onCooldown(message, 'mines')) return;

        try {
            game = await Mines.create({
                userId,
                bet,
                mineCount: parsedMines.mineCount,
                minePositions: generateMinePositions(parsedMines.mineCount),
                status: 'pending'
            });
            game = game.toObject();
        } catch (error) {
            if (error?.code !== 11000) throw error;
            game = await Mines.findOne({ userId }).lean();
            if (!game) throw error;
            game = await prepareGame(userId, game);
            if (!game) return;
            return await postBoard(message, game, client)
                || send(message, errorLine(name, 'your game changed while resuming. Type `smines` again.'));
        }

        game = await prepareGame(userId, game);
        if (!game) {
            return sendTemporaryError(message, errorLine(name, `you don't have enough ${cfg.CASH_NAME} to start that game!`));
        }
        if (game.status !== 'playing') {
            return send(message, errorLine(name, 'could not start your game. Please try again.'));
        }

        cooldown.start('mines', userId);
        return await postBoard(message, game, client)
            || send(message, errorLine(name, 'your game changed while starting. Type `smines` again.'));
    } finally {
        releaseGambleLock(userId);
    }
}

module.exports = { BUTTON_PREFIX, render, buildComponents, handleButton, startCommand };
