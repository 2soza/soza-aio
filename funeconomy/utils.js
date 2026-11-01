const { escapeMarkdown, PermissionsBitField } = require('discord.js');
const cfg = require('./config');
const cooldown = require('./cooldown');

const fmt = (n) => Number(n).toLocaleString('en-US');

const displayName = (message) =>
    escapeMarkdown(message.member?.displayName ?? message.author.username);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function animateSlotReels(reels, onFrame) {
    const symbols = Array(3).fill(cfg.SLOT_SPINNING);
    const revealOrder = [0, 2, 1];

    await onFrame([...symbols], false);
    for (let step = 0; step < revealOrder.length; step += 1) {
        await sleep(cfg.SLOT_ANIMATION_STEPS_MS[step]);
        const reelIndex = revealOrder[step];
        symbols[reelIndex] = reels[reelIndex].emoji;
        await onFrame([...symbols], step === revealOrder.length - 1);
    }
}

const NUMBER_PATTERN = /^(\d{1,3}(,\d{3})+|\d+)$/;

/** Token berupa "all" atau angka (boleh "1,000")? */
function isAmountToken(token) {
    const t = String(token).toLowerCase();
    return t === 'all' || NUMBER_PATTERN.test(t);
}

/**
 * Ubah token jadi jumlah. "all" = saldo (dibatasi `cap` kalau ada).
 * Return null kalau bukan angka.
 */
function parseAmount(token, balance, cap = Infinity) {
    const t = String(token).toLowerCase();
    if (t === 'all') return Math.min(balance, cap);
    if (!NUMBER_PATTERN.test(t)) return null;
    return Number(t.replace(/,/g, ''));
}

/** 45123000 -> "12H 32M 3S" (format timer ala OwO) */
function formatDuration(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h}H ${m}M ${s}S`;
}

/** Kirim pesan biasa (bukan reply, seperti OwO) tanpa memicu mention. */
const send = (message, content) =>
    message.channel.send({ content, allowedMentions: { parse: [] } });

/** Kirim error saldo yang hanya perlu terlihat sebentar. */
const sendTemporaryError = (message, content, delayMs = 3000) =>
    send(message, content).then((sent) => {
        const timer = setTimeout(() => sent.delete().catch(() => {}), delayMs);
        timer.unref?.();
        return sent;
    });

function deleteInteractionReplyAfter(interaction, delayMs = 3000) {
    const timer = setTimeout(() => {
        Promise.resolve()
            .then(() => interaction.deleteReply())
            .catch(() => {});
    }, delayMs);
    timer.unref?.();
    return timer;
}

const errorLine = (name, text) => `${cfg.EMOJI.ERROR} | **${name}**, ${text}`;

/**
 * Validasi taruhan standar (sama seperti coinflip/slots).
 * `token` boleh undefined (= taruhan minimum). `max` = batas atas (default MAX_BET).
 * Return { bet } kalau valid, atau { error } berisi kalimat untuk errorLine().
 */
function resolveBet(token, balance, max = cfg.MAX_BET) {
    const bet = token === undefined ? cfg.MIN_BET : parseAmount(token, balance, max);
    if (bet === null || !Number.isSafeInteger(bet)) return { error: 'that is not a valid amount!' };
    if (bet < cfg.MIN_BET) {
        if (String(token).toLowerCase() === 'all') {
            return { error: `you don't have any ${cfg.CASH_NAME} to bet!`, insufficientBalance: true };
        }
        return { error: `you need to bet at least **${fmt(cfg.MIN_BET)}**!` };
    }
    if (bet > max) return { error: `the maximum amount you can bet is **${fmt(max)}**!` };
    if (balance < bet) return { error: `you don't have enough ${cfg.CASH_NAME}!`, insufficientBalance: true };
    return { bet };
}

/** Bot boleh mengirim embed di channel ini? */
const canEmbed = (message) => {
    const me = message.guild?.members.me;
    return !!me && !!message.channel.permissionsFor?.(me)?.has(PermissionsBitField.Flags.EmbedLinks);
};

/** Kirim embed (dan tombol) tanpa memicu mention. */
const sendEmbed = (message, embed, components = []) =>
    message.channel.send({ embeds: [embed], components, allowedMentions: { parse: [] } });

/**
 * Tolak command kalau game masih cooldown. Return true bila ditolak (pesan hanya dikirim sekali per jendela).
 * Panggil SETELAH argumen divalidasi dan SEBELUM saldo dipotong.
 */
function onCooldown(message, game) {
    const hit = cooldown.check(game, message.author.id);
    if (!hit) return false;
    if (hit.notify) {
        const expiresAt = Date.now() + hit.ms;
        send(message, `${cfg.EMOJI.TIMER} | **${displayName(message)}**, slow down and try the command again **<t:${Math.ceil(expiresAt / 1000)}:R>**!`)
            .then((warningMessage) => {
                const timer = setTimeout(() => {
                    warningMessage.delete().catch(() => {});
                }, Math.max(0, expiresAt - Date.now()));
                timer.unref?.();
            })
            .catch(() => {});
    }
    return true;
}

// Satu taruhan per user pada satu waktu (mencegah spam saat animasi berjalan).
const gambleLocks = new Set();
const acquireGambleLock = (userId) => {
    if (gambleLocks.has(userId)) return false;
    gambleLocks.add(userId);
    return true;
};
const releaseGambleLock = (userId) => gambleLocks.delete(userId);

module.exports = {
    fmt, displayName, sleep, animateSlotReels, isAmountToken, parseAmount, formatDuration,
    send, sendTemporaryError, deleteInteractionReplyAfter,
    sendEmbed, canEmbed, resolveBet, errorLine, onCooldown, acquireGambleLock, releaseGambleLock
};
