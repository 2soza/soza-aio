const { SlashCommandBuilder } = require('discord.js');
const { runCommand, leaveFromContext } = require('../../utils/voiceStay');

module.exports = {
    category: 'lavalink',
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Leave the current voice channel.'),

    async execute(context, argsOrClient, maybeClient) {
        const client = Array.isArray(argsOrClient) ? maybeClient : argsOrClient;
        return runCommand(context, () => leaveFromContext(context, client));
    }
};
