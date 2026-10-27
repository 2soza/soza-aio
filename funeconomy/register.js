const {
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder,
    SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const cfg = require('./config');
const Registration = require('../models/funeconomy/registration');
const { fmt } = require('./utils');

const BUTTON_PREFIX = 'fer';
const COLORS = { prompt: 0x5865f2, done: 0x2ecc71 };
const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';

const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

function buildGetStarted() {
    const p = cfg.PREFIX;
    return [
        '### 🚀 Get Started',
        `\`${p}daily\` · claim your daily ${cfg.CASH_NAME}`,
        `\`${p}cash\` · check your balance`,
        `\`${p}s <bet>\` · \`${p}cf <bet>\` · \`${p}bj <bet>\` · \`${p}mines <bet> [1-3, default 3]\``,
        'Slots, coinflip, blackjack, and Mines'
        `\`${p}lb\` · see the rankings`
    ].join('\n');
}

function buildWelcome({ user, botName, state, result }) {
    const done = state === 'done';
    const avatar = user.displayAvatarURL?.({ extension: 'png', size: 256 }) || DEFAULT_AVATAR;

    const container = new ContainerBuilder()
        .setAccentColor(done ? COLORS.done : COLORS.prompt)
        .addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    text(`<@${user.id}>`),
                    text(done ? `# ✅ Welcome to ${botName}!` : `# 👋 Welcome to ${botName}!`)
                )
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar))
        )
        .addTextDisplayComponents(text(done
            ? '🎉 Your account is now active and ready to use!'
            : 'Activate your account to use the economy commands. It only takes one click!'))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(text(
            `### 🎁 ${done ? 'You Received' : 'You Will Receive'}\n` +
            `${cfg.CASH_EMOJI} **${fmt(cfg.REGISTRATION.BONUS)}** ${cfg.CASH_NAME}`
        ))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(text(buildGetStarted()));

    if (done) {
        const number = result?.accountNumber ? `Account #${fmt(result.accountNumber)} · ` : '';
        container.addTextDisplayComponents(text(`-# ${number}Enjoy ${botName}!`));
    }

    const button = new ButtonBuilder()
        .setCustomId(`${BUTTON_PREFIX}:register:${user.id}`)
        .setLabel(done ? 'Registered' : 'Register')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(done);
    container.addActionRowComponents(new ActionRowBuilder().addComponents(button));

    return container;
}

const lastPrompt = new Map();
const PRUNE_AT = 5000;

async function ensureRegistered(message, client) {
    const userId = message.author.id;
    if (await Registration.isRegistered(userId)) return true;

    const now = Date.now();
    if (now - (lastPrompt.get(userId) ?? 0) < cfg.REGISTRATION.PROMPT_COOLDOWN_MS) return false;
    if (lastPrompt.size >= PRUNE_AT) {
        for (const [id, at] of lastPrompt) {
            if (now - at >= cfg.REGISTRATION.PROMPT_COOLDOWN_MS) lastPrompt.delete(id);
        }
    }
    lastPrompt.set(userId, now);

    try {
        await message.channel.send({
            components: [buildWelcome({ user: message.author, botName: client.user.username, state: 'prompt' })],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        lastPrompt.delete(userId);
        throw error;
    }
    return false;
}

async function registerGate(interaction) {
    if (await Registration.isRegistered(interaction.user.id)) return null;
    return buildWelcome({
        user: interaction.user,
        botName: interaction.client.user.username,
        state: 'prompt'
    });
}

const busy = new Set();

async function handleButton(interaction) {
    const [, action, ownerId] = interaction.customId.split(':');
    if (action !== 'register' || !ownerId) return;

    if (interaction.user.id !== ownerId) {
        return interaction.reply({
            content: `This isn't your registration! Type \`${cfg.PREFIX}cash\` to get your own.`,
            flags: MessageFlags.Ephemeral
        });
    }
    if (busy.has(ownerId)) return interaction.deferUpdate().catch(() => {});
    busy.add(ownerId);

    try {
        await interaction.deferUpdate();

        const result = await Registration.register(ownerId, interaction.guildId);
        if (!result.created) {
            return interaction.followUp({
                content: `You're already registered! Type \`${cfg.PREFIX}cash\` to check your balance.`,
                flags: MessageFlags.Ephemeral
            });
        }

        return interaction.editReply({
            components: [buildWelcome({
                user: interaction.user,
                botName: interaction.client.user.username,
                state: 'done',
                result
            })],
            flags: MessageFlags.IsComponentsV2
        });
    } catch (error) {
        console.error('[FUNECONOMY] Register button error:', error);
        interaction.followUp({
            content: 'Something went wrong, please try again.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    } finally {
        busy.delete(ownerId);
    }
}

module.exports = { BUTTON_PREFIX, buildWelcome, ensureRegistered, registerGate, handleButton };