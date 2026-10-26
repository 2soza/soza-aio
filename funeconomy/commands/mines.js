const { startCommand } = require('../mines');

module.exports = {
    name: 'mines',
    async execute(message, args, client) {
        return startCommand(message, args, client);
    }
};
