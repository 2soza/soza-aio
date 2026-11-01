const cfg = require('../../funeconomy/config');
const FunEconomy = require('./schema');
const { ensureAccount } = require('./economy');

async function getPoints(userId) {
    const doc = await FunEconomy.findOne({ userId }).select('luckPoints').lean();
    return doc?.luckPoints ?? 0;
}

async function pray(userId, now = Date.now()) {
    await ensureAccount(userId);
    const cutoff = new Date(now - cfg.PRAY.COOLDOWN_MS);
    const doc = await FunEconomy.findOneAndUpdate(
        { userId, $or: [{ lastPrayAt: null }, { lastPrayAt: { $lte: cutoff } }] },
        { $inc: { luckPoints: 1 }, $set: { lastPrayAt: new Date(now) } },
        { new: true }
    ).select('luckPoints lastPrayAt').lean();
    if (doc) return { granted: true, points: doc.luckPoints };
    const current = await FunEconomy.findOne({ userId }).select('lastPrayAt').lean();
    const last = current?.lastPrayAt ? new Date(current.lastPrayAt).getTime() : now;
    return { granted: false, remainingMs: Math.max(0, last + cfg.PRAY.COOLDOWN_MS - now) };
}

module.exports = { getPoints, pray };
