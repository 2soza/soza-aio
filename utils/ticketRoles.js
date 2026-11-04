const MAX_STAFF_ROLES = 12;

function ticketRoleIds(config) {
    const ids = [];
    if (config && config.adminRoleId) ids.push(String(config.adminRoleId));

    const extras = config && Array.isArray(config.extraAdminRoleIds) ? config.extraAdminRoleIds : [];
    for (const value of extras) {
        const id = value ? String(value) : '';
        if (id && !ids.includes(id)) ids.push(id);
    }

    return ids.slice(0, MAX_STAFF_ROLES);
}

function staffMention(config) {
    return ticketRoleIds(config).map((id) => `<@&${id}>`).join(' ');
}

function isTicketStaff({ member, userId, config }) {
    if (!config) return false;
    if (userId && userId === config.ownerId) return true;

    const cache = member && member.roles && member.roles.cache;
    if (cache && ticketRoleIds(config).some((id) => cache.has(id))) return true;

    return Boolean(member && member.permissions && member.permissions.has && member.permissions.has('ManageChannels'));
}

module.exports = { MAX_STAFF_ROLES, ticketRoleIds, staffMention, isTicketStaff };
