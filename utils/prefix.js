const config = require('../config.json');

/**
 * Returns the prefix that `content` starts with, or null if it is not a
 * prefix command.
 *
 * Both the per-server prefix (set via /setup-serverconfig) and the default
 * prefix from config.json are accepted. Previously only the server prefix
 * was checked, so a server document that held the schema default "!" made
 * every ".command" silently stop working.
 */
function getMatchedPrefix(content, serverPrefix) {
    if (typeof content !== 'string') return null;

    const candidates = [...new Set([serverPrefix, config.prefix || '.'])]
        .filter(prefix => typeof prefix === 'string' && prefix.length > 0)
        .sort((a, b) => b.length - a.length);

    return candidates.find(prefix => content.startsWith(prefix)) || null;
}

module.exports = { getMatchedPrefix };
