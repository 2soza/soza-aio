const {
    SlashCommandBuilder,
    EmbedBuilder,
    ChannelType,
    PermissionsBitField
} = require('discord.js');
const TicketConfig = require('../../models/ticket/TicketConfig');
const cmdIcons = require('../../UI/icons/commandicons');
const checkPermissions = require('../../utils/checkPermissions');
const { MAX_STAFF_ROLES } = require('../../utils/ticketRoles');
module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-ticket')
        .setDescription('Set or view the ticket channel configuration for the server')
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('Set the ticket and transcript channels')
                .addChannelOption(option =>
                    option.setName('ticket_channel')
                        .setDescription('Select the ticket creation channel')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addChannelOption(option =>
                    option.setName('transcript_channel')
                        .setDescription('Channel to receive ticket transcripts')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addRoleOption(option =>
                    option.setName('admin_role')
                        .setDescription('Role that can manage tickets')
                        .setRequired(true))
                        .addBooleanOption(option =>
                            option.setName('status')
                                .setDescription('Enable or disable the ticket system')
                                .setRequired(true))
                .addChannelOption(option =>
                    option.setName('ticket_category')
                        .setDescription('Ticket category for ticket channels')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false))

        )
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View the current ticket config')
        )
        .addSubcommand(sub =>
            sub.setName('add-role')
                .setDescription('Add another staff role that can manage tickets')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Role to add as ticket staff')
                        .setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('remove-role')
                .setDescription('Remove a staff role added earlier')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Role to remove from ticket staff')
                        .setRequired(true))
        ),

    async execute(interaction) {
        if (interaction.isCommand && interaction.isCommand()) {
        if (!await checkPermissions(interaction)) return;
        const { options, guild, user } = interaction;
        const sub = options.getSubcommand();
        const serverId = guild.id;

        const existing = await TicketConfig.findOne({ serverId });
        const ownerOrManager = existing?.ownerId === user.id || (existing?.botManagers || []).includes(user.id);


        if (sub === 'set') {
            const ticketChannel = options.getChannel('ticket_channel');
            const transcriptChannel = options.getChannel('transcript_channel');
            const adminRole = options.getRole('admin_role');
            const status = options.getBoolean('status');
            const category = options.getChannel('ticket_category');

            let categoryId = category?.id;

            if (!categoryId) {
                // No category provided — create a default one
                try {
                    const createdCategory = await guild.channels.create({
                        name: 'Tickets',
                        type: ChannelType.GuildCategory,
                        reason: 'Default ticket category created by bot'
                    });
                    categoryId = createdCategory.id;
                } catch (err) {
                    console.error('Failed to create default category:', err);
                    return interaction.reply({
                        content: '❌ Failed to create default category. Please try again or provide one.',
                        ephemeral: true
                    });
                }
            }

            await TicketConfig.findOneAndUpdate(
                { serverId },
                {
                    serverId,
                    ticketChannelId: ticketChannel.id,
                    transcriptChannelId: transcriptChannel.id,
                    adminRoleId: adminRole.id,
                    status,
                    ownerId: guild.ownerId,
                    categoryId
                },
                { upsert: true }
            );

            return interaction.reply({
                content: `✔️ Ticket system updated for **${guild.name}**.`,
                ephemeral: true
            });
        }

        if (sub === 'add-role') {
            const role = options.getRole('role');
            if (!role) {
                return interaction.reply({ content: '❌ That role no longer exists.', ephemeral: true });
            }

            if (!existing) {
                return interaction.reply({
                    content: '❌ Ticket system is not configured yet. Use `/setup-ticket set` first.',
                    ephemeral: true
                });
            }

            if (role.id === existing.adminRoleId) {
                return interaction.reply({
                    content: `ℹ️ **${role.name}** is already the main admin role.`,
                    ephemeral: true
                });
            }

            const extras = existing.extraAdminRoleIds || [];
            if (extras.includes(role.id)) {
                return interaction.reply({
                    content: `ℹ️ **${role.name}** is already a ticket staff role.`,
                    ephemeral: true
                });
            }

            if (extras.length >= MAX_STAFF_ROLES - 1) {
                return interaction.reply({
                    content: `❌ Only ${MAX_STAFF_ROLES - 1} extra staff roles can be added.`,
                    ephemeral: true
                });
            }

            await TicketConfig.findOneAndUpdate(
                { serverId },
                { $push: { extraAdminRoleIds: role.id } }
            );

            return interaction.reply({
                content: `✅ **${role.name}** was added to the ticket staff roles.`,
                ephemeral: true
            });
        }

        if (sub === 'remove-role') {
            const role = options.getRole('role');
            if (!role) {
                return interaction.reply({ content: '❌ That role no longer exists.', ephemeral: true });
            }

            const extras = (existing && existing.extraAdminRoleIds) || [];
            if (!extras.includes(role.id)) {
                return interaction.reply({
                    content: `❌ **${role.name}** is not one of the added staff roles.`,
                    ephemeral: true
                });
            }

            await TicketConfig.findOneAndUpdate(
                { serverId },
                { $pull: { extraAdminRoleIds: role.id } }
            );

            return interaction.reply({
                content: `✅ **${role.name}** was removed from the ticket staff roles.`,
                ephemeral: true
            });
        }

        if (sub === 'view') {
            const config = await TicketConfig.findOne({ serverId });
            if (!config) {
                return interaction.reply({ content: '❌ No configuration found.', ephemeral: true });
            }

            const extraRoles = (config.extraAdminRoleIds || []).length
                ? (config.extraAdminRoleIds || []).map((id) => `<@&${id}>`).join(', ')
                : 'None';

            const embed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('🎟️ Ticket System Configuration')
                .setDescription(`
                **Ticket Channel:** <#${config.ticketChannelId}>
                **Transcript Channel:** <#${config.transcriptChannelId ?? 'Not set'}>
                **Admin Role:** <@&${config.adminRoleId}>
                **Extra Staff Roles:** ${extraRoles}
                **Ticket Category:** ${config.categoryId ? `<#${config.categoryId}>` : 'Not set'}
                **Status:** ${config.status ? '🟢 Enabled' : '🔴 Disabled'}
                `)
                .setFooter({ text: 'Ticket Configuration', iconURL: cmdIcons.dotIcon })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
    } else {
        const embed = new EmbedBuilder()
            .setColor('#3498db')
            .setAuthor({
                name: "Alert!",
                iconURL: cmdIcons.dotIcon,
                url: "https://discord.gg/xQF9f9yUEM"
            })
            .setDescription('- This command can only be used through slash commands!\n- Please use `/setup-ticket`')
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
    }
};
