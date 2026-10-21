const test = require('node:test');
const assert = require('node:assert/strict');
const { IDLE_VOICE_STATUS, formatTrackStatus, setVoiceChannelStatus } = require('../utils/voiceChannelStatus');

function createClient() {
    const calls = [];
    const voiceChannel = {
        id: 'voice-123',
        isVoiceBased: () => true
    };
    const guild = {
        channels: {
            cache: new Map([[voiceChannel.id, voiceChannel]]),
            fetch: async channelId => {
                if (channelId !== voiceChannel.id) throw new Error('Unknown channel');
                return voiceChannel;
            }
        },
        members: {
            me: { voice: { channelId: voiceChannel.id } }
        }
    };

    return {
        calls,
        client: {
            guilds: { cache: new Map([['guild-123', guild]]) },
            rest: {
                put: async (...args) => calls.push(args)
            }
        }
    };
}

test('voice status can show the track title beneath the voice channel name', async () => {
    const { client, calls } = createClient();

    assert.equal(
        await setVoiceChannelStatus(client, 'guild-123', 'anything - Adrianne Lenker'),
        true
    );
    assert.deepEqual(calls, [[
        '/channels/voice-123/voice-status',
        { body: { status: '<a:soza:1562256028320399531> anything - Adrianne Lenker' } }
    ]]);
});

test('an idle voice connection uses the requested silence status', async () => {
    const { client, calls } = createClient();

    assert.equal(await setVoiceChannelStatus(client, 'guild-123', IDLE_VOICE_STATUS), true);
    assert.equal(calls[0][1].body.status, '<a:soza:1562256028320399531> silence, add a track');
});

test('voice status is limited to 500 characters', async () => {
    const { client, calls } = createClient();

    await setVoiceChannelStatus(client, 'guild-123', 'x'.repeat(600));
    assert.equal(calls[0][1].body.status.length, 500);
});

test('missing guild or voice channel does not make a Discord REST call', async () => {
    const { client, calls } = createClient();

    assert.equal(await setVoiceChannelStatus(client, 'missing-guild', IDLE_VOICE_STATUS), false);
    assert.equal(await setVoiceChannelStatus(client, 'guild-123', IDLE_VOICE_STATUS, 'missing-channel'), false);
    assert.equal(calls.length, 0);
});

test('clearing the status sends an empty status without the emoji', async () => {
    const { client, calls } = createClient();

    await setVoiceChannelStatus(client, 'guild-123', '');
    assert.equal(calls[0][1].body.status, '');
});

test('playing status is title - artist without the word by', () => {
    assert.equal(formatTrackStatus({ title: 'Aku Tenang', author: 'Fourtwnty' }), 'Aku Tenang - Fourtwnty');
});

test('playing status falls back to the title when the artist is missing', () => {
    assert.equal(formatTrackStatus({ title: 'Aku Tenang', author: '' }), 'Aku Tenang');
});

test('the current track title is shown with its artist', async () => {
    const { client, calls } = createClient();
    client.riffy = { players: new Map([['guild-123', { current: { info: { title: 'Aku Tenang', author: 'Fourtwnty' } } }]]) };
    await setVoiceChannelStatus(client, 'guild-123', 'Aku Tenang');
    assert.equal(calls[0][1].body.status, '<a:soza:1562256028320399531> Aku Tenang - Fourtwnty');
});

test('rapid track changes apply voice statuses in order so the newest track wins', async () => {
    const { client, calls } = createClient();
    let finishFirstRequest;
    const firstRequest = new Promise(resolve => {
        finishFirstRequest = resolve;
    });

    client.rest.put = async (...args) => {
        calls.push(args);
        if (calls.length === 1) await firstRequest;
    };

    const previousTrackUpdate = setVoiceChannelStatus(client, 'guild-123', 'Old track');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);

    const currentTrackUpdate = setVoiceChannelStatus(client, 'guild-123', 'New track');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1, 'the next update waits for the in-flight Discord request');

    finishFirstRequest();
    assert.deepEqual(await Promise.all([previousTrackUpdate, currentTrackUpdate]), [true, true]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1][1].body.status, '<a:soza:1562256028320399531> New track');
});
