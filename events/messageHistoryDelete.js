const { markMessageDeleted } = require('../services/messageHistoryService');

module.exports = {
    name: 'messageDelete',
    async execute(message) {
        try {
            await markMessageDeleted(message);
        } catch (error) {
            console.error('[MessageHistory] Could not record deleted message:', error);
        }
    }
};
