const crypto = require('node:crypto');
const cfg = require('./config');

const BOARD_SIZE = 9;
const RTP_NUMERATOR = Math.round(cfg.MINES_RTP * 100);

function combination(n, k) {
    if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return 0;
    let result = 1;
    for (let i = 1; i <= Math.min(k, n - k); i += 1) {
        result = (result * (n - i + 1)) / i;
    }
    return Math.round(result);
}

/** Fair combinatorial payout with the configured house edge applied. */
function multiplierFor(mineCount, safePicks) {
    if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount >= BOARD_SIZE) return null;
    if (!Number.isInteger(safePicks) || safePicks < 1 || safePicks > BOARD_SIZE - mineCount) return null;

    const favorableOutcomes = combination(BOARD_SIZE, safePicks);
    const possibleSafePicks = combination(BOARD_SIZE - mineCount, safePicks);
    return (RTP_NUMERATOR * favorableOutcomes) / (100 * possibleSafePicks);
}

function payoutFor(bet, mineCount, safePicks) {
    const multiplier = multiplierFor(mineCount, safePicks);
    if (!Number.isSafeInteger(bet) || bet < 1 || multiplier === null) return null;

    const numerator = BigInt(bet)
        * BigInt(RTP_NUMERATOR)
        * BigInt(combination(BOARD_SIZE, safePicks));
    const denominator = 100n * BigInt(combination(BOARD_SIZE - mineCount, safePicks));
    const payout = numerator / denominator;
    return payout <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(payout) : null;
}

function generateMinePositions(mineCount) {
    if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount >= BOARD_SIZE) {
        throw new RangeError(`mineCount must be between 1 and ${BOARD_SIZE - 1}`);
    }

    const cells = Array.from({ length: BOARD_SIZE }, (_, index) => index);
    for (let i = cells.length - 1; i > 0; i -= 1) {
        const j = crypto.randomInt(i + 1);
        [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    return cells.slice(0, mineCount);
}

function parseMineCount(token) {
    if (token === undefined) return { mineCount: 1 };
    if (!/^\d+$/.test(String(token))) return { error: 'mine count must be a whole number from 1 to 8.' };

    const mineCount = Number(token);
    if (mineCount < 1 || mineCount >= BOARD_SIZE) {
        return { error: 'choose between **1 and 8 mines** so the board always has a safe tile.' };
    }
    return { mineCount };
}

module.exports = {
    BOARD_SIZE,
    combination,
    multiplierFor,
    payoutFor,
    generateMinePositions,
    parseMineCount
};
