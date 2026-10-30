const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, escapeMarkdown
} = require('discord.js');
const cfg = require('./config');
const { fmt } = require('./utils');
const FunEconomy = require('../models/funeconomy/schema');

// Leaderboard cash ala OwO (Components V2): Current Stats -> Rankings -> halaman.
const BUTTON_PREFIX = 'flb';
const PER_PAGE = 10;
const ACCENT = 0x7ab8f5;
const ACCENT_EXPIRED = 0x4f545c; // abu-abu saat kadaluarsa
const EXPIRE_MS = 10 * 60 * 1000; // 10 menit sejak last updated
const timers = new Map(); // messageId -> { timeout, ctx }
const MEDALS = ['<:top1_gold:1565277029161631754>', '<:top2_silver:1565277044386963546>', '<:top3_bronze:1565277040163422219>'];

const scopeFilter = (scope, guildId) => (scope === 'guild' ? { guildIds: guildId } : {});
const baseFilter = (scope, guildId) => ({ cash: { $gt: 0 }, ...scopeFilter(scope, guildId) });

async function fetchPage({ scope, guildId, page }) {
    const filter = baseFilter(scope, guildId);
    const total = await FunEconomy.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const current = Math.min(Math.max(page, 1), pages);
    const rows = await FunEconomy.find(filter)
        .sort({ cash: -1, _id: 1 })
        .skip((current - 1) * PER_PAGE)
        .limit(PER_PAGE)
        .select('userId cash')
        .lean();
    return { rows, total, pages, page: current };
}

async function rankOf(userId, { scope, guildId }) {
    const me = await FunEconomy.findOne({ userId, ...scopeFilter(scope, guildId) }).select('cash').lean();
    const cash = me?.cash ?? 0;
    if (cash <= 0) return { rank: null, cash: 0 };
    const ahead = await FunEconomy.countDocuments({ cash: { $gt: cash }, ...scopeFilter(scope, guildId) });
    return { rank: ahead + 1, cash };
}

async function resolveName(client, guild, scope, id) {
    const user = client.users.cache.get(id) ?? await client.users.fetch(id).catch(() => null);
    if (user) return `@${escapeMarkdown(user.username)}`;
    const member = scope === 'guild' ? guild?.members.cache.get(id) : null;
    return member ? `@${escapeMarkdown(member.user.username)}` : 'Unknown User';
}

function topPercent(rank, total) {
    if (!rank || !total) return null;
    const pct = (rank / total) * 100;
    return pct < 0.1 ? '0.1' : pct.toFixed(1);
}

const btn = (id, opts) => {
    const b = new ButtonBuilder().setCustomId(id).setStyle(opts.style ?? ButtonStyle.Secondary);
    if (opts.label) b.setLabel(opts.label);
    if (opts.emoji) b.setEmoji(opts.emoji);
    if (opts.disabled || opts.expired) b.setDisabled(true);
    return b;
};

