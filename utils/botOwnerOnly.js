function getBotOwnerId() {
    const ownerId = process.env.DISCORD_USER_ID?.trim();
    return ownerId && /^\d{17,20}$/.test(ownerId) ? ownerId : null;
}

function isBotOwner(context) {
    const ownerId = getBotOwnerId();
    const userId = context?.user?.id || context?.author?.id;
    return Boolean(ownerId && userId && userId === ownerId);
}

module.exports = {
    getBotOwnerId,
    isBotOwner
};
