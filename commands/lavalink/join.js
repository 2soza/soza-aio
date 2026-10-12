const { SlashCommandBuilder } = require('discord.js');
const { runCommand, joinFromContext } = require('../../utils/voiceStay');

module.exports = {
    category: 'lavalink',
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Join your voice channel without playing music.'),

    async execute(context, argsOrClient, maybeClient) {
        const client = Array.isArray(argsOrClient) ? maybeClient : argsOrClient;
        return runCommand(context, () => joinFromContext(context, client));
    }
};
