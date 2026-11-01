const crypto = require('crypto');
const cfg = require('../config');
const Luck = require('../../models/funeconomy/luck');
const { fmt, displayName, send, errorLine } = require('../utils');

// Soza's self-prayer command, inspired by OwO's luck-point presentation.
const PRAY_LINES = [
    'Soza smiles upon you. Luck is on your side!',
    'Your prayer reaches Soza. You feel lucky!',
    'Soza blesses your next adventures. Fortune favors you!'
];

module.exports = {
    name: 'pray',
    aliases: [],
    async execute(message, args) {
        const name = displayName(message);
        if (args.length) return send(message, errorLine(name, `Usage: \`${cfg.PREFIX}pray\``));
        const result = await Luck.pray(message.author.id);
        if (!result.granted) {
            // OwO-style cooldown: Discord relative timestamp (<t:UNIX:R>) renders as
            // "in 5 minutes" and counts down live on the client.
            const readyAt = Math.ceil((Date.now() + result.remainingMs) / 1000);
            const sent = await send(message, `${cfg.EMOJI.TIMER} | **${name}**, you can pray to Soza again **<t:${readyAt}:R>**!`);
            // Remove the cooldown notice once the cooldown has finished.
            if (sent && typeof sent.delete === 'function') {
                const timer = setTimeout(() => sent.delete().catch(() => {}), result.remainingMs);
                timer.unref?.();
            }
            return sent;
        }
        const line = PRAY_LINES[crypto.randomInt(PRAY_LINES.length)];
        return send(message, `**${cfg.PRAY.EMOJI} | ${name}** prays to Soza... ${line}\n**${cfg.EMOJI.BLANK} |** You have **${fmt(result.points)}** luck point(s)!`);
    }
};
