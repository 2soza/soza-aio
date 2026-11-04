/*
 ██████╗ ██╗      █████╗  ██████╗███████╗██╗   ██╗████████╗
██╔════╝ ██║     ██╔══██╗██╔════╝██╔════╝╚██╗ ██╔╝╚══██╔══╝
██║  ███╗██║     ███████║██║     █████╗   ╚████╔╝    ██║   
██║   ██║██║     ██╔══██║██║     ██╔══╝    ╚██╔╝     ██║   
╚██████╔╝███████╗██║  ██║╚██████╗███████╗   ██║      ██║   
 ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝   ╚═╝      ╚═╝   

-------------------------------------
📡 Discord : https://discord.gg/xQF9f9yUEM
🌐 Website : https://glaceyt.com
🎥 YouTube : https://youtube.com/@GlaceYT
✅ Verified | 🧩 Tested | ⚙️ Stable
-------------------------------------
> © 2025 GlaceYT.com | All rights reserved.
*/
const { SlashCommandBuilder } = require('@discordjs/builders');
const {
    ContainerBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    ButtonBuilder,
    ButtonStyle,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
    ChannelType,
    GuildVerificationLevel,
} = require('discord.js');

function chunkArray(arr, size) {
    return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
        arr.slice(i * size, i * size + size)
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('server')
        .setDescription('Comprehensive server information and management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Show detailed server information with advanced pagination')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('icon')
                .setDescription('Display the server icon in high quality')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('banner')
                .setDescription('Show the server banner if available')
        )
        .addSubcommand(sub => sub.setName('membercount').setDescription('Detailed member statistics and analytics'))
        .addSubcommand(sub => sub.setName('roles').setDescription('Complete list of server roles with details'))
        .addSubcommand(sub => sub.setName('emojis').setDescription('Display all server emojis categorized'))
        .addSubcommand(sub => sub.setName('channels').setDescription('Comprehensive channel summary and statistics'))
        .addSubcommand(sub => sub.setName('boosts').setDescription('Server boost information and perks'))
        .addSubcommand(sub => sub.setName('region').setDescription('Server region and locale information'))
        .addSubcommand(sub => sub.setName('verification').setDescription('Current verification level details'))
        .addSubcommand(sub => sub.setName('features').setDescription('All enabled server features and capabilities')),

    async execute(interaction) {
        try {
            let sender = interaction.user;
            let subcommand;
            let isSlashCommand = false;

            if (interaction.isCommand && interaction.isCommand()) {
                isSlashCommand = true;
                await interaction.deferReply();
                subcommand = interaction.options.getSubcommand();
            } else {
                const message = interaction;
                sender = message.author;
                const args = message.content.split(' ');
                args.shift();
                subcommand = args[0] || 'help';
            }

            const server = isSlashCommand ? interaction.guild : interaction.guild;
            
            const sendReply = async (components) => {
                const messageData = {
                    components: components,
                    flags: MessageFlags.IsComponentsV2
                };

                if (isSlashCommand) {
                    return interaction.editReply(messageData);
                } else {
                    return interaction.reply(messageData);
                }
            };

            if (!server) {
                const components = [];
                const errorContainer = new ContainerBuilder()
                    .setAccentColor(0xff4757);

                errorContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent('# ❌ Server Required\n## This command must be used in a server\n\n> Server commands require guild context to function properly')
                );

                components.push(errorContainer);
                return sendReply(components);
            }

         if (subcommand === 'info') {
            try {
                const owner = await server.fetchOwner();
                const emojis = server.emojis.cache;
                const roles = server.roles.cache.filter(role => role.id !== server.id);
                const channels = server.channels.cache;
        
                const textChannels = channels.filter(c => c.type === ChannelType.GuildText).size;
                const voiceChannels = channels.filter(c => c.type === ChannelType.GuildVoice).size;
                const categories = channels.filter(c => c.type === ChannelType.GuildCategory).size;

                const boostCount = server.premiumSubscriptionCount || 0;
                const boostLevel = server.premiumTier || 0;

                const serverContainer = new ContainerBuilder()
                    .setAccentColor(0x00d4ff)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(`# Server Information\n**${server.name}** - Complete Server Analytics`)
                    )
                    .addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder()
                                    .setContent(`**Server ID:** ${server.id}\n**Owner:** <@${owner.id}>\n**Created:** <t:${Math.floor(server.createdTimestamp / 1000)}:F>\n**Member Count:** ${server.memberCount.toLocaleString()}\n**Boost Level:** Level ${boostLevel} (${boostCount} boosts)`)
                            )
                            .setThumbnailAccessory(
                                new ThumbnailBuilder()
                                    .setURL(server.iconURL({ dynamic: true, size: 256 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
                                    .setDescription(`Server icon for ${server.name}`)
                            )
                    )
                    .addSeparatorComponents(
                        new SeparatorBuilder()
                            .setSpacing(SeparatorSpacingSize.Large)
                    )
                    .addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder()
                                    .setContent(`**Channels:** ${categories} categories, ${textChannels} text, ${voiceChannels} voice\n**Roles:** ${roles.size} custom roles\n**Emojis:** ${emojis.size} custom expressions\n**Verification:** ${server.verificationLevel}\n**Features:** ${server.features.length} enabled`)
                            )
                            .setButtonAccessory(
                                new ButtonBuilder()
                                .setLabel('Join Support server')
                                .setStyle(ButtonStyle.Link)
                                .setURL(`https://share.google/v6mijaR1AnYsHEzqg`)
                            )
                    )
                    .addSeparatorComponents(
                        new SeparatorBuilder()
                            .setSpacing(SeparatorSpacingSize.Small)
                    )
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(`*Requested by ${sender.tag} • ${new Date().toLocaleString()}*`)
                    );

                return sendReply([serverContainer]);

            } catch (error) {
                console.error('Error fetching server information:', error);
                const errorContainer = new ContainerBuilder()
                    .setAccentColor(0xff4757)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent('# ❌ Information Error\nFailed to fetch server information')
                    );

                return sendReply([errorContainer]);
            }
        }
        
        
        else if (subcommand === 'icon') {
            const iconURL = server.iconURL({ format: 'png', dynamic: true, size: 1024 });

            const iconContainer = new ContainerBuilder()
                .setAccentColor(0x7c3aed)
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# Server Icon\n**${server.name}** - High Resolution Server Icon`)
                );

            if (iconURL) {
                const isAnimated = server.iconURL({ dynamic: true }) !== server.iconURL({ dynamic: false });
                iconContainer.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder()
                                .setContent(`**Resolution:** 1024x1024 pixels\n**Format:** ${isAnimated ? 'Animated GIF' : 'Static PNG'}\n**Quality:** Maximum\n\n**Download Links:**\n[PNG Format](${server.iconURL({ format: 'png', size: 1024 })})\n[WebP Format](${server.iconURL({ format: 'webp', size: 1024 })})\n${isAnimated ? `[GIF Format](${server.iconURL({ format: 'gif', size: 1024 })})` : ''}`)
                        )
                        .setThumbnailAccessory(
                            new ThumbnailBuilder()
                                .setURL(iconURL)
                                .setDescription(`Server icon for ${server.name}`)
                        )
                );
            } else {
                iconContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`**Status:** No server icon set\n\n**Setup Guide:**\n[Server Settings](https://support.discord.com/hc/en-us/articles/206029707-How-do-I-set-up-a-Role-Exclusive-Channel-)\nRecommended: 512x512 pixels\nFormats: PNG, JPG, GIF`)
                );
            }

            iconContainer.addSeparatorComponents(
                new SeparatorBuilder()
                    .setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`*Requested by ${sender.tag} • ${new Date().toLocaleString()}*`)
            );

            return sendReply([iconContainer]);
        } 
        
    
        else if (subcommand === 'banner') {
            const bannerURL = server.bannerURL({ format: 'png', dynamic: true, size: 1024 });

            const bannerContainer = new ContainerBuilder()
                .setAccentColor(0x00d4ff)
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# Server Banner\n**${server.name}** - Premium Server Banner`)
                );

            if (bannerURL) {
                bannerContainer.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder()
                                .setContent(`**Resolution:** 1920x1080 pixels\n**Boost Level:** ${server.premiumTier}\n**Status:** Premium Feature Active\n\n**Download Links:**\n[PNG Format](${server.bannerURL({ format: 'png', size: 1024 })})\n[WebP Format](${server.bannerURL({ format: 'webp', size: 1024 })})\n[JPG Format](${server.bannerURL({ format: 'jpg', size: 1024 })})`)
                        )
                        .setThumbnailAccessory(
                            new ThumbnailBuilder()
                                .setURL(bannerURL)
                                .setDescription(`Server banner for ${server.name}`)
                        )
                );
            } else {
                const boostsNeeded = server.premiumTier < 2 ? (15 - (server.premiumSubscriptionCount || 0)) : 0;
                bannerContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`**Status:** No server banner available\n**Requirements:** Boost Level 2 or higher\n**Current Level:** ${server.premiumTier}\n**Boosts Needed:** ${boostsNeeded}\n\n**Learn More:**\n[Server Boosting Guide](https://support.discord.com/hc/en-us/articles/360028038352-Server-Boosting-FAQ-)\n[Boost This Server](https://discord.com/channels/${server.id})`)
                );
            }

            bannerContainer.addSeparatorComponents(
                new SeparatorBuilder()
                    .setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`*Requested by ${sender.tag} • ${new Date().toLocaleString()}*`)
            );

            return sendReply([bannerContainer]);
        }
            
          
            else if (subcommand === 'membercount') {
                const members = await server.members.fetch();
                const humans = members.filter(m => !m.user.bot).size;
                const bots = members.filter(m => m.user.bot).size;

                const statuses = {
                    online: members.filter(m => m.presence?.status === 'online').size,
                    idle: members.filter(m => m.presence?.status === 'idle').size,
                    dnd: members.filter(m => m.presence?.status === 'dnd').size,
                    offline: members.filter(m => !m.presence || m.presence.status === 'offline').size
                };

                const components = [];

                const membercountContainer = new ContainerBuilder()
                    .setAccentColor(0x00bfff);

                membercountContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# 👥 Member Analytics\n## ${server.name} Community\n\n> Real-time member statistics and activity monitoring\n> Comprehensive demographic breakdown`)
                );

                components.push(membercountContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const statsContainer = new ContainerBuilder()
                    .setAccentColor(0x4CAF50);

                statsContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 📊 **Member Breakdown**\n\n**Total Community**\n${members.size.toLocaleString()} total members\n\n**Human Users**\n${humans.toLocaleString()} real people (${((humans/members.size)*100).toFixed(1)}%)\n\n**Bot Accounts**\n${bots.toLocaleString()} automated systems (${((bots/members.size)*100).toFixed(1)}%)\n\n**Activity Status**\n🟢 ${statuses.online.toLocaleString()} online\n🌙 ${statuses.idle.toLocaleString()} idle\n🔴 ${statuses.dnd.toLocaleString()} do not disturb\n⚪ ${statuses.offline.toLocaleString()} offline`)
                );

                components.push(statsContainer);

                const footerContainer = new ContainerBuilder()
                    .setAccentColor(0x95A5A6);

                footerContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`📈 Community health: ${((statuses.online + statuses.idle + statuses.dnd)/members.size*100).toFixed(1)}% active`)
                );

                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));
                components.push(footerContainer);

                return sendReply(components);
            }

          
            else if (subcommand === 'roles') {
                const roles = server.roles.cache
                    .filter(role => role.id !== server.id)
                    .sort((a, b) => b.position - a.position);

                const components = [];

                const rolesContainer = new ContainerBuilder()
                    .setAccentColor(0x8e44ad);

                rolesContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# 🎭 Role Management\n## ${server.name} Hierarchy\n\n> Complete role structure and permission overview\n> ${roles.size} total roles configured`)
                );

                components.push(rolesContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const roleListContainer = new ContainerBuilder()
                    .setAccentColor(0x9B59B6);

                const roleList = roles.map(role => {
                    const colorHex = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#000000';
                    return `${role} | \`${colorHex}\` | ${role.members.size} members`;
                });

                roleListContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 👑 **Role Hierarchy**\n\n${roleList.length > 0 ? roleList.join('\n') : 'No custom roles configured'}\n\n**Management Links**\n[Role Settings](https://discord.com/channels/${server.id}) (Admin Only)\n[Permission Guide](https://support.discord.com/hc/en-us/articles/206029707-How-do-I-set-up-a-Role-Exclusive-Channel-)`)
                );

                components.push(roleListContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const roleStatsContainer = new ContainerBuilder()
                    .setAccentColor(0x8B5CF6);

                roleStatsContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 📊 **Role Statistics**\n\n**Total Roles**\n${roles.size} configured roles\n\n**Hoisted Roles**\n${roles.filter(r => r.hoist).size} displayed separately\n\n**Mentionable Roles**\n${roles.filter(r => r.mentionable).size} can be mentioned\n\n**Permission Roles**\n${roles.filter(r => r.permissions.bitfield > 0n).size} with special permissions`)
                );

                components.push(roleStatsContainer);

                const footerContainer = new ContainerBuilder()
                    .setAccentColor(0x95A5A6);

                footerContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`🎭 Permission hierarchy system | ${roles.size} total management roles`)
                );

                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));
                components.push(footerContainer);

                return sendReply(components);
            }

          
            else if (subcommand === 'emojis') {
                const emojis = server.emojis.cache;
                const animated = emojis.filter(e => e.animated);
                const staticEmojis = emojis.filter(e => !e.animated);

                const components = [];

                const emojiContainer = new ContainerBuilder()
                    .setAccentColor(0xf39c12);

                emojiContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# 😀 Emoji Collection\n## ${server.name} Expressions\n\n> Custom emoji library and management\n> ${emojis.size} total expressions available`)
                );

                components.push(emojiContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const animatedContainer = new ContainerBuilder()
                    .setAccentColor(0xE67E22);

                animatedContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 🎞️ **Animated Emojis**\n\n${animated.size > 0 ? animated.map(e => e.toString()).join(' ') : 'No animated emojis'}\n\n**Collection Info**\nAnimated: ${animated.size} emojis\n[Emoji Guide](https://support.discord.com/hc/en-us/articles/360036479811-Custom-Emojis)`)
                );

                components.push(animatedContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const staticContainer = new ContainerBuilder()
                    .setAccentColor(0xD68910);

                staticContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 🖼️ **Static Emojis**\n\n${staticEmojis.size > 0 ? staticEmojis.map(e => e.toString()).join(' ') : 'No static emojis'}\n\n**Collection Info**\nStatic: ${staticEmojis.size} emojis\n[Upload Guidelines](https://support.discord.com/hc/en-us/articles/360036479811-Custom-Emojis)`)
                );

                components.push(staticContainer);

                const footerContainer = new ContainerBuilder()
                    .setAccentColor(0x95A5A6);

                footerContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`😀 Expression library | ${emojis.size} total (${animated.size} animated, ${staticEmojis.size} static)`)
                );

                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));
                components.push(footerContainer);

                return sendReply(components);
            }

        
            else if (subcommand === 'channels') {
                const channels = server.channels.cache;

                const counts = {
                    categories: channels.filter(c => c.type === ChannelType.GuildCategory).size,
                    text: channels.filter(c => c.type === ChannelType.GuildText).size,
                    voice: channels.filter(c => c.type === ChannelType.GuildVoice).size,
                    stage: channels.filter(c => c.type === ChannelType.GuildStageVoice).size,
                    threads: channels.filter(c => c.isThread()).size,
                    news: channels.filter(c => c.type === ChannelType.GuildNews).size,
                    forum: channels.filter(c => c.type === ChannelType.GuildForum).size
                };

                const components = [];

                const channelContainer = new ContainerBuilder()
                    .setAccentColor(0x2ecc71);

                channelContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# 📚 Channel Overview\n## ${server.name} Infrastructure\n\n> Complete channel architecture and organization\n> ${Object.values(counts).reduce((a, b) => a + b, 0)} total channels`)
                );

                components.push(channelContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const channelStatsContainer = new ContainerBuilder()
                    .setAccentColor(0x27AE60);

                channelStatsContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 📊 **Channel Distribution**\n\n**Categories**\n${counts.categories} organizational sections\n\n**Text Channels**\n${counts.text} discussion channels\n\n**Voice Channels**\n${counts.voice} audio communication\n\n**Stage Channels**\n${counts.stage} presentation spaces\n\n**Active Threads**\n${counts.threads} ongoing discussions\n\n**News Channels**\n${counts.news} announcement channels\n\n**Forum Channels**\n${counts.forum} Q&A communities\n\n**Management**\n[Channel Settings](https://discord.com/channels/${server.id}) (Admin Only)`)
                );

                components.push(channelStatsContainer);

                const footerContainer = new ContainerBuilder()
                    .setAccentColor(0x95A5A6);

                footerContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`📚 Communication infrastructure | ${Object.values(counts).reduce((a, b) => a + b, 0)} total channels`)
                );

                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));
                components.push(footerContainer);

                return sendReply(components);
            }

            
            else if (subcommand === 'boosts') {
                const boostCount = server.premiumSubscriptionCount || 0;
                const boostLevel = server.premiumTier;
                
                const boostPerks = {
                    0: ['📱 Mobile streaming', '🎧 Voice quality: 96kbps'],
                    1: ['🎬 Screen sharing: 720p 60fps', '📊 Custom emoji: 50 total', '🎧 Voice quality: 128kbps'],
                    2: ['🎬 Screen sharing: 1080p 60fps', '📊 Custom emoji: 100 total', '🎨 Server banner', '📁 Upload limit: 50MB'],
                    3: ['🎬 Screen sharing: 4K 60fps', '📊 Custom emoji: 250 total', '🎨 Animated server icon', '📁 Upload limit: 100MB', '🎵 Custom invite background']
                };

                const nextLevelBoosts = boostLevel < 3 ? [7, 14, 30][boostLevel] : null;
                const boostsNeeded = nextLevelBoosts ? Math.max(0, nextLevelBoosts - boostCount) : 0;

                const components = [];

                const boostContainer = new ContainerBuilder()
                    .setAccentColor(0xff73fa);

                boostContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# 🚀 Server Boosting\n## ${server.name} Premium Status\n\n> Server boost analytics and premium features\n> Community support and enhancement tracking`)
                );

                components.push(boostContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const boostStatsContainer = new ContainerBuilder()
                    .setAccentColor(0xE91E63);

                boostStatsContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 💎 **Boost Status**\n\n**Current Level**\nLevel ${boostLevel} ${boostLevel === 0 ? '🔘' : boostLevel === 1 ? '🟡' : boostLevel === 2 ? '🟠' : '🔴'}\n\n**Active Boosts**\n${boostCount.toLocaleString()} community supporters\n\n**Progress to Next Level**\n${nextLevelBoosts ? `${boostsNeeded} more boosts needed (Target: ${nextLevelBoosts})` : 'Maximum level achieved'}\n\n**Learn More**\n[Boosting Guide](https://support.discord.com/hc/en-us/articles/360028038352-Server-Boosting-FAQ-)\n[Boost This Server](https://discord.com/channels/${server.id})`)
                );

                components.push(boostStatsContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const perksContainer = new ContainerBuilder()
                    .setAccentColor(0xAD1457);

                perksContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 🎁 **Level ${boostLevel} Benefits**\n\n${boostPerks[boostLevel].map(perk => `• ${perk}`).join('\n')}\n\n**Premium Features**\n[Feature Comparison](https://support.discord.com/hc/en-us/articles/360028038352-Server-Boosting-FAQ-)\n[Nitro Benefits](https://discord.com/nitro)`)
                );

                components.push(perksContainer);

                const footerContainer = new ContainerBuilder()
                    .setAccentColor(0x95A5A6);

                footerContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`🚀 Server enhancement system | Level ${boostLevel} community support`)
                );

                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));
                components.push(footerContainer);

                return sendReply(components);
            }

      
            else if (subcommand === 'region') {
                const components = [];

                const regionContainer = new ContainerBuilder()
                    .setAccentColor(0x95a5a6);

                regionContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# 🌍 Server Region\n## ${server.name} Localization\n\n> Regional settings and localization preferences\n> Optimized for community location and language`)
                );

                components.push(regionContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const settingsContainer = new ContainerBuilder()
                    .setAccentColor(0x7F8C8D);

                settingsContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 🗺️ **Regional Configuration**\n\n**Preferred Locale**\n${server.preferredLocale || 'English (US)'}\n\n**Benefits**\n🌐 Optimized connections\n📊 Localized features\n🎯 Targeted content\n⚡ Reduced latency\n\n**Management**\n[Server Settings](https://discord.com/channels/${server.id}) (Admin Only)\n[Localization Guide](https://support.discord.com/hc/en-us/articles/213219267-How-do-I-change-the-language-Discord-displays-in-)`)
                );

                components.push(settingsContainer);

                const footerContainer = new ContainerBuilder()
                    .setAccentColor(0x95A5A6);

                footerContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`🌍 Regional optimization | ${server.memberCount.toLocaleString()} global members`)
                );

                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));
                components.push(footerContainer);

                return sendReply(components);
            }

           
            else if (subcommand === 'verification') {
                const levelMap = {
                    [GuildVerificationLevel.None]: { name: "None", desc: "No verification required", emoji: "🔓", color: 0x95a5a6 },
                    [GuildVerificationLevel.Low]: { name: "Low", desc: "Email verification required", emoji: "📧", color: 0x3498db },
                    [GuildVerificationLevel.Medium]: { name: "Medium", desc: "Account age > 5 minutes", emoji: "⏰", color: 0xf39c12 },
                    [GuildVerificationLevel.High]: { name: "High", desc: "Member for 10+ minutes", emoji: "🔒", color: 0xe74c3c },
                    [GuildVerificationLevel.VeryHigh]: { name: "Very High", desc: "Phone number required", emoji: "📱", color: 0x8e44ad }
                };

                const currentLevel = levelMap[server.verificationLevel] || levelMap[GuildVerificationLevel.None];

                const components = [];

                const verificationContainer = new ContainerBuilder()
                    .setAccentColor(currentLevel.color);

                verificationContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# 🔐 Server Security\n## ${server.name} Verification\n\n> Member verification and security configuration\n> Community protection and access control`)
                );

                components.push(verificationContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const levelContainer = new ContainerBuilder()
                    .setAccentColor(0x4CAF50);

                levelContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 🛡️ **Current Security Level**\n\n**Verification Level**\n${currentLevel.emoji} ${currentLevel.name}\n\n**Requirements**\n${currentLevel.desc}\n\n**Protection Status**\nEnhanced security active\n\n**Management**\n[Security Settings](https://discord.com/channels/${server.id}) (Admin Only)\n[Verification Guide](https://support.discord.com/hc/en-us/articles/216679607-What-are-Verification-Levels-)`)
                );

                components.push(levelContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const levelsContainer = new ContainerBuilder()
                    .setAccentColor(0x2196F3);

                levelsContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 📊 **Available Security Levels**\n\n${server.verificationLevel === GuildVerificationLevel.None ? '🔘' : '⚪'} **None** - No restrictions\n${server.verificationLevel === GuildVerificationLevel.Low ? '🔘' : '⚪'} **Low** - Email verification\n${server.verificationLevel === GuildVerificationLevel.Medium ? '🔘' : '⚪'} **Medium** - Account age required\n${server.verificationLevel === GuildVerificationLevel.High ? '🔘' : '⚪'} **High** - Member duration required\n${server.verificationLevel === GuildVerificationLevel.VeryHigh ? '🔘' : '⚪'} **Very High** - Phone verification\n\n**Security Resources**\n[Moderation Guide](https://discord.com/moderation)\n[Safety Center](https://discord.com/safety)`)
                );

                components.push(levelsContainer);

                const footerContainer = new ContainerBuilder()
                    .setAccentColor(0x95A5A6);

                footerContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`🔐 Security system active | ${currentLevel.name} level protection`)
                );

                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));
                components.push(footerContainer);

                return sendReply(components);
            }

           
            else if (subcommand === 'features') {
                const features = server.features;
                const featureDescriptions = {
                    'ANIMATED_BANNER': '🎬 Animated Banner',
                    'ANIMATED_ICON': '🎭 Animated Icon',
                    'APPLICATION_COMMAND_PERMISSIONS_V2': '⚙️ Advanced Permissions',
                    'AUTO_MODERATION': '🤖 Auto Moderation',
                    'BANNER': '🎨 Server Banner',
                    'COMMUNITY': '🌐 Community Server',
                    'DEVELOPER_SUPPORT_SERVER': '👨‍💻 Developer Support',
                    'DISCOVERABLE': '🔍 Server Discovery',
                    'FEATURABLE': '⭐ Featurable',
                    'INVITES_DISABLED': '🚫 Invites Disabled',
                    'INVITE_SPLASH': '🌊 Invite Splash',
                    'MEMBER_VERIFICATION_GATE_ENABLED': '🔐 Member Screening',
                    'MORE_EMOJI': '😀 Extended Emojis',
                    'NEWS': '📰 News Channels',
                    'PARTNERED': '🤝 Discord Partner',
                    'PREVIEW_ENABLED': '👁️ Server Preview',
                    'PRIVATE_THREADS': '🧵 Private Threads',
                    'ROLE_ICONS': '🎭 Role Icons',
                    'THREADS_ENABLED': '💬 Threads Enabled',
                    'THREE_DAY_THREAD_ARCHIVE': '📦 3-Day Thread Archive',
                    'TICKETED_EVENTS_ENABLED': '🎟️ Ticketed Events',
                    'VANITY_URL': '🔗 Vanity URL',
                    'VERIFIED': '✅ Verified Server',
                    'VIP_REGIONS': '🌍 VIP Voice Regions',
                    'WELCOME_SCREEN_ENABLED': '👋 Welcome Screen'
                };

                const components = [];

                const featuresContainer = new ContainerBuilder()
                    .setAccentColor(0x3498db);

                featuresContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# 🛠️ Server Features\n## ${server.name} Capabilities\n\n> Advanced server features and functionality\n> ${features.length} special features enabled`)
                );

                components.push(featuresContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const enabledContainer = new ContainerBuilder()
                    .setAccentColor(0x4CAF50);

                enabledContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 🎯 **Active Features**\n\n${features.length > 0 ? 
                            features.map(f => featureDescriptions[f] || `🔹 ${f.replaceAll('_', ' ').toLowerCase()}`).join('\n') : 
                            'No special features enabled'}\n\n**Feature Documentation**\n[Discord Features](https://support.discord.com/hc/en-us/articles/360047132851-Discord-Features)\n[Community Guidelines](https://discord.com/guidelines)`)
                );

                components.push(enabledContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const categoriesContainer = new ContainerBuilder()
                    .setAccentColor(0x2196F3);

                categoriesContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 📊 **Feature Categories**\n\n**Total Features**\n${features.length} special capabilities\n\n**Visual Features**\n${features.filter(f => ['BANNER', 'ANIMATED_ICON', 'VANITY_URL'].includes(f)).length} customization options\n\n**Security Features**\n${features.filter(f => ['AUTO_MODERATION', 'MEMBER_VERIFICATION_GATE_ENABLED'].includes(f)).length} protection systems\n\n**Premium Status**\n${features.includes('PARTNERED') ? '🤝 Discord Partner' : features.includes('VERIFIED') ? '✅ Verified Server' : 'Standard Server'}`)
                );

                components.push(categoriesContainer);

                const footerContainer = new ContainerBuilder()
                    .setAccentColor(0x95A5A6);

                footerContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`🛠️ Advanced server capabilities | ${features.length} features active`)
                );

                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));
                components.push(footerContainer);

                return sendReply(components);
            }

    
            else {
                const components = [];

                const helpContainer = new ContainerBuilder()
                    .setAccentColor(0x7289da);

                helpContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# 🏰 Server Commands\n## ${server.name} Management\n\n> Comprehensive server information and management tools\n> Access detailed analytics and configuration options`)
                );

                components.push(helpContainer);
                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

                const commandsContainer = new ContainerBuilder()
                    .setAccentColor(0x5865F2);

                commandsContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`## 📋 **Available Commands**\n\n**Information Commands**\n/server info - Detailed server overview\n/server membercount - Member analytics\n/server verification - Security settings\n\n**Visual Commands**\n/server icon - Server icon display\n/server banner - Server banner view\n/server emojis - Emoji collection\n\n**Management Commands**\n/server roles - Role hierarchy\n/server channels - Channel overview\n/server features - Server capabilities\n\n**Premium Commands**\n/server boosts - Boost information\n/server region - Server locale\n\n**Documentation**\n[Server Management](https://support.discord.com/hc/en-us/articles/206029707-How-do-I-set-up-a-Role-Exclusive-Channel-)\n[Admin Guide](https://discord.com/moderation)`)
                );

                components.push(commandsContainer);

                const footerContainer = new ContainerBuilder()
                    .setAccentColor(0x95A5A6);

                footerContainer.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`🏰 Complete server management suite | ${server.name}`)
                );

                components.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));
                components.push(footerContainer);

                return sendReply(components);
            }

        } catch (error) {
            console.error('Error in server command:', error);

            const errorContainer = new ContainerBuilder()
                .setAccentColor(0xE74C3C);

            errorContainer.addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent('## ❌ **Server Command Error**\n\nSomething went wrong while processing the server command. Please try again in a moment.')
            );

            const components = [errorContainer];

            if (isSlashCommand) {
                return interaction.editReply({
                    components: components,
                    flags: MessageFlags.IsComponentsV2
                });
            } else {
                return interaction.reply({
                    components: components,
                    flags: MessageFlags.IsComponentsV2
                });
            }
        }
    },
};

/*
 ██████╗ ██╗      █████╗  ██████╗███████╗██╗   ██╗████████╗
██╔════╝ ██║     ██╔══██╗██╔════╝██╔════╝╚██╗ ██╔╝╚══██╔══╝
██║  ███╗██║     ███████║██║     █████╗   ╚████╔╝    ██║   
██║   ██║██║     ██╔══██║██║     ██╔══╝    ╚██╔╝     ██║   
╚██████╔╝███████╗██║  ██║╚██████╗███████╗   ██║      ██║   
 ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝   ╚═╝      ╚═╝   

-------------------------------------
📡 Discord : https://discord.gg/xQF9f9yUEM
🌐 Website : https://glaceyt.com
🎥 YouTube : https://youtube.com/@GlaceYT
✅ Verified | 🧩 Tested | ⚙️ Stable
-------------------------------------
> © 2025 GlaceYT.com | All rights reserved.
*/