/** Bangun pesan leaderboard. state: { ownerId, scope, page } */
async function build(client, guild, viewer, state) {
    const { scope } = state;
    const guildId = guild.id;
    const data = await fetchPage({ scope, guildId, page: state.page });
    const mine = await rankOf(viewer.id, { scope, guildId });
    const myPage = mine.rank ? Math.ceil(mine.rank / PER_PAGE) : null;
    const expired = !!state.expired;
    const id = (action, page) => `${BUTTON_PREFIX}:${action}:${state.ownerId}:${scope}:${page}`;

    const title = scope === 'guild'
        ? `${escapeMarkdown(guild.name)} ${cfg.CASH_NAME} Leaderboard`
        : `Global ${cfg.CASH_NAME} Leaderboard`;
    const header = `## <:cash:1555123079406026832> ${title}\nLeaderboard for the amount of ${cfg.CASH_NAME} you have.`;

    const pct = topPercent(mine.rank, data.total);
    const stats = [
        '### <:trackstats:1563476992853278830> Your Current Stats',
        `-# **User:** @${escapeMarkdown(viewer.username)}`,
        `-# **Rank:** ${mine.rank ? `#${fmt(mine.rank)} *(Top ${pct}%)*` : 'Unranked'}`,
        `-# **${cfg.CASH_NAME[0].toUpperCase()}${cfg.CASH_NAME.slice(1)}:** ${fmt(mine.cash)}`
    ].join('\n');

    const start = (data.page - 1) * PER_PAGE;
    const lines = await Promise.all(data.rows.map(async (row, i) => {
        const pos = start + i + 1;
        const name = await resolveName(client, guild, scope, row.userId);
        const prefix = pos <= 3 ? MEDALS[pos - 1] : `**${pos}.**`;
        const you = row.userId === viewer.id ? ' <:you:1565566050836152350>' : '';
        return `${prefix} ${name}${you}\n-# ${cfg.CASH_NAME}: \`${fmt(row.cash)}\``;
    }));
    const rankings = `### <:trophy_gold:1565277035880910848> Rankings\n${lines.length ? lines.join('\n') : 'Nobody is on this leaderboard yet!'}`;

    const nowSec = Math.floor((state.updatedAt ?? Date.now()) / 1000);
    const footer = `-# Last updated: <t:${nowSec}:R> • Total players: ${fmt(data.total)}`;

    const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

    const container = new ContainerBuilder()
        .setAccentColor(expired ? ACCENT_EXPIRED : ACCENT)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(stats))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            btn(id('me', myPage ?? 1), { expired, label: 'My Rank', emoji: '<:myrank:1565277033804603512>', disabled: !myPage || myPage === data.page })
        ))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(rankings))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            btn(id('top', 1), { expired, label: 'Top', emoji: '<:trackstats:1563476992853278830>', disabled: data.page === 1 })
        ))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(footer))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            btn(id('first', 1), { expired, emoji: '<:rewind:1565277037743181914>', disabled: data.page === 1 }),
            btn(id('prev', data.page - 1), { expired, emoji: '<:previous:1565277042201591848>', disabled: data.page === 1 }),
            btn(id('page', data.page), { expired, label: `${fmt(data.page)}/${fmt(data.pages)}`, disabled: true }),
            btn(id('next', data.page + 1), { expired, emoji: '<:next:1565277026783592568>', disabled: data.page >= data.pages }),
            btn(id('last', data.pages), { expired, emoji: '<:fastforward:1565277031451861042>', disabled: data.page >= data.pages })
        ));

    return { components: [container], allowedMentions: { parse: [] } };
}

async function send(message, client, scope) {
    const payload = await build(client, message.guild, message.author, {
        ownerId: message.author.id, scope, page: 1
    });
    const sent = await message.channel.send({ ...payload, flags: MessageFlags.IsComponentsV2 });
    schedule(sent, { client, guild: message.guild, viewer: message.author, state: { ownerId: message.author.id, scope, page: 1, updatedAt: Date.now() } });
    return sent;
}

/** Jadwalkan kadaluarsa 10 menit; di-reset setiap kali leaderboard di-update. */
function schedule(msg, ctx) {
    const old = timers.get(msg.id);
    if (old) clearTimeout(old.timeout);
    const timeout = setTimeout(() => expire(msg, ctx).catch(() => {}), EXPIRE_MS);
    timers.set(msg.id, { timeout, ctx });
}

async function expire(msg, ctx) {
    timers.delete(msg.id);
    const payload = await build(ctx.client, ctx.guild, ctx.viewer, { ...ctx.state, expired: true });
    await msg.edit(payload);
}

async function handleButton(interaction) {
    const [, , ownerId, scope, pageRaw] = interaction.customId.split(':');
    if (interaction.user.id !== ownerId) {
        return interaction.reply({
            content: `${cfg.EMOJI.ERROR} | This leaderboard isn't yours! Use \`${cfg.PREFIX}lb\` to open your own.`,
            flags: MessageFlags.Ephemeral
        });
    }
    const msg = interaction.message;
    const lastUpdated = msg.editedTimestamp ?? msg.createdTimestamp;
    const realScope = scope === 'guild' ? 'guild' : 'global';
    // Fallback (mis. bot sempat restart & timer hilang): tolak & kunci kalau sudah > 10 menit.
    if (!timers.has(msg.id) && Date.now() - lastUpdated >= EXPIRE_MS) {
        await interaction.deferUpdate();
        const payload = await build(interaction.client, interaction.guild, interaction.user, {
            ownerId, scope: realScope, page: Number(pageRaw) || 1, updatedAt: lastUpdated, expired: true
        });
        return interaction.editReply(payload);
    }
    await interaction.deferUpdate();
    const state = { ownerId, scope: realScope, page: Number(pageRaw) || 1, updatedAt: Date.now() };
    const payload = await build(interaction.client, interaction.guild, interaction.user, state);
    await interaction.editReply(payload);
    schedule(msg, { client: interaction.client, guild: interaction.guild, viewer: interaction.user, state });
}

module.exports = { BUTTON_PREFIX, PER_PAGE, build, send, handleButton };
