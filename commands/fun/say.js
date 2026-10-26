const { MessageFlags } = require('discord.js');
const adminOrBotOwner = require('../../utils/adminOrBotOwner');
const say = require('../../utils/sayImplementation');

module.exports = {
    ...say,
    async execute(interaction) {
        if (interaction.isChatInputCommand?.() && !adminOrBotOwner(interaction)) {
            return await interaction.reply({
                content: '❌ Only members with **Administrator** permission or the **bot owner** can use this command.',
                flags: MessageFlags.Ephemeral
            });
        }
        return say.execute.call(this, interaction);
    }
};
