const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');

// Do not use server-config roles: these commands require Discord Administrator
// or the bot owner configured in Railway, not Manage Messages / bot manager.
module.exports = function adminOrBotOwner(context) {
    const userId = context.user?.id || context.author?.id;
    const ownerId = process.env.DISCORD_USER_ID?.trim();
    if (ownerId && userId === ownerId) return true;
    if (!context.guild || !userId) return false;

    const permissions = context.memberPermissions ?? context.member?.permissions;
    if (permissions == null) return false;
    try {
        return new PermissionsBitField(permissions).has(PermissionFlagsBits.Administrator);
    } catch {
        return false;
    }
};
