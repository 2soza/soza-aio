function setRiffyAutoplayEnabled(player, enabled) {
    if (!player) return false;

    // Riffy exposes autoplay() as a method. Restore it if an older command
    // version replaced it with a boolean on this player instance.
    if (typeof player.autoplay !== 'function') {
        delete player.autoplay;
    }

    if (typeof player.autoplay !== 'function') return false;

    player.isAutoplay = Boolean(enabled);
    return true;
}

module.exports = { setRiffyAutoplayEnabled };
