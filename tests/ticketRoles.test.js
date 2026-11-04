const test = require('node:test');
const assert = require('node:assert/strict');
const {
    MAX_STAFF_ROLES, ticketRoleIds, staffMention, isTicketStaff
} = require('../utils/ticketRoles');

test('ticket staff list puts the setup admin role first and added roles after it', () => {
    const config = { adminRoleId: '111', extraAdminRoleIds: ['222', '333', '222', ''] };
    assert.deepEqual(ticketRoleIds(config), ['111', '222', '333']);
    assert.equal(staffMention(config), '<@&111> <@&222> <@&333>');
});

test('a server without added roles still pings the single admin role from setup', () => {
    const config = { adminRoleId: '111' };
    assert.deepEqual(ticketRoleIds(config), ['111']);
    assert.equal(staffMention(config), '<@&111>');
});

test('ticket staff list stays inside the Discord channel permission limit', () => {
    const config = {
        adminRoleId: '111',
        extraAdminRoleIds: Array.from({ length: 20 }, (_, i) => String(1000 + i))
    };
    const ids = ticketRoleIds(config);
    assert.equal(ids.length, MAX_STAFF_ROLES);
    assert.equal(ids[0], '111');
    assert.equal(ids.includes('1011'), false);
});

test('added staff roles may manage tickets while unrelated members may not', () => {
    const config = { adminRoleId: '111', extraAdminRoleIds: ['222'], ownerId: 'owner-1' };
    const cacheOf = (ids) => ({ has: (id) => ids.includes(id) });

    assert.equal(isTicketStaff({ member: { roles: { cache: cacheOf(['222']) } }, userId: 'u1', config }), true);
    assert.equal(isTicketStaff({
        member: { roles: { cache: cacheOf(['999']) }, permissions: { has: () => false } },
        userId: 'u2',
        config
    }), false);
    assert.equal(isTicketStaff({
        member: { roles: { cache: cacheOf([]) }, permissions: { has: () => false } },
        userId: 'owner-1',
        config
    }), true);
});
