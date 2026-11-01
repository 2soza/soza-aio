const Luck = require('../../models/funeconomy/luck');
const { coinflipResult } = require('../luckMath');
const cfg = require('../config');
const Economy = require('../../models/funeconomy/economy');
const cooldown = require('../cooldown');
const {
    fmt, displayName, sleep, isAmountToken, parseAmount, send, sendTemporaryError, errorLine,
    acquireGambleLock, releaseGambleLock, onCooldown
} = require('../utils');

const SIDES = { h: 'heads', head: 'heads', heads: 'heads', t: 'tails', tail: 'tails', tails: 'tails' };

module.exports = {
    name: 'cf',
    aliases: ['coinflip', 'coin', 'flip'],
    async execute(message, args) {
        const userId = message.author.id;
        const name = displayName(message);

        if (!acquireGambleLock(userId)) return;
        try {
            // Argumen boleh urutan apa saja: "scf 100 h" / "scf h 100" / "scf all"
            let side = null;
            let amountToken = null;
            for (const raw of args) {
                const token = raw.toLowerCase();
                if (!side && SIDES[token]) side = SIDES[token];
                else if (amountToken === null && isAmountToken(token)) amountToken = token;
                else {
                    return send(message, errorLine(name, `wrong arguments! Usage: \`${cfg.PREFIX}cf <amount|all> [h/t]\``));
                }
            }
            side = side || 'heads';

            const balance = await Economy.getCash(userId);
            const bet = amountToken === null ? cfg.MIN_BET : parseAmount(amountToken, balance, cfg.MAX_BET);

            if (bet < cfg.MIN_BET) {
                // "all" dengan saldo 0 juga jatuh ke sini
                if (amountToken === 'all') return sendTemporaryError(message, errorLine(name, `you don't have any ${cfg.CASH_NAME} to bet!`));
                return send(message, errorLine(name, `you need to bet at least **${fmt(cfg.MIN_BET)}**!`));
            }
            if (bet > cfg.MAX_BET) {
                return send(message, errorLine(name, `the maximum amount you can bet is **${fmt(cfg.MAX_BET)}**!`));
            }
            if (balance < bet) {
                return sendTemporaryError(message, errorLine(name, `you don't have enough ${cfg.CASH_NAME}!`));
            }

            if (onCooldown(message, 'cf')) return;

            // Tentukan hasil lalu simpan atomik SEBELUM animasi
            const points = await Luck.getPoints(userId);
            const result = coinflipResult(side, points);
            const won = result === side;
            const payout = won ? bet * 2 : 0;

            const settled = await Economy.settleBet(userId, bet, payout);
            if (!settled) {
                return sendTemporaryError(message, errorLine(name, `you don't have enough ${cfg.CASH_NAME}!`));
            }

            cooldown.start('cf', userId);

            const header = `**${name}** spent ${cfg.CASH_EMOJI} **${fmt(bet)}** and chose **${side}**`;
            const sent = await send(message, `${header}\nThe coin spins... ${cfg.COIN.SPINNING}`);
            await sleep(cfg.COINFLIP_ANIMATION_MS);

            const coin = result === 'heads' ? cfg.COIN.HEADS : cfg.COIN.TAILS;
            const outcome = won
                ? `and you won ${cfg.CASH_EMOJI} **${fmt(payout)}**!!`
                : 'and you lost it all... :c';
            const finalText = `${header}\nThe coin spins... ${coin} ${outcome}`;

            await sent.edit({ content: finalText, allowedMentions: { parse: [] } })
                .catch(() => send(message, finalText).catch(() => {}));
        } finally {
            releaseGambleLock(userId);
        }
    }
};
