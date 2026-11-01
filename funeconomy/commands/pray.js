const crypto = require('crypto');
const cfg = require('../config');
const Luck = require('../../models/funeconomy/luck');
const { fmt, displayName, send, errorLine, formatDuration } = require('../utils');

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
            return send(message, `${cfg.EMOJI.TIMER} | **${name}**, you can pray to Soza again in **${formatDuration(result.remainingMs)}**!`);
        }
        const line = PRAY_LINES[crypto.randomInt(PRAY_LINES.length)];
        return send(message, `**${cfg.PRAY.EMOJI} | ${name}** prays to Soza... ${line}\n**\\_\\_ |** You have **${fmt(result.points)}** luck point(s)!`);
    }
};
