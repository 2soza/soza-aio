const { archiveMessage } = require('../services/messageHistoryService');

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        try {
            await archiveMessage(message);
        } catch (error) {
            console.error('[MessageHistory] Could not archive message:', error);
        }
    }
};
