const crypto = require('crypto');
const cfg = require('./config');

const CHANCE_SCALE = 1000000;

// Bonus is measured in millionths: 100 = 0.01 percentage points.
function bonusChance(points) {
    const value = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
    return Math.min(cfg.PRAY.MAX_BONUS_CHANCE, value * cfg.PRAY.BONUS_CHANCE_PER_POINT);
}

function coinflipResult(side, points = 0, randomInt = crypto.randomInt) {
    const won = randomInt(CHANCE_SCALE) < CHANCE_SCALE / 2 + bonusChance(points);
    return won ? side : side === 'heads' ? 'tails' : 'heads';
}

// Shift a small part of losing probability into x2; other bands and payouts stay unchanged.
function slotsChances(payouts, points = 0) {
    const bonus = bonusChance(points);
    return payouts.map((payout) => ({
        ...payout,
        chance: payout.chance + (payout.multiplier === 2 ? bonus : 0)
    }));
}

module.exports = { CHANCE_SCALE, bonusChance, coinflipResult, slotsChances };
