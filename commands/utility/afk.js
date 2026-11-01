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
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const afkHandler = require('../../events/afkHandler');

// Koya-style AFK. `/afk reason:<text>` and the prefix form (`soza afk <text>`)
// both run through execute() below and give the same reply.
const AFK_EMOJI = '💤'; // swap for your own emoji, e.g. '<:afk:1234567890>'
const DEFAULT_REASON = 'AFK';
const MAX_REASON = 500;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Set your AFK status.')
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Why are you going AFK?')
                .setMaxLength(MAX_REASON)
                .setRequired(false)),

    // `source` is a slash-command interaction, or a Message when used with the prefix.
    async execute(source) {
        const isSlash = typeof source.isChatInputCommand === 'function' && source.isChatInputCommand();
        const user = isSlash ? source.user : source.author;

        if (!user || user.bot) return;

        if (!source.guild) {
            if (isSlash) {
                await source.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
            }
            return;
        }

        // Prefix: everything after the word "afk" is the reason (works for any prefix style).
        let reason = isSlash
            ? source.options.getString('reason')
            : source.content.match(/afk\s*([\s\S]*)$/i)?.[1];
        reason = (reason ?? '').trim().slice(0, MAX_REASON) || DEFAULT_REASON;

        try {
            const { setAFK, getAFK } = afkHandler(source.client);

            const existing = await getAFK(user.id, source.guild.id);
            if (existing) {
                // Already AFK: just change the reason and restart the timer.
                existing.reason = reason;
                existing.setAt = new Date();
                await existing.save();
            } else {
                await setAFK(user.id, source.guild.id, reason, {
                    dmNotifications: false,
                    publicNotifications: true
                });
            }

            await source.reply({
                content: `${AFK_EMOJI} <@${user.id}>, your **AFK** is now set to: ${reason}.`,
                allowedMentions: { parse: [], repliedUser: false }
            });
        } catch (error) {
            console.error('Error setting AFK:', error);
            const content = 'Something went wrong while setting your AFK. Please try again.';
            if (isSlash) {
                const send = source.replied || source.deferred ? source.followUp : source.reply;
                await send.call(source, { content, flags: MessageFlags.Ephemeral }).catch(() => {});
            } else {
                await source.reply({ content, allowedMentions: { repliedUser: false } }).catch(() => {});
            }
        }
    }
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