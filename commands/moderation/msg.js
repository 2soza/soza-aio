const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder
} = require('discord.js');
const DeletedMessage = require('../../models/serverLogs/DeletedMessage');
const { RETENTION_DAYS, buildDeletedMessageQuery } = require('../../utils/messageHistory');

const MAX_RESULTS = 5;
const MAX_CONTENT_LENGTH = 700;

function toCodeBlock(content) {
    const safeContent = String(content || '')
        .replace(/```/g, '`\u200b``')
        .slice(0, MAX_CONTENT_LENGTH);
    return `\`\`\`\n${safeContent}\n\`\`\``;
}

function formatAttachment(attachment) {
    const name = String(attachment.name || 'attachment').replace(/[\[\]()]/g, '');
    if (attachment.url) return `• [${name}](<${attachment.url}>)`;
    return `• ${name}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('msg')
        .setDescription('View deleted message history for this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand(subcommand => subcommand
            .setName('history')
            .setDescription('View recently deleted messages')
            .addUserOption(option => option
                .setName('user')
                .setDescription('Filter by the message author')
                .setRequired(false))
            .addChannelOption(option => option
                .setName('channel')
                .setDescription('Filter by the channel')
                .setRequired(false))
            .addIntegerOption(option => option
                .setName('limit')
                .setDescription('Number of messages to show (1–5)')
                .setMinValue(1)
                .setMaxValue(MAX_RESULTS)
                .setRequired(false))),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                content: 'This command can only be used in a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({
                content: 'You need the Manage Messages permission to view deleted message history.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const user = interaction.options.getUser('user');
            const channel = interaction.options.getChannel('channel');
            const limit = interaction.options.getInteger('limit') || MAX_RESULTS;
            const query = buildDeletedMessageQuery(interaction.guildId, {
                userId: user?.id,
                channelId: channel?.id
            });
            const messages = await DeletedMessage.find(query)
                .sort({ deletedAt: -1 })
                .limit(limit)
                .lean();

            if (!messages.length) {
                return interaction.editReply({
                    content: 'No deleted messages were found in this server for those filters. History only starts after the bot has recorded messages.'
                });
            }

            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('Recently deleted messages')
                .setDescription(`Showing ${messages.length} message(s) from this server. This private result is visible only to you.`)
                .setFooter({ text: `Deleted-message history is retained for up to ${RETENTION_DAYS} days.` });

            for (const [index, message] of messages.entries()) {
                const sentTimestamp = Math.floor(new Date(message.sentAt).getTime() / 1000);
                const deletedTimestamp = Math.floor(new Date(message.deletedAt).getTime() / 1000);
                const content = message.contentAvailable
                    ? (message.content || '*No text content*')
                    : '*Message content was not available when it was deleted.*';
                const attachmentLines = (message.attachments || [])
                    .slice(0, 3)
                    .map(formatAttachment);
                const value = [
                    `**Channel:** <#${message.channelId}>`,
                    `**Sent:** <t:${sentTimestamp}:f> · **Deleted:** <t:${deletedTimestamp}:R>`,
                    toCodeBlock(content),
                    ...attachmentLines
                ].join('\n').slice(0, 1024);

                embed.addFields({
                    name: `${index + 1}. ${message.authorTag || 'Unknown user'}`,
                    value
                });
            }

            return interaction.editReply({
                embeds: [embed],
                allowedMentions: { parse: [] }
            });
        } catch (error) {
            console.error(`[MessageHistory] Could not load history for guild ${interaction.guildId}:`, error);
            return interaction.editReply({
                content: 'Could not load message history right now. Please try again later.'
            });
        }
    }
};
