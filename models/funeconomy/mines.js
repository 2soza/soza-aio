const mongoose = require('mongoose');

const minesSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    bet: { type: Number, required: true, min: 1 },
    mineCount: { type: Number, required: true, min: 1, max: 3 },
    minePositions: { type: [Number], required: true },
    revealed: { type: [Number], default: [] },
    hitPosition: { type: Number, min: 0, max: 8, default: null },
    status: {
        type: String,
        enum: ['pending', 'playing', 'lost', 'cashed_out'],
        default: 'pending'
    },
    payout: { type: Number, default: 0, min: 0 },
    version: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

module.exports = mongoose.models.FunMines || mongoose.model('FunMines', minesSchema);
