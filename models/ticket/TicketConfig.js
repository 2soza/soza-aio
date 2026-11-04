const mongoose = require('mongoose');

const ticketConfigSchema = new mongoose.Schema({
    serverId: { type: String, required: true, unique: true },
    ticketChannelId: { type: String, required: true },
    transcriptChannelId: { type: String, default: null },
    adminRoleId: { type: String, required: true },
    extraAdminRoleIds: { type: [String], default: [] },
    status: { type: Boolean, default: true },
    ownerId: { type: String, required: true },
    categoryId: { type: String, default: null } 
});

module.exports = mongoose.model('TicketConfig', ticketConfigSchema);
