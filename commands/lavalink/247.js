const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { runCommand, set247FromContext } = require('../../utils/voiceStay');

module.exports = {
    category: 'lavalink',
    data: new SlashCommandBuilder()
        .setName('247')
        .setDescription('Enable or disable 24/7 mode for the bot’s current voice channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Enable or disable automatic voice reconnection.')
                .setRequired(true)
                .addChoices(
                    { name: 'Enable', value: 'enable' },
                    { name: 'Disable', value: 'disable' }
                )),

    async execute(context, argsOrClient, maybeClient) {
        const args = Array.isArray(argsOrClient) ? argsOrClient : [];
        const client = Array.isArray(argsOrClient) ? maybeClient : argsOrClient;
        return runCommand(context, () => set247FromContext(context, args, client));
    }
};
