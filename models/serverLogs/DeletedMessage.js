const mongoose = require('mongoose');

const AttachmentSchema = new mongoose.Schema({
    name: { type: String, default: 'attachment' },
    url: { type: String, default: '' },
    size: { type: Number, default: 0 },
    contentType: { type: String, default: '' }
}, { _id: false });

const DeletedMessageSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    messageId: { type: String, required: true },
    channelId: { type: String, required: true },
    authorId: { type: String, default: null },
    authorTag: { type: String, default: 'Unknown user' },
    content: { type: String, default: '' },
    contentAvailable: { type: Boolean, default: true },
    attachments: { type: [AttachmentSchema], default: [] },
    sentAt: { type: Date, required: true },
    deletedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true }
}, {
    timestamps: true
});

DeletedMessageSchema.index({ guildId: 1, messageId: 1 }, { unique: true });
DeletedMessageSchema.index({ guildId: 1, deletedAt: -1 });
DeletedMessageSchema.index({ guildId: 1, channelId: 1, deletedAt: -1 });
DeletedMessageSchema.index({ guildId: 1, authorId: 1, deletedAt: -1 });
DeletedMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('DeletedMessage', DeletedMessageSchema);
