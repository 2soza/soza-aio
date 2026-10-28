const {
    SlashCommandBuilder,
    MessageFlags,
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');
const DeletedMessage = require('../../models/serverLogs/DeletedMessage');
const { getBotOwnerId, isBotOwner } = require('../../utils/botOwnerOnly');
const {
    MAX_ATTACHMENT_DOWNLOAD_BYTES,
    RETENTION_DAYS,
    buildDeletedMessageQuery,
    fetchAttachmentBuffer
} = require('../../utils/messageHistory');

const MAX_RESULTS = 5;
const MAX_CONTENT_LENGTH = 700;
const MAX_REPLY_FILES = 10;

function cleanText(content) {
    return String(content || '')
        .replace(/@(everyone|here)/gi, '@\u200b$1')
        .slice(0, MAX_CONTENT_LENGTH);
}

function safeFileName(name, fallback) {
    const cleaned = String(name || fallback)
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/]/g, '_')
        .replace(/\.\./g, '_')
        .trim()
        .slice(0, 100);
    return cleaned || fallback;
}

function getStoredBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value?._bsontype === 'Binary' && typeof value.value === 'function') {
        return Buffer.from(value.value());
    }
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('msg')
        .setDescription('View deleted message history for this server')
        // Disable for regular members by default. Allow the bot owner explicitly
        // in Server Settings > Integrations > this bot > Commands.
        .setDefaultMemberPermissions(0n)
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

        if (!getBotOwnerId()) {
            return interaction.reply({
                content: 'This command is disabled. Set DISCORD_USER_ID to the bot owner’s Discord user ID.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (!isBotOwner(interaction)) {
            return interaction.reply({
                content: 'Only the configured bot owner can view deleted message history.',
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
                .select('+attachments.data')
                .lean();

            if (!messages.length) {
                return interaction.editReply({
                    content: 'No deleted messages were found in this server for those filters. History only starts after the bot has recorded messages.'
                });
            }

            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('Deleted messages')
                .setDescription(`${messages.length} result(s) · private to you`)
                .setFooter({ text: `History is retained for up to ${RETENTION_DAYS} days.` });
            const files = [];
            let replyBytes = 0;

            for (const [index, message] of messages.entries()) {
                const sentTimestamp = Math.floor(new Date(message.sentAt).getTime() / 1000);
                const deletedTimestamp = Math.floor(new Date(message.deletedAt).getTime() / 1000);
                const content = message.contentAvailable
                    ? (cleanText(message.content) || '_No text content_')
                    : '*Message content was not available when it was deleted.*';
                const attachmentLines = [];

                for (const attachment of (message.attachments || []).slice(0, 3)) {
                    const originalName = safeFileName(attachment.name, 'attachment');
                    let data = getStoredBuffer(attachment.data);

                    if (
                        !data &&
                        files.length < MAX_REPLY_FILES &&
                        replyBytes < MAX_ATTACHMENT_DOWNLOAD_BYTES
                    ) {
                        const remainingBytes = MAX_ATTACHMENT_DOWNLOAD_BYTES - replyBytes;
                        data = await fetchAttachmentBuffer(attachment, remainingBytes);
                    }

                    if (
                        data &&
                        data.length <= MAX_ATTACHMENT_DOWNLOAD_BYTES - replyBytes &&
                        files.length < MAX_REPLY_FILES
                    ) {
                        const fileName = safeFileName(`${index + 1}-${originalName}`, `file-${index + 1}`);
                        files.push(new AttachmentBuilder(data, { name: fileName }));
                        replyBytes += data.length;
                        attachmentLines.push(`📎 ${originalName} · attached below`);
                    } else {
                        attachmentLines.push(`📎 ${originalName} · download unavailable`);
                    }
                }

                const value = [
                    `<#${message.channelId}> · <t:${sentTimestamp}:f>`,
                    `Deleted <t:${deletedTimestamp}:R>`,
                    '',
                    content,
                    ...attachmentLines
                ].join('\n').slice(0, 1024);

                embed.addFields({
                    name: `${index + 1}. ${String(message.authorTag || 'Unknown user').slice(0, 245)}`,
                    value
                });
            }

            return interaction.editReply({
                embeds: [embed],
                files,
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
