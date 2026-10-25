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

test('playing status uses only the title without appending the author', () => {
    assert.equal(formatTrackStatus({ title: 'Aku Tenang', author: 'Fourtwnty' }), 'Aku Tenang');
});

test('playing status falls back to the title when the artist is missing', () => {
    assert.equal(formatTrackStatus({ title: 'Aku Tenang', author: '' }), 'Aku Tenang');
});

test('the current track title is shown without appending its author', async () => {
    const { client, calls } = createClient();
    client.riffy = { players: new Map([['guild-123', { current: { info: { title: 'Aku Tenang', author: 'Fourtwnty' } } }]]) };
    await setVoiceChannelStatus(client, 'guild-123', 'Aku Tenang');
    assert.equal(calls[0][1].body.status, '<a:soza:1562256028320399531> Aku Tenang');
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

test('parenthesized text is removed from voice titles', () => {
    assert.equal(formatTrackStatus({ title: 'SOULJAH - Bilang I Love You (Official Audio)', author: 'Bahaya Records' }), 'SOULJAH - Bilang I Love You');
    assert.equal(formatTrackStatus({ title: 'Song (Acoustic Version) (2026)', author: 'Uploader' }), 'Song');
});

test('square-bracketed text is removed from voice titles', () => {
    assert.equal(formatTrackStatus({ title: 'Hampa - Ari Lasso [ Lirik Lagu ]', author: 'Lalala' }), 'Hampa - Ari Lasso');
});

test('nested groups are removed and whitespace is normalized', () => {
    assert.equal(formatTrackStatus({ title: '  ST12 - Putri Iklan (Live [Session]) [HD]  ', author: 'Radio' }), 'ST12 - Putri Iklan');
});

test('singer names already in the title stay in their original position', () => {
    assert.equal(formatTrackStatus({ title: 'Fourtwnty - Aku Tenang', author: 'Fourtwnty' }), 'Fourtwnty - Aku Tenang');
});

test('voice status formatting does not mutate now-playing metadata', () => {
    const info = { title: 'SOULJAH - Bilang I Love You (Official Audio)', author: 'Bahaya Records' };
    formatTrackStatus(info);
    assert.deepEqual(info, { title: 'SOULJAH - Bilang I Love You (Official Audio)', author: 'Bahaya Records' });
});

test('raw current-track titles are cleaned before being sent to Discord', async () => {
    const { client, calls } = createClient();
    const info = { title: 'Hampa - Ari Lasso [ Lirik Lagu ] (Video)', author: 'Lalala' };
    client.riffy = { players: new Map([['guild-123', { current: { info } }]]) };
    await setVoiceChannelStatus(client, 'guild-123', info.title);
    assert.equal(calls[0][1].body.status, '<a:soza:1562256028320399531> Hampa - Ari Lasso');
});

test('direct status updates also remove bracketed text', async () => {
    const { client, calls } = createClient();
    await setVoiceChannelStatus(client, 'guild-123', 'ST12 - Putri Iklan [Lyrics] (Audio)');
    assert.equal(calls[0][1].body.status, '<a:soza:1562256028320399531> ST12 - Putri Iklan');
});

test('a title containing only removed groups never restores them', () => {
    assert.equal(formatTrackStatus({ title: '(Official Audio) [HD]', author: 'Uploader' }), IDLE_VOICE_STATUS);
});
