const {
    SlashCommandBuilder,
    MessageFlags,
    AttachmentBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    FileBuilder
} = require('discord.js');
const DeletedMessage = require('../../models/serverLogs/DeletedMessage');
const { getBotOwnerId, isBotOwner } = require('../../utils/botOwnerOnly');
const {
    MAX_ATTACHMENT_DOWNLOAD_BYTES,
    RETENTION_DAYS,
    buildDeletedMessageQuery,
    fetchAttachmentBuffer
} = require('../../utils/messageHistory');
const { createZipArchive } = require('../../utils/zipArchive');

const MAX_RESULTS = 5;
const MAX_CONTENT_LENGTH = 500;

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

const MAX_COMPONENT_TEXT = 3800; // Components V2 allows 4000 characters total

function toUnix(date) {
    const time = new Date(date).getTime();
    return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

function formatTime(date) {
    const ts = toUnix(date);
    return ts ? `<t:${ts}:f> (<t:${ts}:R>)` : 'Unknown';
}

function createHistoryContainer(messages, filters = {}) {
    const container = new ContainerBuilder()
        .setAccentColor(0xdc92ff)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('**<:messagehistory:1565185242409738240> MESSAGE HISTORY**')
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const summary = [
        `**<:results:1565185256947195934> Results:** ${messages.length} deleted message(s)`,
        `**<:requestedby:1563476988105195583> User filter:** ${filters.userId ? `<@${filters.userId}>` : 'All users'}`,
        `**<:channel:1565185263737638932> Channel filter:** ${filters.channelId ? `<#${filters.channelId}>` : 'All channels'}`,
        `**<:retention:1565185244993421372> Retention:** ${RETENTION_DAYS} days`,
        '**<:visibility:1565185236721995979> Visibility:** Only you'
    ].join('\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summary));

    let used = summary.length + 40;
    let shown = 0;

    for (const [index, message] of messages.entries()) {
        const content = message.contentAvailable
            ? (cleanText(message.content) || '_No text content_')
            : '_Content was not available when it was deleted._';
        const lines = [
            `**<:message:1565185252199104602> MESSAGE #${index + 1}**`,
            `**<:requestedby:1563476988105195583> Author:** ${message.authorId ? `<@${message.authorId}>` : ''} \`${String(message.authorTag || 'Unknown user').slice(0, 100)}\``,
            `**<:channel:1565185263737638932> Channel:** <#${message.channelId}>`,
            `**<:sent:1565185259707043860> Sent:** ${formatTime(message.sentAt)}`,
            `**<:deleted:1565185261720309791> Deleted:** ${formatTime(message.deletedAt)}`,
            `**<:content:1565185247132258305> Content:**`,
            content.split('\n').map(line => `> ${line}`).join('\n'),
            ...(message.historyAttachmentLines || [])
        ];
        let block = lines.join('\n');
        const remaining = MAX_COMPONENT_TEXT - used;
        if (remaining < 200) break;
        if (block.length > remaining) block = block.slice(0, remaining - 3) + '...';
        used += block.length;
        shown++;

        container
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(block));

        // Components V2 hides uploaded files unless a File component points
        // at them, so place each archive directly under its message.
        for (const fileName of message.historyFileNames || []) {
            container.addFileComponents(
                new FileBuilder().setURL(`attachment://${fileName}`)
            );
        }
    }

    if (shown < messages.length) {
        container
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `_${messages.length - shown} more message(s) hidden — use a smaller limit or a filter._`
            ));
    }

    return container;
}

function createStatusContainer(message) {
    return new ContainerBuilder()
        .setAccentColor(0xdc92ff)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('**🗂️ MESSAGE HISTORY**')
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(message)
        );
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

        // A deferred reply only accepts the Ephemeral flag. Passing
        // IsComponentsV2 here makes Discord reject the defer, which surfaced
        // as the generic "An error occurred" message.
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
                    flags: MessageFlags.IsComponentsV2,
                    components: [createStatusContainer(
                        'No deleted messages were found for those filters. History starts after the bot records messages.'
                    )]
                });
            }

            const files = [];
            const historyMessages = [];
            let replyBytes = 0;

            for (const [index, message] of messages.entries()) {
                const attachmentLines = [];
                const archiveEntries = [];
                const fileNames = [];

                for (const attachment of (message.attachments || []).slice(0, 3)) {
                    const originalName = safeFileName(attachment.name, 'attachment');
                    let data = getStoredBuffer(attachment.data);

                    if (
                        !data &&
                        replyBytes < MAX_ATTACHMENT_DOWNLOAD_BYTES
                    ) {
                        const remainingBytes = MAX_ATTACHMENT_DOWNLOAD_BYTES - replyBytes;
                        data = await fetchAttachmentBuffer(attachment, remainingBytes);
                    }

                    if (data) {
                        archiveEntries.push({
                            name: safeFileName(`${archiveEntries.length + 1}-${originalName}`, `file-${archiveEntries.length + 1}`),
                            data
                        });
                    } else {
                        attachmentLines.push(`📎 ${originalName.slice(0, 80)} · download unavailable`);
                    }
                }

                if (archiveEntries.length) {
                    const deletedAt = new Date(message.deletedAt);
                    const timestamp = deletedAt.toISOString()
                        .replace(/[-:]/g, '')
                        .replace(/\.\d{3}Z$/, 'Z');
                    const messageIdSuffix = String(message.messageId || index + 1).slice(-6);
                    const archiveName = `deleted-${timestamp}-${messageIdSuffix}.zip`;
                    const archiveData = createZipArchive(archiveEntries, deletedAt);

                    if (archiveData.length <= MAX_ATTACHMENT_DOWNLOAD_BYTES - replyBytes) {
                        files.push(new AttachmentBuilder(archiveData, { name: archiveName }));
                        replyBytes += archiveData.length;
                        attachmentLines.push('**<:file:1565185234629173328> File:** download below');
                        fileNames.push(archiveName);
                    } else {
                        attachmentLines.push('<:file:1565185234629173328> Archive exceeds the response size limit');
                    }
                }

                historyMessages.push({
                    ...message,
                    historyAttachmentLines: attachmentLines,
                    historyFileNames: fileNames
                });
            }

            return interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [createHistoryContainer(historyMessages, {
                    userId: user?.id,
                    channelId: channel?.id
                })],
                files,
                allowedMentions: { parse: [] }
            });
        } catch (error) {
            console.error(`[MessageHistory] Could not load history for guild ${interaction.guildId}:`, error);
            return interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [createStatusContainer(
                    'Could not load message history right now. Please try again later.'
                )]
            });
        }
    }
};
