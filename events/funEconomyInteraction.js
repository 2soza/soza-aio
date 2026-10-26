const { BUTTON_PREFIX, handleButton } = require('../funeconomy/blackjack');
const register = require('../funeconomy/register');
const mines = require('../funeconomy/mines');

// Tombol blackjack (Hit/Stand) dan Register. Dimuat otomatis oleh handlers/events.js.
module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (!interaction.isButton()) return;

        if (interaction.customId.startsWith(`${register.BUTTON_PREFIX}:`)) {
            return register.handleButton(interaction);
        }
        if (interaction.customId.startsWith(`${BUTTON_PREFIX}:`)) {
            return handleButton(interaction, client);
        }
        if (interaction.customId.startsWith(`${mines.BUTTON_PREFIX}:`)) {
            return mines.handleButton(interaction);
        }
    }
};