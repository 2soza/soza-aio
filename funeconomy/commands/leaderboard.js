const cfg = require('../config');
const { backfillGuild } = require('../../models/funeconomy/ranking');
const cooldown = require('../cooldown');
const { send, errorLine, displayName, onCooldown } = require('../utils');
const leaderboard = require('../leaderboardView');

// Leaderboard cash ala OwO. Contoh: slb | slb global
module.exports = {
    name: 'lb',
    aliases: ['leaderboard', 'rank', 'ranking'],
    async execute(message, args, client) {
        const name = displayName(message);
        let scope = cfg.RANK.DEFAULT_SCOPE;
        for (const raw of args) {
            const token = raw.toLowerCase();
            if (token === 'global' || token === 'g') scope = 'global';
            else return send(message, errorLine(name, `wrong arguments! Usage: \`${cfg.PREFIX}lb [global]\``));
        }
        if (onCooldown(message, 'lb')) return;

        if (scope === 'guild') await backfillGuild(message.guild);
        cooldown.start('lb', message.author.id);
        return leaderboard.send(message, client, scope);
    }
};
