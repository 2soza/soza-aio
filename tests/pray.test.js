const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cfg = require('../funeconomy/config');
const math = require('../funeconomy/luckMath');

function load(file, dependencies) {
    const module = { exports: {} };
    const filename = path.join(__dirname, '..', file);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, __dirname: path.dirname(filename),
        require: (id) => {
            if (Object.prototype.hasOwnProperty.call(dependencies, id)) return dependencies[id];
            throw new Error(`Unexpected dependency: ${id}`);
        }, Date, console
    }, { filename });
    return module.exports;
}

function accountStore() {
    const state = { points: 0, last: null };
    const query = (doc) => ({ select: () => ({ lean: async () => doc }) });
    const model = {
        findOneAndUpdate(filter, update) {
            const cutoff = filter.$or[1].lastPrayAt.$lte.getTime();
            if (state.last !== null && state.last > cutoff) return query(null);
            state.points += update.$inc.luckPoints;
            state.last = update.$set.lastPrayAt.getTime();
            return query({ luckPoints: state.points, lastPrayAt: new Date(state.last) });
        },
        findOne() { return query({ luckPoints: state.points, lastPrayAt: state.last === null ? null : new Date(state.last) }); }
    };
    return { state, model };
}

function luckFor(store) {
    return load('models/funeconomy/luck.js', {
        '../../funeconomy/config': cfg, './schema': store.model,
        './economy': { ensureAccount: async () => {} }
    });
}

test('spray adds one point and blocks until exactly five minutes, including restart', async () => {
    const store = accountStore();
    const luck = luckFor(store);
    assert.equal((await luck.pray('player', 1000000)).points, 1);
    assert.equal((await luck.pray('player', 1299999)).granted, false);
    assert.equal((await luckFor(store).pray('player', 1299999)).remainingMs, 1);
    assert.equal((await luck.pray('player', 1300000)).points, 2);
});

test('concurrent spray grants only one point', async () => {
    const store = accountStore();
    const luck = luckFor(store);
    const results = await Promise.all([luck.pray('player', 1000000), luck.pray('player', 1000000)]);
    assert.equal(results.filter((result) => result.granted).length, 1);
    assert.equal(store.state.points, 1);
});

test('luck boosts both coin flip choices and caps at two percentage points', () => {
    assert.equal(math.bonusChance(1), 100);
    assert.equal(math.bonusChance(200), 20000);
    assert.equal(math.bonusChance(999999), 20000);
    assert.equal(math.bonusChance(-5), 0);
    for (const side of ['heads', 'tails']) {
        assert.notEqual(math.coinflipResult(side, 0, () => 500050), side);
        assert.equal(math.coinflipResult(side, 1, () => 500050), side);
        assert.notEqual(math.coinflipResult(side, 999999, () => 520000), side);
    }
});

test('slots luck raises x2 chance, keeping payouts and all other bands unchanged', () => {
    const base = [
        { multiplier: 1, chance: 200000 }, { multiplier: 2, chance: 200000 },
        { multiplier: 3, chance: 50000 }, { multiplier: 4, chance: 25000 },
        { multiplier: 10, chance: 10000 }
    ];
    assert.equal(math.slotsChances(base, 1)[1].chance, 200100);
    const boosted = math.slotsChances(base, 999999);
    assert.equal(boosted[1].chance, 220000);
    assert.equal(boosted.reduce((sum, row) => sum + row.chance, 0), 505000);
    assert.deepEqual(boosted.map((row) => row.multiplier), [1, 2, 3, 4, 10]);
    assert.deepEqual(boosted.filter((row) => row.multiplier !== 2), base.filter((row) => row.multiplier !== 2));
    assert.equal(base[1].chance, 200000);
});

test('spray follows registration gate before points can change, then grants luck to registered player', async () => {
    let registered = false;
    let prompts = 0;
    const sent = [];
    const store = accountStore();
    const luck = luckFor(store);
    const command = load('funeconomy/commands/pray.js', {
        crypto: { randomInt: () => 0 }, '../config': cfg,
        '../../models/funeconomy/luck': luck,
        '../utils': {
            fmt: String, displayName: () => 'player', formatDuration: String,
            errorLine: (name, text) => text,
            send: (message, content) => message.channel.send({ content })
        }
    });
    const dispatcher = load('funeconomy/index.js', {
        fs: { readdirSync: () => ['pray.js'] }, path,
        'discord.js': { PermissionsBitField: { Flags: { ViewChannel: 1, SendMessages: 2 } } },
        './config': cfg,
        '../models/funeconomy/ranking': { touchGuild: async () => {} },
        './register': { ensureRegistered: async () => { if (!registered) prompts++; return registered; } },
        [path.resolve(__dirname, '../funeconomy/commands/pray.js')]: command
    });
    const message = {
        content: 'spray', author: { id: 'player', bot: false },
        guild: { id: 'server', members: { me: {} } },
        channel: { permissionsFor: () => ({ has: () => true }), send: async (payload) => { sent.push(payload); } }
    };
    assert.equal(dispatcher.matchCommand('spray').command.name, 'pray');
    assert.equal(dispatcher.matchCommand('pray'), null);
    assert.equal(await dispatcher.handleFunEconomy(message, {}), true);
    assert.equal(prompts, 1);
    assert.equal(store.state.points, 0);
    assert.equal(sent.length, 0);
    registered = true;
    await dispatcher.handleFunEconomy(message, {});
    assert.equal(store.state.points, 1);
    assert.equal(sent.length, 1);
    await dispatcher.handleFunEconomy(message, {});
    assert.equal(store.state.points, 1);
});
